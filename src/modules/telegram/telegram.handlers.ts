import { Inject, Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { Environment } from '@/config/env.validation';
import type { SourceId } from '@/modules/subscriptions/entities/subscription.entity';
import { extractUrl, sourceOf } from '@/modules/subscriptions/source-detection';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { formatNewListings } from './telegram.format';

const PROMPT = 'Send me a kufar.by or realt.by search link and I will watch it.';
const NO_LINK_PREVIEW = { is_disabled: true } as const;

/** Bot conversation: turn a pasted link into a subscription via inline buttons. */
@Injectable()
export class TelegramHandlers {
  // NOTE: per-user link awaiting a Subscribe/Cancel tap — callback_data is too small for a URL.
  // TODO: bound this map (TTL/cap) before the bot goes public — unbounded per-user growth [M].
  private readonly pending = new Map<number, { source: SourceId; url: string }>();

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly subscriptions: SubscriptionsService,
    private readonly watch: WatchService,
  ) {}

  register(bot: Bot): void {
    bot.command('start', (ctx) => ctx.reply(`Hi! ${PROMPT}`));
    bot.command('list', (ctx) => this.showList(ctx));
    // NOTE: /check is a manual test trigger — kept out of production.
    if (this.appConfig.env !== Environment.Production) {
      bot.command('check', (ctx) => this.onCheck(ctx));
    }
    // NOTE: register commands before message:text — grammY runs the first matching handler only.
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.callbackQuery('subscribe', (ctx) => this.onSubscribe(ctx));
    bot.callbackQuery('cancel', (ctx) => this.onCancel(ctx));
    bot.callbackQuery(/^remove:(.+)$/, (ctx) => this.onRemove(ctx));
  }

  private async onText(ctx: Context): Promise<void> {
    const text = ctx.message?.text;
    const userId = ctx.from?.id;
    if (!text || userId === undefined) return;

    const url = extractUrl(text);
    if (!url) {
      await ctx.reply(PROMPT);
      return;
    }
    const source = sourceOf(url);
    if (!source) {
      await ctx.reply(`That source is not supported yet. ${PROMPT}`);
      return;
    }

    this.pending.set(userId, { source, url });
    const keyboard = new InlineKeyboard().text('Subscribe', 'subscribe').text('Cancel', 'cancel');
    await ctx.reply(`Watch this ${source} search?\n${url}`, {
      reply_markup: keyboard,
      link_preview_options: NO_LINK_PREVIEW,
    });
  }

  private async onSubscribe(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const candidate = userId !== undefined ? this.pending.get(userId) : undefined;
    if (userId === undefined || !candidate) {
      await ctx.answerCallbackQuery('Nothing to subscribe to — send a link first.');
      return;
    }

    // TODO: dedup — skip if the user already has this url [L] (with the DB slice).
    const sub = this.subscriptions.add({ telegramUserId: userId, ...candidate });
    this.pending.delete(userId);

    try {
      const { supported, count } = await this.watch.baseline(sub);
      const message = supported
        ? `Subscribed ✅ watching ${count} current ${sub.source} listings.\n${sub.url}`
        : `Saved ✅ — ${sub.source} watching isn't available yet; I'll start once it's supported.\n${sub.url}`;
      await ctx.editMessageText(message, { link_preview_options: NO_LINK_PREVIEW });
    } catch {
      // Baseline fetch failed — keep the subscription; the daily run will seed it.
      await ctx.editMessageText(
        `Subscribed ✅ — current listings will load on the next run.\n${sub.url}`,
        {
          link_preview_options: NO_LINK_PREVIEW,
        },
      );
    } finally {
      // NOTE: always answer or the user's button keeps a spinner.
      await ctx.answerCallbackQuery();
    }
  }

  private async onCancel(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (userId !== undefined) this.pending.delete(userId);
    await ctx.editMessageText('Cancelled.');
    await ctx.answerCallbackQuery();
  }

  private async showList(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
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
    if (userId === undefined) return;

    const subs = this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.reply(`No subscriptions yet. ${PROMPT}`);
      return;
    }

    let foundAny = false;
    for (const sub of subs) {
      try {
        const fresh = await this.watch.check(sub);
        if (fresh.length > 0) {
          foundAny = true;
          await ctx.reply(formatNewListings(fresh), { link_preview_options: NO_LINK_PREVIEW });
        }
      } catch {
        await ctx.reply(`Could not check this ${sub.source} search — try again later.\n${sub.url}`);
      }
    }
    if (!foundAny) await ctx.reply('Nothing new.');
  }

  private async onRemove(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const id = Array.isArray(ctx.match) ? ctx.match[1] : undefined;
    if (userId === undefined || typeof id !== 'string') {
      await ctx.answerCallbackQuery();
      return;
    }

    const removed = this.subscriptions.remove(id, userId);
    await ctx.answerCallbackQuery(removed ? 'Removed' : 'Already gone');
  }
}
