import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import type { SourceId } from '@/modules/subscriptions/entities/subscription.entity';
import { detectSource, extractUrl } from '@/modules/subscriptions/source-detection';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';

const PROMPT = 'Send me a kufar.by or realt.by search link and I will watch it.';
const NO_LINK_PREVIEW = { is_disabled: true } as const;

/** Bot conversation: turn a pasted link into a subscription via inline buttons. */
@Injectable()
export class TelegramHandlers {
  // NOTE: per-user link awaiting a Subscribe/Cancel tap — callback_data is too small for a URL.
  // TODO: bound this map (TTL/cap) before the bot goes public — unbounded per-user growth [M].
  private readonly pending = new Map<number, { source: SourceId; url: string }>();

  constructor(private readonly subscriptions: SubscriptionsService) {}

  register(bot: Bot): void {
    bot.command('start', (ctx) => ctx.reply(`Hi! ${PROMPT}`));
    bot.command('list', (ctx) => this.showList(ctx));
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

    const detected = detectSource(text);
    if (!detected) {
      await ctx.reply(extractUrl(text) ? `That source is not supported yet. ${PROMPT}` : PROMPT);
      return;
    }

    this.pending.set(userId, detected);
    const keyboard = new InlineKeyboard().text('Subscribe', 'subscribe').text('Cancel', 'cancel');
    await ctx.reply(`Watch this ${detected.source} search?\n${detected.url}`, {
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

    this.subscriptions.add({ telegramUserId: userId, ...candidate });
    this.pending.delete(userId);
    await ctx.editMessageText(
      `Subscribed to this ${candidate.source} search ✅\n${candidate.url}`,
      {
        link_preview_options: NO_LINK_PREVIEW,
      },
    );
    await ctx.answerCallbackQuery();
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
