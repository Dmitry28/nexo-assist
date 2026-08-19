import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import { extractUrl } from '@/common/url';
import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import type { SourceId } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import {
  DuplicateSubscriptionError,
  MAX_SUBSCRIPTIONS_PER_USER,
  SubscriptionLimitError,
  SubscriptionsService,
} from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { pace } from './pacing';
import { reportUserFacing } from './report';
import {
  HELP_MESSAGE,
  MAX_MESSAGE_BUDGET_CHARS,
  NO_LINK_PREVIEW,
  formatCurrentListings,
  formatStats,
  newListingsDigest,
} from './telegram.format';
import { WatchStatus } from './watch.status';

// NOTE: user-facing text is Russian — the beta audience is the kufar.by/realt.by one.
// Per-profile language: PRODUCT_PLAN.md § Фаза 7 «i18n».
const PROMPT =
  'Пришлите ссылку на поиск с kufar.by или realt.by — буду следить за новыми объявлениями.';
const EXPIRED = 'Кнопка устарела — пришлите ссылку ещё раз.';
// /list button cap — Telegram rejects an inline keyboard of ~100+ buttons, and a rejected
// reply costs the user /list entirely. Counted in buttons, not rows: a paused row carries two
// (❌ and ▶️), and paused subscriptions are not capped per user (the limit counts active ones).
const MAX_LIST_BUTTONS = 90;
// How many subscriptions one /check polls. grammY handles updates sequentially, so the paced
// loop blocks every other user meanwhile; at MAX_SUBSCRIPTIONS_PER_USER that would be minutes.
// Five bounds it to four pacing gaps plus five fetches — enough to prove the chain works,
// which is what /check is for.
const MAX_CHECK_SUBSCRIPTIONS = 5;

// Bound for the pending-confirmation map — evict the oldest entry beyond this.
const MAX_PENDING = 500;

interface PendingLink {
  userId: number;
  source: SourceId;
  url: string;
}

