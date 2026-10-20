import { Inject, Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import { extractUrl } from '@/common/url';
import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import {
  ListingGoneError,
  SearchRewrittenError,
  UnwatchableItemError,
  UnsupportedSearchError,
} from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import { watchedItem } from '@/modules/sources/sources';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import {
  DuplicateSubscriptionError,
  MAX_SUBSCRIPTIONS_PER_USER,
  ProtectedLimitError,
  SubscriptionLimitError,
  SubscriptionsService,
} from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';
import { reportUserFacing } from '@/modules/telegram/report';
import { WatchStatus } from '@/modules/telegram/watch/watch.status';

import { isAdmin } from './admin';
import { callbackParam } from './callback-param';
import { CheckHandlers } from './check.handlers';
import { ListHandlers } from './list.handlers';
import { formatPrice } from './listing-card';
import type { PendingLink } from './pending-links';
import { PendingLinks } from './pending-links';
import {
  HELP_MESSAGE,
  NO_LINK_PREVIEW,
  PROMPT,
  PROTECTED_LIMIT_TEXT,
  formatStats,
  searchRewrittenNotice,
  unwatchableNotice,
} from './telegram.format';

const EXPIRED = 'Кнопка устарела — пришлите ссылку ещё раз.';

/** Bot conversation: turn a pasted link into a subscription via inline buttons. */
@Injectable()
export class TelegramHandlers {
  private readonly logger = new Logger(TelegramHandlers.name);
  private readonly pending = new PendingLinks();

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly subscriptions: SubscriptionsService,
    private readonly watch: WatchService,
    private readonly registry: SourceRegistry,
    private readonly status: WatchStatus,
    private readonly check: CheckHandlers,
    private readonly list: ListHandlers,
  ) {}

  register(bot: Bot): void {
    bot.command('start', (ctx) => ctx.reply(`Привет! ${PROMPT}\nЧто я умею — /help`));
    bot.command('help', (ctx) =>
      ctx.reply(HELP_MESSAGE, { link_preview_options: NO_LINK_PREVIEW }),
    );
    // /list, its menus and the keyword filter (list.handlers.ts) — commands before message:text.
    this.list.register(bot);
    bot.command('stats', (ctx) => this.onStats(ctx));
    // NOTE: /check polls sources on demand, so it never reaches the public: outside production
    // anyone may use it (dev convenience), in production only the owner — the one place where
    // "does the whole chain still work?" has to be answerable without waiting for the cron.
    // Production only, deliberately: there is no staging stage yet (same caveat as
    // SCRAPE_PROXY_URL in env.validation.ts). A staging overlay would publish an on-demand
    // scraping command to every user, so revisit in the change that first deploys one.
    bot.command('check', (ctx) => this.check.onCheck(ctx));
    // NOTE: register commands before message:text — grammY runs the first matching handler only.
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.callbackQuery(/^subscribe:(.+)$/, (ctx) => this.onSubscribe(ctx));
    bot.callbackQuery(/^cancel:(.+)$/, (ctx) => this.onCancel(ctx));
    // TODO [L]: show: (and list.handlers' open/remove/resume/filter) pass the tapped id straight to
    // a scoped query, so it reaches a Postgres `uuid` column and raises 22P02 — one Sentry issue per
    // malformed tap via bot.catch. Match the uuid shape instead, so a malformed tap doesn't match.
    bot.callbackQuery(/^show:(.+)$/, (ctx) => this.check.onShowCurrent(ctx, callbackParam(ctx)));
  }

  private async onText(ctx: Context): Promise<void> {
    const text = ctx.message?.text;
    const userId = ctx.from?.id;
    // Non-text updates / anonymous senders — nothing to act on.
    if (!text || userId === undefined) return;
    // A reply to a filter prompt is the filter, not a link.
    if (await this.list.onReply(ctx)) return;

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

    // A link to one listing is stored in its canonical form, so two forms of it are one duplicate.
    const item = watchedItem(adapter.id, url);
    const nonce = this.pending.add({ userId, source: adapter.id, url: item?.url ?? url });
    const keyboard = new InlineKeyboard()
      .text('Следить', `subscribe:${nonce}`)
      .text('Отмена', `cancel:${nonce}`);
    const what = item ? 'ценой этого объявления' : 'этим поиском';
    await ctx.reply(`Следить за ${what} на ${adapter.id}?\n${url}`, {
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
        const what = watchedItem(candidate.source, candidate.url)
          ? 'этим объявлением'
          : 'этим поиском';
        await ctx.editMessageText(`Вы уже следите за ${what}.\n${candidate.url}`, {
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
      if (err instanceof ProtectedLimitError) {
        await ctx.editMessageText(PROTECTED_LIMIT_TEXT);
        return;
      }
      throw err;
    }

    // NOTE: catch only the baseline — a failed message edit must fall through to bot.catch.
    // On failure the subscription is kept (except a rewritten search, below); the daily run
    // baselines it silently.
    const baseline = await this.watch.baseline(sub).catch((err: unknown) => {
      if (
        err instanceof SearchRewrittenError ||
        err instanceof UnsupportedSearchError ||
        err instanceof ListingGoneError ||
        err instanceof UnwatchableItemError
      ) {
        return err;
      }
      this.logger.warn({ err }, `Baseline failed for ${sub.url}`);
      reportUserFacing(err, { userId: candidate.userId, action: 'subscribe', url: sub.url });
      return null;
    });

    if (baseline instanceof UnsupportedSearchError || baseline instanceof UnwatchableItemError) {
      // Not kept, like a rewritten search: every poll would answer the same.
      this.logger.log(`Rejected an unwatchable link: ${baseline.message}`);
      await this.subscriptions.remove(sub.id, candidate.userId);
      await ctx.editMessageText(
        unwatchableNotice(baseline, { source: sub.source, url: candidate.url }),
        {
          link_preview_options: NO_LINK_PREVIEW,
        },
      );
      return;
    }

    if (baseline instanceof SearchRewrittenError) {
      // Not kept: every poll would hit the same redirect, and the search behind it is not the
      // one the user chose. Removed before the message says so. If `add` revived the user's
      // paused subscription to this URL, that one goes too — it is just as broken.
      // No Sentry: the link is the user's input, not our defect; the log keeps a trace.
      this.logger.log(`Rejected a rewritten search: ${baseline.from} → ${baseline.to}`);
      await this.subscriptions.remove(sub.id, candidate.userId);
      await ctx.editMessageText(searchRewrittenNotice({ from: candidate.url, to: baseline.to }), {
        link_preview_options: NO_LINK_PREVIEW,
      });
      return;
    }
    if (baseline instanceof ListingGoneError) {
      await this.subscriptions.remove(sub.id, candidate.userId);
      await ctx.editMessageText(`Это объявление уже снято — следить не за чем.\n${candidate.url}`, {
        link_preview_options: NO_LINK_PREVIEW,
      });
      return;
    }
    if (baseline === null) {
      await ctx.editMessageText(
        `Готово ✅ Сайт сейчас не отвечает — загружу текущие объявления при следующей проверке.\n${sub.url}`,
        { link_preview_options: NO_LINK_PREVIEW },
      );
      return;
    }
    const [watched] = baseline;
    if (watchedItem(sub.source, sub.url) && watched) {
      await ctx.editMessageText(
        `Готово ✅ Слежу за объявлением «${watched.title}» — сейчас ${formatPrice(watched)}. ` +
          `Напишу, если цена изменится или его снимут.\n${sub.url}`,
        { link_preview_options: NO_LINK_PREVIEW },
      );
      return;
    }
    // Offer the current listings on demand — baseline already counted them.
    const count = baseline.length;
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
    // Answer first, like onSubscribe — a failed edit must not leave the button spinning.
    // The answer is cosmetic: if it fails (late/duplicate callback), still edit the prompt.
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.editMessageText('Отменено.');
  }

  /** Admin-only service snapshot. Silent for everyone else — don't reveal the command. */
  private async onStats(ctx: Context): Promise<void> {
    if (!isAdmin({ senderId: ctx.from?.id, adminId: this.appConfig.adminTelegramId })) return;

    const [users, active, paused] = await Promise.all([
      this.subscriptions.countUsers(),
      this.subscriptions.countActive(),
      this.subscriptions.countPaused(),
    ]);
    await ctx.reply(formatStats({ users, active, paused, lastRunAt: this.status.lastRunAt }));
  }

  /** Consume the pending link of the tapped prompt; null if expired or not the owner. */
  private takePending(ctx: Context): PendingLink | null {
    return this.pending.take(callbackParam(ctx), ctx.from?.id);
  }
}
