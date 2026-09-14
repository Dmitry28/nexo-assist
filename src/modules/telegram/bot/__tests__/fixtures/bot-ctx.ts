import type { Context } from 'grammy';

/** A grammY Context double with the reply/edit/answer calls a handler spec asserts on. */
export const makeCtx = (over: {
  text?: string;
  userId?: number;
  match?: RegExpMatchArray | string;
}) => {
  const ctx = {
    message: over.text !== undefined ? { text: over.text } : undefined,
    from: over.userId !== undefined ? { id: over.userId } : undefined,
    match: over.match,
    reply: jest.fn().mockResolvedValue(undefined),
    replyWithPhoto: jest.fn().mockResolvedValue(undefined),
    replyWithMediaGroup: jest.fn().mockResolvedValue(undefined),
    replyWithLocation: jest.fn().mockResolvedValue(undefined),
    editMessageText: jest.fn().mockResolvedValue(undefined),
    answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  };
  return ctx as unknown as Context & typeof ctx;
};