/** Bot conversation: turn a pasted link into a subscription via inline buttons. */
@Injectable()
export class TelegramHandlers {
  private readonly logger = new Logger(TelegramHandlers.name);
  // NOTE: links awaiting a Subscribe/Cancel tap, keyed by a per-prompt nonce carried in
  // callback_data (too small for a URL) — so an old prompt can't subscribe a newer link.
  private readonly pending = new Map<string, PendingLink>();

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly subscriptions: SubscriptionsService,
    private readonly watch: WatchService,
    private readonly registry: SourceRegistry,
    private readonly status: WatchStatus,
  ) {}

  register(bot: Bot): void {
    bot.command('start', (ctx) => ctx.reply(`Привет! ${PROMPT}\nЧто я умею — /help`));
    bot.command('help', (ctx) =>
      ctx.reply(HELP_MESSAGE, { link_preview_options: NO_LINK_PREVIEW }),
    );
    bot.command('list', (ctx) => this.showList(ctx));
    bot.command('stats', (ctx) => this.onStats(ctx));
    // NOTE: /check polls sources on demand, so it never reaches the public: outside production
    // anyone may use it (dev convenience), in production only the owner — the one place where
    // "does the whole chain still work?" has to be answerable without waiting for the cron.
    // Production only, deliberately: there is no staging stage yet (same caveat as
    // SCRAPE_PROXY_URL in env.validation.ts). A staging overlay would publish an on-demand
    // scraping command to every user, so revisit in the change that first deploys one.
    bot.command('check', (ctx) => this.onCheck(ctx));
    // NOTE: register commands before message:text — grammY runs the first matching handler only.
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.callbackQuery(/^subscribe:(.+)$/, (ctx) => this.onSubscribe(ctx));
    bot.callbackQuery(/^cancel:(.+)$/, (ctx) => this.onCancel(ctx));
    bot.callbackQuery(/^remove:(.+)$/, (ctx) => this.onRemove(ctx));
    bot.callbackQuery(/^resume:(.+)$/, (ctx) => this.onResume(ctx));
    bot.callbackQuery(/^show:(.+)$/, (ctx) => this.onShowCurrent(ctx));
  }

  private async onText(ctx: Context): Promise<void> {
    const text = ctx.message?.text;
    const userId = ctx.from?.id;
    // Non-text updates / anonymous senders — nothing to act on.
    if (!text || userId === undefined) return;

    const url = extractUrl(text);
    if (!url) {
      await ctx.reply(PROMPT);
      return;
    }
    const adapter = this.registry.match(url);
    if (!adapter) {
      await ctx.reply(`Этот сайт пока не поддерживается. ${PROMPT}`);
      return;
    }

    const nonce = this.addPending({ userId, source: adapter.id, url });
    const keyboard = new InlineKeyboard()
      .text('Следить', `subscribe:${nonce}`)
      .text('Отмена', `cancel:${nonce}`);
    await ctx.reply(`Следить за этим поиском на ${adapter.id}?\n${url}`, {
      reply_markup: keyboard,
      link_preview_options: NO_LINK_PREVIEW,
    });
  }

  private async onSubscribe(ctx: Context): Promise<void> {
    const candidate = this.takePending(ctx);
    if (!candidate) {
      await ctx.answerCallbackQuery(EXPIRED);
      return;
    }
    // Answer right away — Telegram invalidates callbacks after ~15s and the baseline
    // fetch below can take longer; a late answer leaves the button spinning forever.
    // The answer is cosmetic: if it fails (late/duplicate callback), still subscribe.
    await ctx.answerCallbackQuery().catch(() => undefined);

    // ctx.from is the owner (takePending checked it) — capture their profile.
    let sub: Subscription;
    try {
      sub = await this.subscriptions.add({
        user: {
          telegramId: candidate.userId,
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          lastName: ctx.from?.last_name,
          language: ctx.from?.language_code,
        },
        source: candidate.source,
        url: candidate.url,
      });
    } catch (err) {
      if (err instanceof DuplicateSubscriptionError) {
        await ctx.editMessageText(`Вы уже следите за этим поиском.\n${candidate.url}`, {
          link_preview_options: NO_LINK_PREVIEW,
        });
        return;
      }
      if (err instanceof SubscriptionLimitError) {
        await ctx.editMessageText(
          `Достигнут предел — ${MAX_SUBSCRIPTIONS_PER_USER} подписок. Удалите одну через /list.`,
        );
        return;
      }
      throw err;
    }

    // NOTE: catch only the baseline — a failed message edit must fall through to bot.catch.
    // On failure the subscription is kept; the daily run baselines it silently.
    const count = await this.watch.baseline(sub).catch((err: unknown) => {
      this.logger.warn({ err }, `Baseline failed for ${sub.url}`);
      reportUserFacing(err, { userId: candidate.userId, action: 'subscribe', url: sub.url });
      return null;
    });

    if (count === null) {
      await ctx.editMessageText(
        `Готово ✅ Сайт сейчас не отвечает — загружу текущие объявления при следующей проверке.\n${sub.url}`,
        { link_preview_options: NO_LINK_PREVIEW },
      );
      return;
    }
    // Offer the current listings on demand — baseline already counted them.
    const showCurrent =
      count > 0
        ? new InlineKeyboard().text(`Показать текущие (${count})`, `show:${sub.id}`)
        : undefined;
    await ctx.editMessageText(
      `Готово ✅ Объявлений сейчас: ${count} — сообщу, когда появятся новые.\n${sub.url}`,
      { link_preview_options: NO_LINK_PREVIEW, reply_markup: showCurrent },
    );
  }

  private async onCancel(ctx: Context): Promise<void> {
    // Same guard as onSubscribe — an expired or foreign tap must not wipe the owner's prompt.
    if (!this.takePending(ctx)) {
      await ctx.answerCallbackQuery(EXPIRED);
      return;
    }
    await ctx.editMessageText('Отменено.');
    await ctx.answerCallbackQuery();
  }

  private async showList(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    // Anonymous senders (e.g. channel posts) have no subscriptions to list.
    if (userId === undefined) return;

    const subs = await this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.reply(`Пока нет ни одной подписки. ${PROMPT}`);
      return;
    }

    // Stay under Telegram's 4096-char message limit — an oversized reply throws and
    // the user loses /list (their only way to remove subscriptions).
    const keyboard = new InlineKeyboard();
    const lines: string[] = [];
    let length = 0;
    let buttons = 0;
    let anyPaused = false;
    for (const [i, sub] of subs.entries()) {
      // A paused subscription delivers nothing; without the mark it looks live and the user
      // waits for notifications that will never come.
      const paused = Boolean(sub.pausedAt);
      const line = `#${i + 1} — ${sub.source}${paused ? ' ⏸ на паузе' : ''}\n${sub.url}`;
      const rowButtons = paused ? 2 : 1;
      if (
        length + line.length > MAX_MESSAGE_BUDGET_CHARS ||
        buttons + rowButtons > MAX_LIST_BUTTONS
      ) {
        lines.push(`…и ещё ${subs.length - i} — удалите часть, чтобы увидеть остальные`);
        break;
      }
      keyboard.text(`❌ #${i + 1}`, `remove:${sub.id}`);
      if (paused) {
        keyboard.text(`▶️ #${i + 1}`, `resume:${sub.id}`);
        anyPaused = true;
      }
      keyboard.row();
      buttons += rowButtons;
      lines.push(line);
      length += line.length + '\n\n'.length;
    }
    if (anyPaused) lines.push('▶️ — возобновить, ❌ — удалить');
    await ctx.reply(lines.join('\n\n'), {
      reply_markup: keyboard,
      link_preview_options: NO_LINK_PREVIEW,
    });
  }

  /** The owner, per ADMIN_TELEGRAM_ID. No admin configured — nobody qualifies. */
  private isAdmin(ctx: Context): boolean {
    const adminId = this.appConfig.adminTelegramId;
    return adminId !== undefined && ctx.from?.id === adminId;
  }

  /** Admin-only service snapshot. Silent for everyone else — don't reveal the command. */
  private async onStats(ctx: Context): Promise<void> {
    if (!this.isAdmin(ctx)) return;

    const [users, active, paused] = await Promise.all([
      this.subscriptions.countUsers(),
      this.subscriptions.countActive(),
      this.subscriptions.countPaused(),
    ]);
    await ctx.reply(formatStats({ users, active, paused, lastRunAt: this.status.lastRunAt }));
  }

  private async onCheck(ctx: Context): Promise<void> {
    // Silent for non-owners in production, like /stats — an explicit refusal would advertise
    // a command that hits sources.
    if (this.appConfig.isProduction && !this.isAdmin(ctx)) return;

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
      await ctx.reply('Проверка уже идёт — подождите её окончания.');
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
      const { text, delivered } = newListingsDigest(outcome.listings);
      await ctx.reply(text, { link_preview_options: NO_LINK_PREVIEW });
      // The digest is delivered — a failed markSeen must not surface as "Could not check"
      // (that would contradict what the user just saw). Report it; the items resurface next run.
      try {
        await this.watch.markSeen(sub, delivered);
      } catch (err) {
        this.logger.error({ err }, `markSeen failed after /check delivery for ${sub.url}`);
        reportUserFacing(err, {
          userId: ctx.from?.id,
          action: 'check',
          url: sub.url,
          op: 'mark-seen',
          details: { id: sub.id, source: sub.source, resending: delivered.length },
        });
      }
      return true;
    } catch (err) {
      this.logger.warn({ err }, `Check failed for ${sub.url}`);
      reportUserFacing(err, { userId: ctx.from?.id, action: 'check', url: sub.url });
      await ctx.reply(
        `Не получилось проверить поиск на ${sub.source} — попробуйте позже.\n${sub.url}`,
      );
      return true;
    }
  }

  private async onShowCurrent(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const id = this.matchParam(ctx);
    const sub =
      userId !== undefined && id !== undefined
        ? (await this.subscriptions.listByUser(userId)).find((s) => s.id === id)
        : undefined;
    if (!sub) {
      await ctx.answerCallbackQuery('Подписка не найдена.');
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const listings = await this.watch.current(sub);
      await ctx.reply(formatCurrentListings(listings), { link_preview_options: NO_LINK_PREVIEW });
    } catch (err) {
      this.logger.warn({ err }, `Show-current failed for ${sub.url}`);
      reportUserFacing(err, { userId: ctx.from?.id, action: 'show-current', url: sub.url });
      await ctx.reply('Не получилось загрузить объявления — попробуйте позже.');
    }
  }

  private async onRemove(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const id = this.matchParam(ctx);
    // Malformed callback (no user / no id) — just clear the spinner.
    if (userId === undefined || id === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }

    const removed = await this.subscriptions.remove(id, userId);
    await ctx.answerCallbackQuery(removed ? 'Удалено' : 'Уже удалено');
  }

  private async onResume(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const id = this.matchParam(ctx);
    if (userId === undefined || id === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      const resumed = await this.subscriptions.resume(id, userId);
      await ctx.answerCallbackQuery(resumed ? 'Возобновлено' : 'Подписка не найдена');
    } catch (err) {
      if (err instanceof SubscriptionLimitError) {
        await ctx.answerCallbackQuery(`Предел — ${MAX_SUBSCRIPTIONS_PER_USER} активных подписок`);
        return;
      }
      throw err;
    }
  }

  /** The capture group of the matched callback_data pattern, if any. */
  private matchParam(ctx: Context): string | undefined {
    return Array.isArray(ctx.match) && typeof ctx.match[1] === 'string' ? ctx.match[1] : undefined;
  }

  private addPending(link: PendingLink): string {
    // Evict the oldest entry at the cap (Map preserves insertion order).
    if (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    const nonce = randomUUID().slice(0, 8);
    this.pending.set(nonce, link);
    return nonce;
  }

  /** Resolve and consume the pending link for this callback; null if expired or not the owner. */
  private takePending(ctx: Context): PendingLink | null {
    const nonce = this.matchParam(ctx);
    const entry = nonce !== undefined ? this.pending.get(nonce) : undefined;
    if (nonce === undefined || !entry || entry.userId !== ctx.from?.id) return null;
    this.pending.delete(nonce);
    return entry;
  }
}
