import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { fetch } from 'undici';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';

// How often we report being alive. The watchdog's own grace period must be longer than this
// (a couple of missed pings), otherwise a slow network hiccup reads as a dead app.
export const PING_INTERVAL_MS = 5 * 60_000;
// A ping is a liveness signal, not work — never let it hang holding a socket.
const PING_TIMEOUT_MS = 10_000;

/**
 * Dead-man's switch: pings an external watchdog, which alerts the owner when the pings stop.
 *
 * This is the one failure class Sentry cannot report by definition — OOM, a dead node, a hung
 * event loop: a dead process sends nothing. The check has to live outside the cluster, so an
 * in-cluster metric or probe cannot replace it (it would die together with the app). No inbound
 * port is opened, which matters here: the deployment has no ingress.
 *
 * URL unset → disabled (local and tests only: production refuses to boot without it). Read from
 * the environment rather than AppConfig, like SCRAPE_PROXY_URL: whoever holds it can fake our
 * pings, and the bootstrap logs the whole config object.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(configuration.KEY) private readonly appConfig: AppConfig) {}

  onModuleInit(): void {
    // NOTE: skip under tests — ConfigModule loads `.env` there too, so a developer's real
    // watchdog URL would otherwise be pinged by every e2e run.
    if (this.appConfig.isTest) return;

    // Required in production (env.validation.ts), so unset here means local or staging.
    const url = process.env.HEARTBEAT_URL;
    if (!url) return;

    // Ping at once, so a wrong URL surfaces during the deploy instead of one interval later.
    void this.ping(url);
    this.timer = setInterval(() => void this.ping(url), PING_INTERVAL_MS);
    this.logger.log(`Heartbeat every ${PING_INTERVAL_MS / 1000}s`);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One ping. Failures are logged only: the watchdog alerting is the point, not our retry. */
  private async ping(url: string): Promise<void> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      if (!res.ok) this.logger.warn(`Heartbeat rejected: ${res.status}`);
    } catch (err) {
      this.logger.warn({ err }, 'Heartbeat failed');
    }
  }
}
