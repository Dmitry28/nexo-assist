import type { Bot } from 'grammy';
import { GrammyError } from 'grammy';

import { makeSubscription } from '@/__tests__/helpers/subscription';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { SubscriptionLimitError } from '@/modules/subscriptions/subscriptions.service';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';

import { MAX_LIST_BUTTONS } from '../list.format';
import { ListHandlers } from '../list.handlers';

import { makeCtx } from './fixtures/bot-ctx';
import { FakeBot } from './fixtures/fake-bot';

type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

const sub = (over: Partial<Subscription> = {}): Subscription =>
  makeSubscription({ id: 's1', url: 'https://re.kufar.by/l/grodno/kupit/dom', ...over });

describe('ListHandlers', () => {
  let subscriptions: {
    listByUser: jest.Mock;
    findOwned: jest.Mock;
    remove: jest.Mock;
    resume: jest.Mock;
    setKeywords: jest.Mock;
  };
  let handlers: ListHandlers;
  let bot: FakeBot;

  beforeEach(() => {
    subscriptions = {
      listByUser: jest.fn().mockResolvedValue([sub()]),
      findOwned: jest.fn().mockResolvedValue(sub()),
      remove: jest.fn().mockResolvedValue(true),
      resume: jest.fn().mockResolvedValue(true),
      setKeywords: jest.fn().mockResolvedValue(true),
    };
    handlers = new ListHandlers(subscriptions as unknown as SubscriptionsService);
    bot = new FakeBot();
    handlers.register(bot as unknown as Bot);
  });

  const press = async (data: string, from: number | 'anonymous' = 1) => {
    const entry = bot.callbacks.find((c) => c.pattern.test(data));
    if (!entry) throw new Error(`no handler for ${data}`);
    const ctx = makeCtx({
      userId: from === 'anonymous' ? undefined : from,
      match: data.match(entry.pattern) ?? undefined,
    });
    await entry.fn(ctx);
    return ctx;
  };
  const showList = async () => {
    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('list')!(ctx);
    return ctx.reply.mock.calls[0] as [string, { reply_markup: Keyboard; parse_mode: string }];
  };
  /** A text reply to the bot's message `replyTo` (its id and text). */
  const replyCtx = (text: string, replyTo: { message_id: number; text?: string }, userId = 1) => {
    const ctx = makeCtx({ text, userId });
    Object.assign(ctx.message!, { reply_to_message: replyTo });
    return ctx;
  };

  describe('/list', () => {
    it('names each subscription by a short linked label, not its whole URL', async () => {
      const [text, options] = await showList();

      expect(options.parse_mode).toBe('HTML');
      expect(text).toContain(
        '#1 <a href="https://re.kufar.by/l/grodno/kupit/dom">kufar.by · grodno/kupit/dom</a>',
      );
    });

    it('shows all 50 subscriptions in one message, a number button each', async () => {
      subscriptions.listByUser.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => sub({ id: `s${i}`, pausedAt: new Date() })),
      );

      const [text, options] = await showList();

      expect(text).toContain('#50 ');
      expect(text).not.toContain('…и ещё');
      const buttons = options.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(50); // Telegram rejects a keyboard of ~100 buttons
      expect(buttons[0]).toEqual({ text: '#1', callback_data: 'open:s0' });
    });

    // Paused subscriptions are not capped per user; a keyboard of ~100+ buttons is rejected.
    it(`caps the buttons at ${MAX_LIST_BUTTONS} and says how many more there are`, async () => {
      subscriptions.listByUser.mockResolvedValue(
        Array.from({ length: 120 }, (_, i) =>
          sub({ id: `s${i}`, url: `https://re.kufar.by/vi/${i}`, pausedAt: new Date() }),
        ),
      );

      const [text, options] = await showList();

      expect(options.reply_markup.inline_keyboard.flat()).toHaveLength(MAX_LIST_BUTTONS);
      expect(text).toContain(`…и ещё ${120 - MAX_LIST_BUTTONS}`);
    });

    it('marks a paused subscription and shows its filter', async () => {
      subscriptions.listByUser.mockResolvedValue([
        sub({ pausedAt: new Date(), keywords: 'бампер задний, крышка багажника' }),
      ]);

      const [text] = await showList();

      expect(text).toContain('</a> ⏸');
      expect(text).toContain('🔎 бампер задний · крышка багажника');
    });
  });

  describe('a subscription menu', () => {
    const menuButtons = (ctx: ReturnType<typeof makeCtx>) =>
      (
        ctx.editMessageText.mock.calls[0][1] as { reply_markup: Keyboard }
      ).reply_markup.inline_keyboard
        .flat()
        .map((b) => b.callback_data);

    it('offers remove and filter, resume only when paused, and the way back', async () => {
      expect(menuButtons(await press('open:s1'))).toEqual(['remove:s1', 'filter:s1', 'list']);

      subscriptions.listByUser.mockResolvedValue([sub({ pausedAt: new Date() })]);
      expect(menuButtons(await press('open:s1'))).toEqual([
        'remove:s1',
        'filter:s1',
        'resume:s1',
        'list',
      ]);
    });

    it('offers no filter on a watched single listing', async () => {
      subscriptions.listByUser.mockResolvedValue([sub({ url: 'https://re.kufar.by/vi/7' })]);

      expect(menuButtons(await press('open:s1'))).toEqual(['remove:s1', 'list']);
    });

    it('removes for the owner and goes back to the list', async () => {
      subscriptions.listByUser.mockResolvedValue([]);
      const ctx = await press('remove:s1');

      expect(subscriptions.remove).toHaveBeenCalledWith('s1', 1);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Удалено');
      expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Пока нет'));
    });

    // A tap queued behind a long handler is answered too late — the removal still shows.
    it.each(['remove:s1', 'resume:s1'])(
      're-renders after %s even when the tap can no longer be answered',
      async (data) => {
        subscriptions.listByUser.mockResolvedValue([]);
        const entry = bot.callbacks.find((c) => c.pattern.test(data));
        if (!entry) throw new Error(`no handler for ${data}`);
        const ctx = makeCtx({ userId: 1, match: data.match(entry.pattern) ?? undefined });
        ctx.answerCallbackQuery.mockRejectedValue(new Error('query is too old'));

        await entry.fn(ctx);

        expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Пока нет'));
      },
    );

    // An identical edit is a Telegram 400 («message is not modified») — one Sentry event per tap.
    it('answers «Уже удалено» on a repeated tap without editing the message again', async () => {
      subscriptions.remove.mockResolvedValue(false);
      const ctx = await press('remove:s1');

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Уже удалено');
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it('leaves the menu as it is when resume is refused', async () => {
      subscriptions.resume.mockRejectedValue(new SubscriptionLimitError());

      expect((await press('resume:s1')).editMessageText).not.toHaveBeenCalled();
    });

    it('swallows «message is not modified», and only that', async () => {
      const unchanged = new GrammyError(
        'x',
        { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
        'editMessageText',
        {},
      );
      const entry = bot.callbacks.find((c) => c.pattern.test('open:s1'))!;
      const ctx = makeCtx({ userId: 1, match: 'open:s1'.match(entry.pattern)! });
      ctx.editMessageText.mockRejectedValueOnce(unchanged);
      await expect(entry.fn(ctx)).resolves.toBeUndefined();

      ctx.editMessageText.mockRejectedValueOnce(new Error('network'));
      await expect(entry.fn(ctx)).rejects.toThrow('network');
    });

    it('resumes, and refuses at the active-subscription limit', async () => {
      expect((await press('resume:s1')).answerCallbackQuery).toHaveBeenCalledWith('Возобновлено');

      subscriptions.resume.mockRejectedValue(new SubscriptionLimitError());
      expect((await press('resume:s1')).answerCallbackQuery).toHaveBeenCalledWith(
        expect.stringContaining('Предел'),
      );
    });

    // The spinner is a tap's only feedback; an unanswered one reads as a dead bot.
    it.each(['open:s1', 'remove:s1', 'resume:s1', 'filter:s1'])(
      'clears the spinner on an anonymous %s tap',
      async (data) => {
        const ctx = await press(data, 'anonymous');

        expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
        expect(subscriptions.remove).not.toHaveBeenCalled();
      },
    );
  });

  describe('the keyword filter', () => {
    /** Tap 🔎 and return the prompt the bot sent (as a message with an id). */
    const askFilter = async () => {
      const entry = bot.callbacks.find((c) => c.pattern.test('filter:s1'))!;
      const ctx = makeCtx({ userId: 1, match: 'filter:s1'.match(entry.pattern)! });
      ctx.reply.mockResolvedValue({ message_id: 42 });
      await entry.fn(ctx);
      const [text, options] = ctx.reply.mock.calls[0] as [string, { reply_markup: unknown }];
      return { message_id: 42, text, options };
    };

    it('asks for words with a reply prompt — only a reply to it sets the filter', async () => {
      const prompt = await askFilter();
      expect(prompt.options.reply_markup).toMatchObject({ force_reply: true });

      const ctx = replyCtx('Бампер  задний, крышка багажника', prompt);
      await expect(handlers.onReply(ctx)).resolves.toBe(true);

      expect(subscriptions.setKeywords).toHaveBeenCalledWith(
        's1',
        1,
        'бампер задний, крышка багажника',
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Фильтр: бампер задний · крышка багажника'),
      );
    });

    it('clears the filter on «-»', async () => {
      const prompt = await askFilter();

      await handlers.onReply(replyCtx('-', prompt));

      expect(subscriptions.setKeywords).toHaveBeenCalledWith('s1', 1, null);
    });

    it('refuses an answer with no words, keeping the filter and the prompt', async () => {
      const prompt = await askFilter();
      const ctx = replyCtx(' , ,', prompt);

      await handlers.onReply(ctx);
      expect(subscriptions.setKeywords).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Не нашёл слов'));

      await handlers.onReply(replyCtx('бампер', prompt)); // the user simply replies again
      expect(subscriptions.setKeywords).toHaveBeenCalledWith('s1', 1, 'бампер');
    });

    it('leaves a message that is no reply to a prompt alone', async () => {
      await askFilter();

      await expect(handlers.onReply(makeCtx({ text: 'спасибо', userId: 1 }))).resolves.toBe(false);
      await expect(
        handlers.onReply(replyCtx('бампер', { message_id: 7, text: 'some card' })),
      ).resolves.toBe(false);
      expect(subscriptions.setKeywords).not.toHaveBeenCalled();
    });

    it('tells a reply to a prompt it no longer knows (a restart) to ask again', async () => {
      const prompt = await askFilter();
      const fresh = new ListHandlers(subscriptions as unknown as SubscriptionsService);
      const ctx = replyCtx('бампер', prompt);

      await expect(fresh.onReply(ctx)).resolves.toBe(true);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('устарела'));
      expect(subscriptions.setKeywords).not.toHaveBeenCalled();
    });

    it('tells «-» on a subscription deleted meanwhile that it is gone', async () => {
      const prompt = await askFilter();
      subscriptions.setKeywords.mockResolvedValue(false);
      const ctx = replyCtx('-', prompt);

      await handlers.onReply(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('не найдена'));
    });

    it('refuses a filter on a watched single listing, even from an old button', async () => {
      subscriptions.findOwned.mockResolvedValue(sub({ url: 'https://re.kufar.by/vi/7' }));
      const entry = bot.callbacks.find((c) => c.pattern.test('filter:s1'))!;
      const ctx = makeCtx({ userId: 1, match: 'filter:s1'.match(entry.pattern)! });

      await entry.fn(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('одним объявлением'));
    });

    // Message ids count per chat: two users' prompts can carry the same id.
    it('keeps two users’ prompts with the same message id apart', async () => {
      const mine = await askFilter(); // user 1, message 42
      subscriptions.findOwned.mockResolvedValue(sub({ id: 's2' }));
      const entry = bot.callbacks.find((c) => c.pattern.test('filter:s2'))!;
      const theirs = makeCtx({ userId: 2, match: 'filter:s2'.match(entry.pattern)! });
      theirs.reply.mockResolvedValue({ message_id: 42 });
      await entry.fn(theirs);

      await handlers.onReply(replyCtx('бампер', mine, 1));

      expect(subscriptions.setKeywords).toHaveBeenCalledWith('s1', 1, 'бампер');
    });

    it("ignores another user's reply to the prompt", async () => {
      const prompt = await askFilter();

      await handlers.onReply(replyCtx('бампер', prompt, 2));

      expect(subscriptions.setKeywords).not.toHaveBeenCalled();
    });
  });
});
