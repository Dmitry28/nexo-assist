import type { Context } from 'grammy';

/** The capture group of the matched callback_data pattern, if any. */
export const callbackParam = (ctx: Context): string | undefined =>
  Array.isArray(ctx.match) && typeof ctx.match[1] === 'string' ? ctx.match[1] : undefined;
