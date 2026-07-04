import 'reflect-metadata';
// NOTE: the CLI runs outside Nest, so load .env ourselves — otherwise `migration:run`
// would ignore a DATABASE_URL set only in .env and silently target the default DB.
import 'dotenv/config';
import { DataSource } from 'typeorm';

import { DEFAULT_DATABASE_URL } from '@/config/env.validation';

// NOTE: standalone DataSource for the TypeORM CLI (migrations) only — separate from the
// Nest TypeOrmModule wiring in app.module. Globs load the TS sources via ts-node.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
});
