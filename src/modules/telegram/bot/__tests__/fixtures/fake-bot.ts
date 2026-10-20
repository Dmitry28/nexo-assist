import type { Context } from 'grammy';

export type Handler = (ctx: Context) => Promise<void> | void;

/** Captures the handlers grammY would register, so tests can drive them directly. */
export class FakeBot {
  readonly commands = new Map<string, Handler>();
  readonly callbacks: Array<{ pattern: RegExp; fn: Handler }> = [];
  onText!: Handler;

  command(name: string, fn: Handler): void {
    this.commands.set(name, fn);
  }
  on(_event: string, fn: Handler): void {
    this.onText = fn;
  }
  callbackQuery(pattern: RegExp, fn: Handler): void {
    this.callbacks.push({ pattern, fn });
  }
}
