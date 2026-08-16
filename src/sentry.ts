/**
 * Error reporting bootstrap. MUST be imported before any other module (see main.ts) so the SDK
 * can instrument them as they load.
 *
 * Opt-in: without SENTRY_DSN nothing is initialised and every `Sentry.*` call becomes a no-op,
 * so local runs and tests report nothing. Errors only — tracing stays off (`tracesSampleRate: 0`),
 * which keeps us inside the free tier and sends just what the owner needs to act on.
 *
 * NOTE: the Sentry SDK sets up OpenTelemetry itself, so do NOT enable SENTRY_DSN and
 * OTEL_EXPORTER_OTLP_ENDPOINT (src/tracing.ts) at the same time — two SDKs would fight over the
 * same instrumentation. A warning is logged if both are set.
 */
import * as Sentry from '@sentry/nestjs';

if (process.env.SENTRY_DSN) {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.warn('SENTRY_DSN and OTEL_EXPORTER_OTLP_ENDPOINT are both set — expected only one');
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Which deployment the event came from, so staging noise never looks like production.
    environment: process.env.APP_ENV ?? 'development',
    tracesSampleRate: 0,
  });
}
