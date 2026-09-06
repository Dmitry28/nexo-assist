import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { DEFAULT_DATABASE_URL } from '@/config/env.validation';

// Standalone DataSource for the TypeORM CLI (migrations) and the runtime migration step —
// separate from the Nest TypeOrmModule wiring in app.module. Globs are __dirname-relative and
// use this file's own extension (`.ts` under ts-node/CLI on src, `.js` under node on dist), so
// the same file resolves in both — and never matches emitted `.d.ts` declarations.
// .env is loaded by the CLI script (-r dotenv/config); in prod env comes from the environment.
const ext = __filename.endsWith('.js') ? 'js' : 'ts';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  entities: [`${__dirname}/../**/*.entity.${ext}`],
  migrations: [`${__dirname}/migrations/*.${ext}`],
});
