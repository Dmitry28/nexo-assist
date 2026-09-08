import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { DEFAULT_DATABASE_URL } from '@/config/env.validation';

// Standalone DataSource for the TypeORM CLI (migrations) and the runtime migration step —
// separate from the Nest TypeOrmModule wiring in app.module. Globs are __dirname-relative and
// use this file's own extension (`.ts` under ts-node/CLI on src, `.js` under node on dist), so
// the same file resolves in both — and never matches emitted `.d.ts` declarations.
// .env is loaded by the CLI script (-r dotenv/config); in prod env comes from the environment.
const ext = __filename.endsWith('.js') ? 'js' : 'ts';

// The same TLS fallback app.module.ts keeps, for the same reason (DEPLOY.md § TLS к базе): the
// URL governs SSL whenever it carries `sslmode`, and this only covers a deployed URL that omits
// it. Without it the two paths disagree — the app would negotiate TLS while THIS one, which the
// initContainer runs before the app starts, sent the database password in the clear. The CA is
// mounted for both containers via NODE_EXTRA_CA_CERTS, so verification works here too.
// APP_ENV is read directly: the CLI runs outside Nest, so there is no AppConfig to inject.
const isDeployed = process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  ssl: isDeployed ? { rejectUnauthorized: true } : false,
  entities: [`${__dirname}/../**/*.entity.${ext}`],
  migrations: [`${__dirname}/migrations/*.${ext}`],
});
