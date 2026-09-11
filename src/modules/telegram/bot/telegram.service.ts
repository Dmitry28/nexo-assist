import { autoRetry } from '@grammyjs/auto-retry';
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Bot, GrammyError } from 'grammy';
import type { Api } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import type { Coordinates } from '@/modules/sources/source-adapter';
import { SENTRY_FLUSH_MS, reportUserFacing } from '@/modules/telegram/report';

import { BOT_COMMANDS, NO_LINK_PREVIEW } from './telegram.format';
import { TelegramHandlers } from './telegram.handlers';

/** Telegram's hard cap on one media group — an eleventh photo is a rejected request. */
export const MAX_PHOTOS_PER_CARD = 10;

/**
 * A Telegram 403 means delivery to this chat is impossible — the user blocked the bot or
 * deleted the account. Callers treat it as a state to handle (pause the user), not as a defect,
 * and it is the one send failure no retry or fallback can help.
 */
export function isBotBlocked(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/** One listing, ready to send: the card text plus whatever media the source published. */
export interface ListingMessage {
  caption: string;
  images: string[];
  coordinates?: Coordinates;
}

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
   * Send one listing: its photos carry the card, and the card falls back to a plain message if
   * Telegram refuses the media. Resolves once the listing has reached the user in some form —
   * callers mark seen on that, so anything that leaves it undelivered throws instead.
   *
   * NOTE: the prototype found kufar's image CDN answering 302 (`rms.kufar.by` → `rms8…`), which
   * Telegram handles unpredictably in a media group (`WEBPAGE_MEDIA_EMPTY`). It never resolved
   * those redirects, and neither do we: up to ten HEAD requests per card to pre-empt a failure
   * we have not observed is a worse trade than falling back to text and logging the reason. The
   * log below is what turns that guess into evidence if it does happen.
   */
  async notifyCard(
    chatId: number,
    { caption, images, coordinates }: ListingMessage,
  ): Promise<void> {
    const api = this.api();
    const photos = images.slice(0, MAX_PHOTOS_PER_CARD);
    try {
      await this.sendWithPhotos(api, chatId, caption, photos);
    } catch (err) {
      // A blocked chat rejects the text too, and the run pauses the user on this error — a
      // second doomed request would only add another failure to report.
      if (photos.length === 0 || isBotBlocked(err)) throw err;
      this.logger.warn({ err }, 'Photo send failed — falling back to the text card');
      await this.notify(chatId, caption);
    }
    // The listing is already delivered, so a missing pin is not worth failing the delivery for.
    if (coordinates) {
      await api
        .sendLocation(chatId, coordinates.lat, coordinates.lon)
        .catch((err: unknown) => this.logger.warn({ err }, 'Location pin failed'));
    }
  }

  private sendWithPhotos(
    api: Api,
    chatId: number,
    caption: string,
    photos: string[],
  ): Promise<unknown> {
    if (photos.length === 0) {
      return api.sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        link_preview_options: NO_LINK_PREVIEW,
      });
    }
    if (photos.length === 1) {
      return api.sendPhoto(chatId, photos[0], { caption, parse_mode: 'HTML' });
    }
    // Telegram shows the caption of the FIRST item as the group's caption and ignores the rest.
    const media: InputMediaPhoto[] = photos.map((photo, i) =>
      i === 0
        ? { type: 'photo', media: photo, caption, parse_mode: 'HTML' }
        : { type: 'photo', media: photo },
    );
    return api.sendMediaGroup(chatId, media);
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
