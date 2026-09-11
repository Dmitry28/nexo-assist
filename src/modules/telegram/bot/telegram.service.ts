import { autoRetry } from '@grammyjs/auto-retry';
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Bot } from 'grammy';
import type { Api } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { SENTRY_FLUSH_MS, reportUserFacing } from '@/modules/telegram/report';

import type { CardSender, ListingMessage } from './send-card';
import { sendCard } from './send-card';
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
  private shuttingDown = false;

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly handlers: TelegramHandlers,
  ) {}

  onModuleInit(): void {
    // NOTE: skip under tests — bot.start() would open a long-polling network loop.
    if (this.appConfig.isTest) return;
    // Reset in case a shutdown already ran in this process: otherwise a genuinely dead polling
    // loop would be swallowed below and the pod would linger looking healthy.
    this.shuttingDown = false;

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
        // A shutdown aborts start()'s setup, so grammY rejects here on the way out. Exiting on
        // that would kill the rest of the shutdown (the TypeORM close, an in-flight markSeen)
        // and report a crash exit for an orderly stop.
        if (this.shuttingDown) {
          this.logger.log('Bot polling stopped by shutdown');
          return;
        }
        // The bot is this app's sole job — a dead polling loop must not linger as a
        // healthy-looking process (probes see nothing). Exit; the orchestrator restarts us.
        this.logger.fatal({ err }, 'Bot polling stopped — exiting');
        // A deliberate exit reports nothing on its own: main.ts's fatal handlers are bound to
        // uncaughtException/unhandledRejection, which process.exit fires neither of. Without
        // this, the one failure that kills the whole product leaves no trace outside the pod.
        Sentry.captureException(err);
        void Sentry.flush(SENTRY_FLUSH_MS).finally(() => process.exit(1));
      });
  }

  // TODO [L]: bot.stop() issues one more getUpdates with no abort signal, so an unreachable
  // Telegram API hangs shutdown until Kubernetes' grace period runs out and SIGKILLs us. Stop
  // with a timeout/abort.
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    const bot = this.bot;
    // Cleared before the stop, so a run still in flight gets notify()'s throw instead of sending
    // into a transport being torn down — a throw leaves the listings unsent and unmarked, and
    // they arrive next run.
    this.bot = undefined;
    // That last getUpdates can also reject outright, and an onApplicationShutdown that rejects
    // makes Nest abandon the rest of the shutdown — the TypeORM close, an in-flight markSeen.
    // Failing to say goodbye to Telegram is not worth that.
    await bot?.stop().catch((err: unknown) => this.logger.warn({ err }, 'Bot stop failed'));
  }

  /**
   * Send a message to a chat. Throws when the bot is disabled — a silent no-op
   * would let callers mark undelivered listings as seen and drop them for good.
   */
  async notify(chatId: number, text: string): Promise<void> {
    await this.api().sendMessage(chatId, text, { link_preview_options: NO_LINK_PREVIEW });
  }

  /**
   * Send one listing card to a chat — the shared send path, wired to the bot API.
   * `async` so a disabled bot rejects rather than throwing synchronously: half the callers
   * reach for `.catch()`, which a sync throw walks straight past.
   */
  async notifyCard(chatId: number, message: ListingMessage): Promise<void> {
    await sendCard(this.sender(chatId), message, this.logger);
  }

  private sender(chatId: number): CardSender {
    const api = this.api();
    return {
      photo: (url, caption) => api.sendPhoto(chatId, url, { caption, parse_mode: 'HTML' }),
      group: (media) => api.sendMediaGroup(chatId, media),
      html: (text) =>
        api.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          link_preview_options: NO_LINK_PREVIEW,
        }),
      location: ({ lat, lon }) => api.sendLocation(chatId, lat, lon),
    };
  }

  /** The live API, or the reason there isn't one. */
  private api(): Api {
    // Two different causes, told apart on purpose: one is a misconfigured deployment, the other
    // is an orderly stop, and they read identically in Sentry otherwise.
    if (!this.bot) {
      throw new Error(
        this.shuttingDown
          ? 'Bot is shutting down — cannot deliver messages'
          : 'Bot is disabled — cannot deliver messages',
      );
    }
    return this.bot.api;
  }
}
