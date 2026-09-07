import { Inject, Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import { extractUrl } from '@/common/url';
import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { SourceRegistry } from '@/modules/sources/source-registry';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import {
  DuplicateSubscriptionError,
  MAX_SUBSCRIPTIONS_PER_USER,
  SubscriptionLimitError,
  SubscriptionsService,
} from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { isAdmin } from './admin';
import { CheckHandlers } from './check.handlers';
import type { PendingLink } from './pending-links';
import { PendingLinks } from './pending-links';
import { reportUserFacing } from './report';
import {
  HELP_MESSAGE,
  MAX_MESSAGE_BUDGET_CHARS,
  NO_LINK_PREVIEW,
  PROMPT,
  formatStats,
} from './telegram.format';
import { WatchStatus } from './watch.status';

const EXPIRED = 'Кнопка устарела — пришлите ссылку ещё раз.';
// /list button cap — Telegram rejects an inline keyboard of ~100+ buttons, and a rejected
// reply costs the user /list entirely. Counted in buttons, not rows: a paused row carries two
// (❌ and ▶️), and paused subscriptions are not capped per user (the limit counts active ones).
const MAX_LIST_BUTTONS = 90;

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
    bot.command('check', (ctx) => this.check.onCheck(ctx));
    // NOTE: register commands before message:text — grammY runs the first matching handler only.
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.callbackQuery(/^subscribe:(.+)$/, (ctx) => this.onSubscribe(ctx));
    bot.callbackQuery(/^cancel:(.+)$/, (ctx) => this.onCancel(ctx));
    // TODO [L]: remove/resume pass the tapped id straight to a scoped query, so it reaches a
    // Postgres `uuid` column and raises 22P02 — one Sentry issue per malformed tap via bot.catch.
    // Match the uuid shape instead, so a malformed tap simply doesn't match. (`show:` is safe —
    // onShowCurrent filters an already-loaded list in JS and just answers «Подписка не найдена.».)
    bot.callbackQuery(/^remove:(.+)$/, (ctx) => this.onRemove(ctx));
    bot.callbackQuery(/^resume:(.+)$/, (ctx) => this.onResume(ctx));
    bot.callbackQuery(/^show:(.+)$/, (ctx) => this.check.onShowCurrent(ctx, this.matchParam(ctx)));
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

    const nonce = this.pending.add({ userId, source: adapter.id, url });
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
    // Answer first, like onSubscribe — a failed edit must not leave the button spinning.
    // The answer is cosmetic: if it fails (late/duplicate callback), still edit the prompt.
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.editMessageText('Отменено.');
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
    // TODO [L]: the legend is pushed after the "…и ещё N" overflow line, and `anyPaused` counts
    // only the rendered prefix — a user whose only paused subscription falls past the cut never
    // sees it. Compute it from all subs and insert the hint before the overflow line.
    if (anyPaused) lines.push('▶️ — возобновить, ❌ — удалить');
    await ctx.reply(lines.join('\n\n'), {
      reply_markup: keyboard,
      link_preview_options: NO_LINK_PREVIEW,
    });
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

  private async onRemove(ctx: Context): Promise<void> {
    const target = await this.callbackTarget(ctx);
    if (!target) return;

    const removed = await this.subscriptions.remove(target.id, target.userId);
    await ctx.answerCallbackQuery(removed ? 'Удалено' : 'Уже удалено');
  }

  private async onResume(ctx: Context): Promise<void> {
    const target = await this.callbackTarget(ctx);
    if (!target) return;
    try {
      const resumed = await this.subscriptions.resume(target.id, target.userId);
      await ctx.answerCallbackQuery(resumed ? 'Возобновлено' : 'Подписка не найдена');
    } catch (err) {
      if (err instanceof SubscriptionLimitError) {
        await ctx.answerCallbackQuery(`Предел — ${MAX_SUBSCRIPTIONS_PER_USER} активных подписок`);
        return;
      }
      // TODO [L]: this rethrow leaves the callback query unanswered, so the button spins until
      // Telegram's ~15s timeout — every other callback path answers exactly once. Answer first.
      throw err;
    }
  }

  /** Sender and callback param, or null after clearing the spinner on a malformed callback. */
  private async callbackTarget(
    ctx: Context,
  ): Promise<{ userId: number; id: Subscription['id'] } | null> {
    const userId = ctx.from?.id;
    const id = this.matchParam(ctx);
    if (userId === undefined || id === undefined) {
      await ctx.answerCallbackQuery();
      return null;
    }
    return { userId, id };
  }

  /** The capture group of the matched callback_data pattern, if any. */
  private matchParam(ctx: Context): string | undefined {
    return Array.isArray(ctx.match) && typeof ctx.match[1] === 'string' ? ctx.match[1] : undefined;
  }

  /** Consume the pending link of the tapped prompt; null if expired or not the owner. */
  private takePending(ctx: Context): PendingLink | null {
    return this.pending.take(this.matchParam(ctx), ctx.from?.id);
  }
}
