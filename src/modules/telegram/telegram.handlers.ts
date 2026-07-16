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

import {
  MAX_MESSAGE_BUDGET_CHARS,
  NO_LINK_PREVIEW,
  formatCurrentListings,
  formatStats,
  newListingsDigest,
} from './telegram.format';
import { WatchStatus } from './watch.status';

const PROMPT = 'Send me a kufar.by or realt.by search link and I will watch it.';
const EXPIRED = 'This prompt has expired — send the link again.';
// /list row cap — stays under Telegram's ~100-button inline-keyboard limit.
const MAX_LIST_ROWS = 50;
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
    bot.command('start', (ctx) => ctx.reply(`Hi! ${PROMPT}`));
    bot.command('list', (ctx) => this.showList(ctx));
    bot.command('stats', (ctx) => this.onStats(ctx));
    // NOTE: /check is a manual test trigger — kept out of production.
    if (!this.appConfig.isProduction) {
      bot.command('check', (ctx) => this.onCheck(ctx));
    }
    // NOTE: register commands before message:text — grammY runs the first matching handler only.
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.callbackQuery(/^subscribe:(.+)$/, (ctx) => this.onSubscribe(ctx));
    bot.callbackQuery(/^cancel:(.+)$/, (ctx) => this.onCancel(ctx));
    bot.callbackQuery(/^remove:(.+)$/, (ctx) => this.onRemove(ctx));
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
      await ctx.reply(`That source is not supported yet. ${PROMPT}`);
      return;
    }

    const nonce = this.addPending({ userId, source: adapter.id, url });
    const keyboard = new InlineKeyboard()
      .text('Subscribe', `subscribe:${nonce}`)
      .text('Cancel', `cancel:${nonce}`);
    await ctx.reply(`Watch this ${adapter.id} search?\n${url}`, {
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
        await ctx.editMessageText(`You're already watching this search.\n${candidate.url}`, {
          link_preview_options: NO_LINK_PREVIEW,
        });
        return;
      }
      if (err instanceof SubscriptionLimitError) {
        await ctx.editMessageText(
          `You've reached the limit of ${MAX_SUBSCRIPTIONS_PER_USER} subscriptions — remove one via /list first.`,
        );
        return;
      }
      throw err;
    }

    // NOTE: catch only the baseline — a failed message edit must fall through to bot.catch.
    // On failure the subscription is kept; the daily run baselines it silently.
    const count = await this.watch.baseline(sub).catch((err: unknown) => {
      this.logger.warn({ err }, `Baseline failed for ${sub.url}`);
      return null;
    });

    if (count === null) {
      await ctx.editMessageText(
        `Subscribed ✅ — the source didn't respond, I'll load current listings on the next run.\n${sub.url}`,
        { link_preview_options: NO_LINK_PREVIEW },
      );
      return;
    }
    // Offer the current listings on demand — baseline already counted them.
    const showCurrent =
      count > 0
        ? new InlineKeyboard().text(`Show current (${count})`, `show:${sub.id}`)
        : undefined;
    await ctx.editMessageText(
      `Subscribed ✅ watching ${count} current ${sub.source} listings.\n${sub.url}`,
      { link_preview_options: NO_LINK_PREVIEW, reply_markup: showCurrent },
    );
  }

  private async onCancel(ctx: Context): Promise<void> {
    // Same guard as onSubscribe — an expired or foreign tap must not wipe the owner's prompt.
    if (!this.takePending(ctx)) {
      await ctx.answerCallbackQuery(EXPIRED);
      return;
    }
    await ctx.editMessageText('Cancelled.');
    await ctx.answerCallbackQuery();
  }

  private async showList(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    // Anonymous senders (e.g. channel posts) have no subscriptions to list.
    if (userId === undefined) return;

    const subs = await this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.reply(`No subscriptions yet. ${PROMPT}`);
      return;
    }

    // Stay under Telegram's 4096-char message limit — an oversized reply throws and
    // the user loses /list (their only way to remove subscriptions).
    const keyboard = new InlineKeyboard();
    const lines: string[] = [];
    let length = 0;
    for (const [i, sub] of subs.entries()) {
      const line = `#${i + 1} — ${sub.source}\n${sub.url}`;
      if (length + line.length > MAX_MESSAGE_BUDGET_CHARS || i >= MAX_LIST_ROWS) {
        lines.push(`…and ${subs.length - i} more — remove some to see the rest`);
        break;
      }
      keyboard.text(`❌ #${i + 1}`, `remove:${sub.id}`).row();
      lines.push(line);
      length += line.length + '\n\n'.length;
    }
    await ctx.reply(lines.join('\n\n'), {
      reply_markup: keyboard,
      link_preview_options: NO_LINK_PREVIEW,
    });
  }

  /** Admin-only service snapshot. Silent for everyone else — don't reveal the command. */
  private async onStats(ctx: Context): Promise<void> {
    const adminId = this.appConfig.adminTelegramId;
    if (adminId === undefined || ctx.from?.id !== adminId) return;

    const [users, active, paused] = await Promise.all([
      this.subscriptions.countUsers(),
      this.subscriptions.countActive(),
      this.subscriptions.countPaused(),
    ]);
    await ctx.reply(formatStats({ users, active, paused, lastRunAt: this.status.lastRunAt }));
  }

  private async onCheck(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    // Anonymous senders have no subscriptions to check.
    if (userId === undefined) return;

    const subs = await this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.reply(`No subscriptions yet. ${PROMPT}`);
      return;
    }

    let replied = false;
    for (const sub of subs) {
      replied = (await this.checkOne(ctx, sub)) || replied;
    }
    // Nothing was reported (no findings, no errors) — say so; otherwise it would contradict.
    if (!replied) await ctx.reply('Nothing new.');
  }

  /** Poll one subscription and reply with its outcome. Returns true if it replied anything. */
  private async checkOne(ctx: Context, sub: Subscription): Promise<boolean> {
    try {
      const outcome = await this.watch.poll(sub);
      if (outcome.kind === 'nothing') return false;
      if (outcome.kind === 'baselined') {
        await ctx.reply(
          `Watching ${outcome.count} current ${sub.source} listings — new ones from now on.\n${sub.url}`,
          { link_preview_options: NO_LINK_PREVIEW },
        );
        return true;
      }
      const { text, delivered } = newListingsDigest(outcome.listings);
      await ctx.reply(text, { link_preview_options: NO_LINK_PREVIEW });
      // The digest is delivered — a failed markSeen must not surface as "Could not check"
      // (that would contradict what the user just saw). Log it; the items resurface next run.
      try {
        await this.watch.markSeen(sub, delivered);
      } catch (err) {
        this.logger.warn({ err }, `markSeen failed after /check delivery for ${sub.url}`);
      }
      return true;
    } catch (err) {
      this.logger.warn({ err }, `Check failed for ${sub.url}`);
      await ctx.reply(`Could not check this ${sub.source} search — try again later.\n${sub.url}`);
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
      await ctx.answerCallbackQuery('Subscription not found.');
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const listings = await this.watch.current(sub);
      const message =
        listings.length > 0 ? formatCurrentListings(listings) : 'No current listings.';
      await ctx.reply(message, { link_preview_options: NO_LINK_PREVIEW });
    } catch (err) {
      this.logger.warn({ err }, `Show-current failed for ${sub.url}`);
      await ctx.reply('Could not load current listings — try again later.');
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
    await ctx.answerCallbackQuery(removed ? 'Removed' : 'Already gone');
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
