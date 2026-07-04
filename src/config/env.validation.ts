import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

/** Technical runtime mode (npm / framework optimizations, jest). Not for app logic. */
export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** Deployment stage — the single source for app behavior. See APP_ENV. */
export enum AppEnv {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

/** Local docker Postgres — the default DB URL, shared with the migration CLI data-source. */
export const DEFAULT_DATABASE_URL = 'postgres://app:app@localhost:5432/app';

export enum LogLevel {
  Trace = 'trace',
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  Fatal = 'fatal',
}

/**
 * Strongly-typed schema for process.env.
 * Validated once at boot — the app refuses to start on an invalid config.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  /**
   * Deployment stage — drives app behavior (swagger, log level, Telegram chat,
   * feature flags). Distinct from the technical NODE_ENV. Defaults to `test`
   * under jest, else `development` — resolved in configuration.ts.
   */
  @IsEnum(AppEnv)
  @IsOptional()
  APP_ENV?: AppEnv;

  // Min 1: PORT=0 would bind a random port and break every probe/healthcheck.
  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  @IsString()
  @IsOptional()
  API_VERSION: string = '1';

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = '*';

  @IsEnum(LogLevel)
  @IsOptional()
  LOG_LEVEL: LogLevel = LogLevel.Info;

  /** Rate limit window in seconds. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  THROTTLE_TTL: number = 60;

  /** Max requests per window, per client. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  THROTTLE_LIMIT: number = 100;

  /**
   * Telegram bot token from @BotFather. When unset, the bot stays disabled —
   * but the bot IS the product, so production refuses to boot without it.
   */
  @ValidateIf((env: EnvironmentVariables) => env.APP_ENV === AppEnv.Production)
  @IsString()
  @IsNotEmpty({ message: 'TELEGRAM_BOT_TOKEN is required when APP_ENV=production' })
  TELEGRAM_BOT_TOKEN?: string;

  /** Telegram id of the owner — enables the admin-only /stats command. Unset = no admin. */
  @IsNumber()
  @IsOptional()
  ADMIN_TELEGRAM_ID?: number;

  /**
   * Cron for the daily subscription check. 5 fields only (min hour dom mon dow);
   * a 6th field would be seconds in the cron lib — avoided, we need daily granularity.
   */
  @IsString()
  @Matches(/^(\S+\s+){4}\S+$/, { message: 'WATCH_CRON must be a 5-field cron expression' })
  @IsOptional()
  WATCH_CRON: string = '0 9 * * *';

  /** Base pause between subscription polls, in ms — paces the scraper off a source. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  WATCH_MIN_DELAY_MS: number = 2000;

  /** Extra random pause on top of the base (0..jitter), in ms — spreads the load. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  WATCH_JITTER_MS: number = 3000;

  /**
   * Postgres connection URL. Defaults to the local docker database (`npm run db:up`);
   * staging/prod inject a Neon URL (SSL, pooled endpoint).
   */
  @IsString()
  @IsOptional()
  DATABASE_URL: string = DEFAULT_DATABASE_URL;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n')}`,
    );
  }

  return validated;
}
