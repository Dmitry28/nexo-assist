/**
 * Error reporting bootstrap. MUST be imported before any other module (see main.ts) so the SDK
 * can instrument them as they load.
 *
 * Reporting exists for environments nobody is watching — production and staging. Locally you see
 * the error in the console, and dev noise would eat the free quota, so the DSN can safely stay in
 * `.env` without firing: the stage decides, not the presence of a key. Set SENTRY_ENABLED=true and
 * run via `npm run start:dev` to exercise the reporting path locally — those scripts preload `.env`
 * (all three `start*` scripts do), because this module runs long before Nest's ConfigModule reads
 * the file, so anything set only there would be invisible here. Production is unaffected: its
 * variables come from the environment, and dotenv is a devDependency the runtime image prunes.
 * Not `nest start --env-file`: node throws when the file is missing, and `.env` is gitignored —
 * a fresh clone would fail to start. dotenv simply no-ops there.
 *
 * Without a DSN nothing is initialised and every `Sentry.*` call is a no-op. Errors only —
 * tracing stays off (`tracesSampleRate: 0`), so the free tier is spent on what needs acting on.
 *
 * NOTE: the Sentry SDK sets up OpenTelemetry itself, so do NOT enable SENTRY_DSN and
 * OTEL_EXPORTER_OTLP_ENDPOINT (src/tracing.ts) at the same time — two SDKs would fight over the
 * same instrumentation. A warning is logged if both are set.
 */
import * as Sentry from '@sentry/nestjs';

const stage = process.env.APP_ENV ?? 'development';
const reportsFromThisStage =
  process.env.SENTRY_ENABLED === 'true' || stage === 'production' || stage === 'staging';

if (process.env.SENTRY_DSN && reportsFromThisStage) {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.warn('SENTRY_DSN and OTEL_EXPORTER_OTLP_ENDPOINT are both set — expected only one');
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Which deployment the event came from, so staging noise never looks like production.
    environment: stage,
    tracesSampleRate: 0,
  });
}
