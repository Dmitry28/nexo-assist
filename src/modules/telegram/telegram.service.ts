import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';

import { NO_LINK_PREVIEW } from './telegram.format';
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
    this.handlers.register(bot);
    bot.catch((err) => this.logger.error({ err }, 'Bot handler error'));

    // NOTE: assign before start() so a shutdown mid-init can still stop the polling loop.
    this.bot = bot;
    // NOTE: bot.start() runs the long-polling loop until stopped — do not await it here.
    void bot
      .start({ onStart: (me) => this.logger.log(`Bot @${me.username} started`) })
      .catch((err: unknown) => {
        // The bot is this app's sole job — a dead polling loop must not linger as a
        // healthy-looking process (probes see nothing). Exit; the orchestrator restarts us.
        this.logger.fatal({ err }, 'Bot polling stopped — exiting');
        process.exit(1);
      });
  }

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
