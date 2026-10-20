import { Injectable } from '@nestjs/common';
import { GrammyError, InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';

import { watchedItem } from '@/modules/sources/sources';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { parseKeywords, storeKeywords } from '@/modules/subscriptions/keyword-filter';
import {
  MAX_SUBSCRIPTIONS_PER_USER,
  ProtectedLimitError,
  SubscriptionLimitError,
  SubscriptionsService,
} from '@/modules/subscriptions/subscriptions.service';

import { callbackParam } from './callback-param';
import { formatSubscriptionList, formatSubscriptionMenu } from './list.format';
import { NO_LINK_PREVIEW, PROMPT, PROTECTED_LIMIT_TEXT } from './telegram.format';

// Number buttons per keyboard row in /list (at most MAX_LIST_BUTTONS of them, list.format.ts).
const LIST_BUTTONS_PER_ROW = 5;
// A reply to a filter prompt older than this is stale, like an expired «Следить» button.
const FILTER_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;
// Opens every filter prompt — how a reply to one is recognised after a restart cleared the map.
const FILTER_PROMPT_HEAD = '🔎 Фильтр по словам';
const FILTER_PROMPT =
  `${FILTER_PROMPT_HEAD} — ответьте на это сообщение словами через запятую: буду присылать ` +
  'только объявления, где они есть (порядок слов не важен, можно начало слова — «лобов стекл»). ' +
  'Например: бампер задний, крышка багажника. «-» — снять фильтр.';
const HTML = { parse_mode: 'HTML', link_preview_options: NO_LINK_PREVIEW } as const;
const NOT_FOUND = 'Подписка не найдена — возможно, она удалена.';

const promptKey = (userId: number, messageId: number): string => `${userId}:${messageId}`;

/**
 * Swallow Telegram's «message is not modified» — the same tap twice (a double tap, a stale menu)
 * asks for an identical edit; anything else is a real failure and is rethrown to bot.catch.
 */
const unchanged = (err: unknown): void => {
  if (err instanceof GrammyError && err.description.includes('message is not modified')) return;
  throw err;
};

interface FilterPrompt {
  subscriptionId: Subscription['id'];
  userId: number;
  at: number;
}

/**
 * /list and everything a listed subscription offers: a menu per subscription (remove, keyword
 * filter, resume), and the filter set by replying to the bot's prompt — a reply, so a stray
 * message is never taken for a filter.
 */
@Injectable()
export class ListHandlers {
  // NOTE: in memory, like PendingLinks: a restart forgets open prompts, and a late reply is told so.
  // Keyed by user and message: a message id is counted per chat, so two users' prompts can share one.
  private readonly prompts = new Map<string, FilterPrompt>();

  constructor(private readonly subscriptions: SubscriptionsService) {}

  register(bot: Bot): void {
    bot.command('list', (ctx) => this.showList(ctx));
    bot.callbackQuery(/^list$/, (ctx) => this.onBackToList(ctx));
    bot.callbackQuery(/^open:(.+)$/, (ctx) => this.onOpen(ctx));
    bot.callbackQuery(/^remove:(.+)$/, (ctx) => this.onRemove(ctx));
    bot.callbackQuery(/^resume:(.+)$/, (ctx) => this.onResume(ctx));
    bot.callbackQuery(/^filter:(.+)$/, (ctx) => this.onFilter(ctx));
  }

  /** A reply to a filter prompt sets that filter. True when the message was one (handled). */
  async onReply(ctx: Context): Promise<boolean> {
    const reply = ctx.message?.reply_to_message;
    const text = ctx.message?.text;
    const userId = ctx.from?.id;
    if (!reply || text === undefined || userId === undefined) return false;
    const key = promptKey(userId, reply.message_id);
    const prompt = this.prompts.get(key);
    if (!prompt || Date.now() - prompt.at > FILTER_PROMPT_TTL_MS) {
      if (!reply.text?.startsWith(FILTER_PROMPT_HEAD)) return false;
      await ctx.reply('Кнопка устарела — откройте /list и нажмите 🔎 ещё раз.');
      return true;
    }
    if (text.trim() === '-') {
      const cleared = await this.subscriptions.setKeywords(prompt.subscriptionId, userId, null);
      this.prompts.delete(key);
      await ctx.reply(cleared ? 'Фильтр снят — приходит всё.' : NOT_FOUND);
      return true;
    }
    const phrases = parseKeywords(text);
    if (!phrases) {
      // The prompt stays open: the user may simply reply again.
      await ctx.reply('Не нашёл слов. Ответьте на сообщение выше словами через запятую.');
      return true;
    }
    const saved = await this.subscriptions.setKeywords(
      prompt.subscriptionId,
      userId,
      storeKeywords(phrases),
    );
    this.prompts.delete(key);
    await ctx.reply(
      saved
        ? `Фильтр: ${phrases.join(' · ')}\nУже виденные объявления не вернутся — фильтр действует на новые.`
        : NOT_FOUND,
    );
    return true;
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
    const { text, keyboard } = this.list(subs);
    await ctx.reply(text, { ...HTML, reply_markup: keyboard });
  }

  private async onBackToList(ctx: Context): Promise<void> {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await this.editToList(ctx);
  }

  private async onOpen(ctx: Context): Promise<void> {
    const target = await this.callbackTarget(ctx);
    if (!target) return;
    await ctx.answerCallbackQuery().catch(() => undefined);
    await this.editToMenu(ctx, target);
  }

  private async onRemove(ctx: Context): Promise<void> {
    const target = await this.callbackTarget(ctx);
    if (!target) return;
    const removed = await this.subscriptions.remove(target.id, target.userId);
    await ctx.answerCallbackQuery(removed ? 'Удалено' : 'Уже удалено');
    // Nothing changed on a repeated tap — an identical edit is a Telegram 400 (see unchanged).
    if (removed) await this.editToList(ctx);
  }

  private async onResume(ctx: Context): Promise<void> {
    const target = await this.callbackTarget(ctx);
    if (!target) return;
    let answer: string;
    let resumed = false;
    try {
      resumed = await this.subscriptions.resume(target.id, target.userId);
      answer = resumed ? 'Возобновлено' : 'Подписка не найдена';
    } catch (err) {
      if (err instanceof SubscriptionLimitError) {
        answer = `Предел — ${MAX_SUBSCRIPTIONS_PER_USER} активных подписок`;
      } else if (err instanceof ProtectedLimitError) {
        answer = PROTECTED_LIMIT_TEXT;
      } else {
        // Answered before the rethrow, so the button does not spin until Telegram's timeout.
        await ctx.answerCallbackQuery().catch(() => undefined);
        throw err;
      }
    }
    await ctx.answerCallbackQuery(answer);
    // A refused resume leaves the menu as it was — re-rendering it would be an identical edit.
    if (resumed) await this.editToMenu(ctx, target);
  }

  private async onFilter(ctx: Context): Promise<void> {
    const target = await this.callbackTarget(ctx);
    if (!target) return;
    await ctx.answerCallbackQuery().catch(() => undefined);
    const sub = await this.subscriptions.findOwned(target.id, target.userId);
    if (!sub) {
      await ctx.reply(NOT_FOUND);
      return;
    }
    // The menu offers no 🔎 here; an old or forged tap must not filter a single watched listing.
    if (watchedItem(sub.source, sub.url)) {
      await ctx.reply('Это слежка за одним объявлением — фильтр к ней не применяется.');
      return;
    }
    const sent = await ctx.reply(FILTER_PROMPT, {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: 'бампер задний, крышка багажника',
      },
    });
    this.forgetStalePrompts();
    this.prompts.set(promptKey(target.userId, sent.message_id), {
      subscriptionId: sub.id,
      userId: target.userId,
      at: Date.now(),
    });
  }

  private list(subs: Subscription[]): { text: string; keyboard: InlineKeyboard } {
    const { text, shown } = formatSubscriptionList(subs);
    const keyboard = new InlineKeyboard();
    for (const [i, sub] of subs.slice(0, shown).entries()) {
      if (i > 0 && i % LIST_BUTTONS_PER_ROW === 0) keyboard.row();
      keyboard.text(`#${i + 1}`, `open:${sub.id}`);
    }
    return { text, keyboard };
  }

  private async editToList(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const subs = await this.subscriptions.listByUser(userId);
    if (subs.length === 0) {
      await ctx.editMessageText(`Пока нет ни одной подписки. ${PROMPT}`).catch(unchanged);
      return;
    }
    const { text, keyboard } = this.list(subs);
    await ctx.editMessageText(text, { ...HTML, reply_markup: keyboard }).catch(unchanged);
  }

  private async editToMenu(ctx: Context, target: { userId: number; id: string }): Promise<void> {
    const subs = await this.subscriptions.listByUser(target.userId);
    const index = subs.findIndex((sub) => sub.id === target.id);
    if (index === -1) {
      await this.editToList(ctx);
      return;
    }
    const sub = subs[index];
    const keyboard = new InlineKeyboard().text('❌ Удалить', `remove:${sub.id}`);
    // A single watched listing has nothing to filter.
    if (!watchedItem(sub.source, sub.url)) keyboard.text('🔎 Фильтр', `filter:${sub.id}`);
    if (sub.pausedAt) keyboard.text('▶️ Возобновить', `resume:${sub.id}`);
    keyboard.row().text('↩ К списку', 'list');
    await ctx
      .editMessageText(formatSubscriptionMenu(sub, index + 1), { ...HTML, reply_markup: keyboard })
      .catch(unchanged);
  }

  private forgetStalePrompts(): void {
    const now = Date.now();
    for (const [id, prompt] of this.prompts) {
      if (now - prompt.at > FILTER_PROMPT_TTL_MS) this.prompts.delete(id);
    }
  }

  /** Sender and callback param, or null after clearing the spinner on a malformed callback. */
  private async callbackTarget(ctx: Context): Promise<{ userId: number; id: string } | null> {
    const userId = ctx.from?.id;
    const id = callbackParam(ctx);
    if (userId === undefined || id === undefined) {
      await ctx.answerCallbackQuery();
      return null;
    }
    return { userId, id };
  }
}
