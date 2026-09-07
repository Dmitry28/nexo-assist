import { autoRetry } from '@grammyjs/auto-retry';
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';

import { reportUserFacing } from './report';
import { BOT_COMMANDS, NO_LINK_PREVIEW } from './telegram.format';
import { TelegramHandlers } from './telegram.handlers';

/**
 * Owns the bot lifecycle (long-polling). Handlers live in TelegramHandlers.
 *
 * Stays disabled without a token or under tests, so CI and e2e never touch the
 * network. Long-polling suits local/dev; switch to webhook on k8s later.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramService.name);
  private bot?: Bot;

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly handlers: TelegramHandlers,
  ) {}

  onModuleInit(): void {
    // NOTE: skip under tests — bot.start() would open a long-polling network loop.
    if (this.appConfig.isTest) return;

    const token = this.appConfig.telegramBotToken;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — bot disabled.');
      return;
    }

    const bot = new Bot(token);
    // Respect Telegram rate limits automatically (waits out 429 retry_after).
    bot.api.config.use(autoRetry());
    this.handlers.register(bot);
    // Fill the "≡" menu so the commands are discoverable — without it /list exists but is
    // unreachable once the buttons scroll away. Fire-and-forget: an unreachable Telegram API
    // must not stop the bot from starting, and the menu is retried on the next boot.
    void bot.api
      .setMyCommands(BOT_COMMANDS)
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to publish the command menu'));
    // Last line of defence for the conversation: anything a handler didn't catch lands here.
    // Without reporting, a user just sees a dead button while we learn nothing.
    bot.catch((err) => {
      this.logger.error({ err }, 'Bot handler error');
      // Report the underlying error, not grammY's wrapper — Sentry groups by what actually
      // threw, otherwise every failure collapses into one meaningless "middleware error".
      reportUserFacing(err.error, { userId: err.ctx.from?.id, action: 'bot-update' });
    });

    // NOTE: assign before start() so a shutdown mid-init can still stop the polling loop.
    this.bot = bot;
    // NOTE: bot.start() runs the long-polling loop until stopped — do not await it here.
    void bot
      .start({ onStart: (me) => this.logger.log(`Bot @${me.username} started`) })
      .catch((err: unknown) => {
        // The bot is this app's sole job — a dead polling loop must not linger as a
        // healthy-looking process (probes see nothing). Exit; the orchestrator restarts us.
        // TODO [M]: a shutdown racing an in-flight start() makes grammY's setup reject (stop()
        // aborts it), so this exits DURING onApplicationShutdown — killing the TypeORM close and
        // any in-flight markSeen, and reporting a crash exit. Guard it with an isShuttingDown flag.
        // TODO [M]: logger.fatal + process.exit(1) bypasses main.ts's reportAndExit (bound only to
        // uncaughtException/unhandledRejection), so the one failure that kills the product
        // produces no Sentry event and no flush. Report and flush before exiting.
        this.logger.fatal({ err }, 'Bot polling stopped — exiting');
        process.exit(1);
      });
  }

  // TODO [L]: bot.stop() issues one more getUpdates with no abort signal, so an unreachable
  // Telegram API hangs shutdown until SIGKILL; and `this.bot` is never cleared, so a still-running
  // daily run keeps calling notify() into a torn-down transport instead of the "Bot is disabled"
  // throw. Stop with a timeout/abort and clear the field.
  async onApplicationShutdown(): Promise<void> {
    await this.bot?.stop();
  }

  /**
   * Send a message to a chat. Throws when the bot is disabled — a silent no-op
   * would let callers mark undelivered listings as seen and drop them for good.
   */
  async notify(chatId: number, text: string): Promise<void> {
    if (!this.bot) throw new Error('Bot is disabled — cannot deliver messages');
    await this.bot.api.sendMessage(chatId, text, { link_preview_options: NO_LINK_PREVIEW });
  }
}
