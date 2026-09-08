import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Context } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import type { Listing } from '@/modules/sources/source-adapter';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';
import type { ReportOp } from '@/modules/telegram/report';
import { reportUserFacing } from '@/modules/telegram/report';
import { pace } from '@/modules/telegram/watch/watch.pacing';
import { WatchStatus } from '@/modules/telegram/watch/watch.status';

import { isAdmin } from './admin';
import { deliverAndMark } from './telegram.deliver';
import { NO_LINK_PREVIEW, PROMPT, formatCurrentListings } from './telegram.format';

// Refusal for both on-demand pollers (/check, which claims the slot, and the «Показать текущие»
// button, which only peeks at it) — one wording so the two cannot drift. Worded for either
// surface: the holder may be the daily run the user never started, and it holds for minutes.
const POLL_IN_PROGRESS = 'Идёт проверка объявлений — попробуйте через пару минут.';
// How many subscriptions one /check polls. grammY handles updates sequentially, so the paced
// loop blocks every other user meanwhile; at MAX_SUBSCRIPTIONS_PER_USER that would be minutes.
// Five bounds it to four pacing gaps plus five fetches — enough to prove the chain works,
// which is what /check is for.
const MAX_CHECK_SUBSCRIPTIONS = 5;

/** On-demand polling: /check and the «Показать текущие» button. Routed by TelegramHandlers. */
@Injectable()
export class CheckHandlers {
  private readonly logger = new Logger(CheckHandlers.name);

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly subscriptions: SubscriptionsService,
    private readonly watch: WatchService,
    private readonly status: WatchStatus,
  ) {}

  // TODO [L]: grammY processes updates sequentially, so the paced loop below blocks the bot for
  // every other user for tens of seconds. Acceptable today because /check is owner-only in
  // production; running it off the update loop is needed before it opens up.
  async onCheck(ctx: Context): Promise<void> {
    // Silent for non-owners in production, like /stats — an explicit refusal would advertise
    // a command that hits sources.
    const isOwner = isAdmin({ senderId: ctx.from?.id, adminId: this.appConfig.adminTelegramId });
    if (this.appConfig.isProduction && !isOwner) return;

    const userId = ctx.from?.id;
    // Anonymous senders have no subscriptions to check.
    if (userId === undefined) return;

    const all = await this.subscriptions.listByUser(userId);
    if (all.length === 0) {
      await ctx.reply(`Пока нет ни одной подписки. ${PROMPT}`);
      return;
    }
    // Skip paused ones, like the daily run does: reporting listings for a search that
    // delivers nothing would just mislead.
    const subs = all.filter((sub) => !sub.pausedAt);
    if (subs.length === 0) {
      await ctx.reply('Все подписки на паузе — верните их кнопкой ▶️ в /list.');
      return;
    }

    // Share the polling slot with the daily run — see WatchStatus.
    if (!this.status.tryStartPolling()) {
      await ctx.reply(POLL_IN_PROGRESS);
      return;
    }
    try {
      const checked = subs.slice(0, MAX_CHECK_SUBSCRIPTIONS);
      // The paced loop is silent for seconds per subscription, so say what is being checked —
      // otherwise the silence reads as a dead bot, and a capped check looks like a full one.
      if (subs.length > 1) {
        await ctx.reply(`Проверяю подписок: ${checked.length} из ${subs.length}…`);
      }
      let replied = false;
      for (const [i, sub] of checked.entries()) {
        // Pace like the daily run does: /check now runs against production sources, and a user
        // at the subscription limit would otherwise fire 50 requests back-to-back from our IP.
        if (i > 0) await pace(this.appConfig);
        replied = (await this.checkOne(ctx, sub)) || replied;
      }
      // Nothing was reported (no findings, no errors) — say so; otherwise it would contradict.
      if (!replied) await ctx.reply('Ничего нового.');
    } finally {
      this.status.finishPolling();
    }
  }

  /** Poll one subscription and reply with its outcome. Returns true if it replied anything. */
  private async checkOne(ctx: Context, sub: Subscription): Promise<boolean> {
    try {
      const outcome = await this.watch.poll(sub);
      if (outcome.kind === 'nothing') return false;
      if (outcome.kind === 'baselined') {
        await ctx.reply(
          `${sub.source} — объявлений сейчас: ${outcome.count}, дальше только новые.\n${sub.url}`,
          { link_preview_options: NO_LINK_PREVIEW },
        );
        return true;
      }
      const { delivered, error, markSeenError } = await deliverAndMark({
        listings: outcome.listings,
        send: (text) => ctx.reply(text, { link_preview_options: NO_LINK_PREVIEW }),
        markSeen: (items) => this.watch.markSeen(sub, items),
      });
      // A markSeen failure must not surface to the user as "could not check" (that would
      // contradict the digest they just read) — only log and report it.
      if (markSeenError) {
        this.logger.error(
          { err: markSeenError },
          `markSeen failed after /check delivery for ${sub.url}`,
        );
        this.reportCheck({
          err: markSeenError,
          ctx,
          sub,
          op: 'mark-seen',
          details: { resending: delivered.length },
        });
      }
      if (error) {
        this.logger.warn({ err: error }, `Delivery failed during /check for ${sub.url}`);
        this.reportCheck({
          err: error,
          ctx,
          sub,
          op: 'deliver',
          details: { deliveredBefore: delivered.length },
        });
        // Telegram itself may be what broke — an unguarded apology would throw too, abort the
        // rest of the /check loop and file a third Sentry event.
        await ctx
          .reply(
            delivered.length > 0
              ? 'Часть объявлений не отправилась — пришлю в следующую проверку.'
              : `Не получилось отправить объявления по поиску на ${sub.source} — попробуйте позже.`,
          )
          .catch(() => undefined);
      }
      return true;
    } catch (err) {
      this.logger.warn({ err }, `Check failed for ${sub.url}`);
      this.reportCheck({ err, ctx, sub });
      await ctx
        .reply(`Не получилось проверить поиск на ${sub.source} — попробуйте позже.\n${sub.url}`)
        .catch(() => undefined);
      return true;
    }
  }

  async onShowCurrent(ctx: Context, id: string | undefined): Promise<void> {
    const userId = ctx.from?.id;
    // Scoped to the sender: the id arrives in callback_data, so it is the caller's to forge.
    const sub =
      userId !== undefined && id !== undefined
        ? await this.subscriptions.findOwned(id, userId)
        : null;
    if (!sub) {
      // Guarded like the refusal below: a removed subscription is the canonical stale tap, so
      // this answer is the one most likely to be rejected as too old.
      await ctx.answerCallbackQuery('Подписка не найдена.').catch(() => undefined);
      return;
    }

    // Peek, never claim — the rule and its reason live on WatchStatus.isPollInProgress. The
    // residual race (a run starting while this fetch is in flight) costs one page-set of
    // requests: `current()` only reads, so unlike /check there is no seen-set race to lose.
    if (this.status.isPollInProgress) {
      // Same swallow as below: this button outlives its message, so a stale tap is the norm
      // here — an unguarded throw would file a Sentry event per late tap via bot.catch.
      await ctx.answerCallbackQuery(POLL_IN_PROGRESS).catch(() => undefined);
      return;
    }
    // Swallowed so the catch below can mean one thing only: the fetch failed.
    await ctx.answerCallbackQuery().catch(() => undefined);

    let listings: Listing[];
    try {
      listings = await this.watch.current(sub);
    } catch (err) {
      this.logger.warn({ err }, `Show-current failed for ${sub.url}`);
      reportUserFacing(err, { userId: ctx.from?.id, action: 'show-current', url: sub.url });
      // The channel may be the thing that broke — a failed apology must not escalate to bot.catch.
      await ctx
        .reply('Не получилось загрузить объявления — попробуйте позже.')
        .catch(() => undefined);
      return;
    }
    await ctx.reply(formatCurrentListings(listings), { link_preview_options: NO_LINK_PREVIEW });
  }

  /** Report a /check failure — same who/where for every operation, as WatchScheduler does. */
  private reportCheck({
    err,
    ctx,
    sub,
    op,
    details,
  }: {
    err: unknown;
    ctx: Context;
    sub: Subscription;
    op?: ReportOp;
    details?: Record<string, string | number>;
  }): void {
    reportUserFacing(err, {
      userId: ctx.from?.id,
      action: 'check',
      url: sub.url,
      op,
      details: { id: sub.id, source: sub.source, ...details },
    });
  }
}
