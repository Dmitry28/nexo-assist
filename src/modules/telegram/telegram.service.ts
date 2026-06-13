import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { Environment } from '@/config/env.validation';

/**
 * Minimal Telegram bot (long-polling) — walking skeleton.
 * Replies to /start and echoes any text back.
 *
 * Stays disabled without a token or under tests, so CI and e2e never touch the
 * network. Long-polling is fine for local/dev; switch to webhook on k8s later.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramService.name);
  private bot?: Bot;

  constructor(@Inject(configuration.KEY) private readonly appConfig: AppConfig) {}

  onModuleInit(): void {
    if (this.appConfig.env === Environment.Test) return;

    const token = this.appConfig.telegramBotToken;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — bot disabled.');
      return;
    }

    const bot = new Bot(token);
    bot.command('start', (ctx) => ctx.reply('Hi! Send me a link to watch.'));
    bot.on('message:text', (ctx) => ctx.reply(ctx.message.text));
    bot.catch((err) => this.logger.error('Bot handler error', err));

    // bot.start() runs the long-polling loop until stopped — do not await it here.
    void bot
      .start({ onStart: (me) => this.logger.log(`Bot @${me.username} started`) })
      .catch((err: unknown) => this.logger.error('Bot stopped with error', err));
    this.bot = bot;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.bot?.stop();
  }
}
