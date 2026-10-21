// Pinned before anything loads: ConfigModule copies a local `.env` (APP_ENV=development) into
// process.env, and e2e would then start the real bot's polling, the cron and the heartbeat.
// Keys already set are never overwritten by `.env`. TZ: the pod's clock, as in jest.config.js.
process.env.APP_ENV = 'test';
process.env.TZ = 'UTC';

// The local database only: the e2e specs TRUNCATE what they run against, and DEPLOY.md has the
// owner export the production DATABASE_URL for a manual revert. (jest-e2e.json runs in band
// for the same worker-pool reason as jest.config.js.)
const db = process.env.DATABASE_URL ?? '';
if (db && !/@(localhost|127\.0\.0\.1|postgres)[:/]/.test(db)) {
  throw new Error(
    'DATABASE_URL is not local — e2e truncates its tables; unset it or point it at a local database',
  );
}
