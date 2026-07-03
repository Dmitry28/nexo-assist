import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import { extractUrl } from '@/common/url';
import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import type { SourceId } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { NO_LINK_PREVIEW, formatCurrentListings, newListingsDigest } from './telegram.format';

const PROMPT = 'Send me a kufar.by or realt.by search link and I will watch it.';
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
  ) {}

  register(bot: Bot): void {
    bot.command('start', (ctx) => ctx.reply(`Hi! ${PROMPT}`));
    bot.command('list', (ctx) => this.showList(ctx));
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
      await ctx.answerCallbackQuery('This prompt has expired — send the link again.');
      return;
    }

    // TODO: dedup — skip if the user already has this url [L] (with the DB slice).
    const sub = this.subscriptions.add({
      telegramUserId: candidate.userId,
      source: candidate.source,
      url: candidate.url,
    });

    // NOTE: catch only the baseline — a failed message edit must fall through to bot.catch.
    // On failure the subscription is kept; the daily run baselines it silently.
    const baseline = await this.watch.baseline(sub).catch((err: unknown) => {
      this.logger.warn({ err }, `Baseline failed for ${sub.url}`);
      return null;
    });

    try {
      if (!baseline) {
        await ctx.editMessageText(
          `Subscribed ✅ — the source didn't respond, I'll load current listings on the next run.\n${sub.url}`,
          { link_preview_options: NO_LINK_PREVIEW },
        );
        return;
      }
      const message = baseline.supported
        ? `Subscribed ✅ watching ${baseline.count} current ${sub.source} listings.\n${sub.url}`
        : `Saved ✅ — ${sub.source} watching isn't available yet; I'll start once it's supported.\n${sub.url}`;
      // Offer the current listings on demand — baseline already counted them.
      const showCurrent =
        baseline.supported && baseline.count > 0
          ? new InlineKeyboard().text(`Show current (${baseline.count})`, `show:${sub.id}`)
          : undefined;
      await ctx.editMessageText(message, {
        link_preview_options: NO_LINK_PREVIEW,
        reply_markup: showCurrent,
      });
    } finally {
      // NOTE: always answer or the user's button keeps a spinner.
      await ctx.answerCallbackQuery();
    }
  }

  private async onCancel(ctx: Context): Promise<void> {
    this.takePending(ctx);
    await ctx.editMessageText('Cancelled.');
    await ctx.answerCallbackQuery();
  }

  private async showList(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    // Anonymous senders (e.g. channel posts) have no subscriptions to list.
    if (userId === undefined) return;

    const subs = this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.reply(`No subscriptions yet. ${PROMPT}`);
      return;
    }

    const keyboard = new InlineKeyboard();
    const lines = subs.map((sub, i) => {
      keyboard.text(`❌ #${i + 1}`, `remove:${sub.id}`).row();
      return `#${i + 1} — ${sub.source}\n${sub.url}`;
    });
    await ctx.reply(lines.join('\n\n'), {
      reply_markup: keyboard,
      link_preview_options: NO_LINK_PREVIEW,
    });
  }

  private async onCheck(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    // Anonymous senders have no subscriptions to check.
    if (userId === undefined) return;

    const subs = this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.reply(`No subscriptions yet. ${PROMPT}`);
      return;
    }

    let foundAny = false;
    let failedAny = false;
    for (const sub of subs) {
      try {
        // A failed on-subscribe baseline retries here — seed instead of flooding as "new".
        if (!sub.baselinedAt) {
          foundAny = true;
          const { count } = await this.watch.baseline(sub);
          await ctx.reply(
            `Watching ${count} current ${sub.source} listings — new ones from now on.\n${sub.url}`,
            { link_preview_options: NO_LINK_PREVIEW },
          );
          continue;
        }
        const fresh = await this.watch.check(sub);
        if (fresh.length > 0) {
          foundAny = true;
          const { text, delivered } = newListingsDigest(fresh);
          await ctx.reply(text, { link_preview_options: NO_LINK_PREVIEW });
          this.watch.markSeen(sub, delivered);
        }
      } catch (err) {
        failedAny = true;
        this.logger.warn({ err }, `Check failed for ${sub.url}`);
        await ctx.reply(`Could not check this ${sub.source} search — try again later.\n${sub.url}`);
      }
    }
    // Error replies already went out — a trailing "Nothing new." would contradict them.
    if (!foundAny && !failedAny) await ctx.reply('Nothing new.');
  }

  private async onShowCurrent(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const id = this.matchParam(ctx);
    const sub =
      userId !== undefined && id !== undefined
        ? this.subscriptions.listByUser(userId).find((s) => s.id === id)
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

    const removed = this.subscriptions.remove(id, userId);
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
