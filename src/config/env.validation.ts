import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
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

/**
 * Validate a variable in production — where it is required — and whenever it is set at all, so a
 * typo outside production still fails at boot instead of silently degrading. `@IsOptional()`
 * cannot express this: it would skip the required check too.
 */
function RequiredInProduction(): PropertyDecorator {
  return ValidateIf(
    (env: EnvironmentVariables, value: unknown) =>
      env.APP_ENV === AppEnv.Production || value !== undefined,
  );
}

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
   * One bot per environment (dev token in the local `.env`, production token in the cluster
   * Secret): Telegram serves updates to a single long-polling consumer per token.
   */
  // NOTE: production-only, deliberately not RequiredInProduction() — outside production an empty
  // token means "bot disabled", not a typo, and @IsNotEmpty would start rejecting it.
  @ValidateIf((env: EnvironmentVariables) => env.APP_ENV === AppEnv.Production)
  @IsString()
  @IsNotEmpty({ message: 'TELEGRAM_BOT_TOKEN is required when APP_ENV=production' })
  TELEGRAM_BOT_TOKEN?: string;

  /**
   * Telegram id of the owner — `/stats`, `/check` in production, and the address of every
   * product alert. Required in production for the same reason as SCRAPE_PROXY_URL below:
   * unset, the app runs fine and just stops telling the owner anything, and missing alerts
   * look exactly like nothing going wrong. Lives in the Secret, not the ConfigMap — the repo
   * is public and this is a personal id.
   */
  // Validated when merely set too, or a typo would convert to NaN (and an empty value to 0)
  // and silently deny the owner everything.
  @RequiredInProduction()
  @IsInt()
  @Min(1, { message: 'ADMIN_TELEGRAM_ID must be a positive id; required when APP_ENV=production' })
  ADMIN_TELEGRAM_ID?: number;

  /**
   * Cron for the daily subscription check. 5 fields only (min hour dom mon dow);
   * a 6th field would be seconds in the cron lib — avoided, we need daily granularity.
   */
  @IsString()
  @Matches(/^(\S+\s+){4}\S+$/, { message: 'WATCH_CRON must be a 5-field cron expression' })
  @IsOptional()
  WATCH_CRON: string = '0 9 * * *';

  /**
   * Sentry DSN — where unhandled errors are reported. Unset = reporting off (local, tests).
   * Read where it's used (`src/sentry.ts`), like the OTEL_* vars; declared here so an invalid
   * value fails at boot instead of silently disabling reporting.
   */
  @IsString()
  @Matches(/^https?:\/\/\S+$/, { message: 'SENTRY_DSN must be an http(s) URL' })
  @IsOptional()
  SENTRY_DSN?: string;

  /**
   * Force error reporting on outside production/staging — for testing the reporting path
   * locally. Normally the stage decides (see `src/sentry.ts`), so the DSN can stay in `.env`
   * without local runs sending anything.
   */
  @IsIn(['true', 'false'])
  @IsOptional()
  SENTRY_ENABLED?: string;

  /**
   * Watchdog ping URL for the dead-man's switch — required in production: unset, nothing would
   * report the app dying, which is the silence the switch exists to remove. Read where it's used
   * (`src/health/heartbeat.service.ts`, which explains the mechanism) — whoever holds the URL can
   * fake our pings, and the bootstrap logs the whole config object.
   */
  @RequiredInProduction()
  @IsString()
  @IsNotEmpty({ message: 'HEARTBEAT_URL is required when APP_ENV=production' })
  @Matches(/^https?:\/\/\S+$/, { message: 'HEARTBEAT_URL must be an http(s) URL' })
  HEARTBEAT_URL?: string;

  /**
   * HTTP proxy for sources that block datacenter IPs (kufar — see PRODUCT_TECH.md).
   * Unset = every source is fetched directly. Consumed in the scraping transport
   * (`sources/scraping/http.ts`), deliberately not exposed via AppConfig: it carries
   * credentials and the bootstrap logs the config object.
   *
   * Required in production: without it kufar is fetched directly, answers 403, and that reads
   * as the source blocking us. The dead-link counter doesn't know better, so after
   * MAX_CONSECUTIVE_FAILURES runs it auto-pauses real subscriptions and tells those users to
   * check a link that is fine. Refusing to boot turns a missing setting into a loud, instant
   * failure (crashloop → rollback) instead of a wrong accusation days later.
   */
  // Production only, deliberately: there is no staging stage yet. Add it in the change that
  // first deploys one — staging shares the datacenter IP, so it would need the proxy too.
  @RequiredInProduction()
  @IsString()
  @IsNotEmpty({
    message:
      'SCRAPE_PROXY_URL must not be empty — required when APP_ENV=production (kufar needs it)',
  })
  @Matches(/^https?:\/\/\S+$/, { message: 'SCRAPE_PROXY_URL must be an http(s) URL' })
  SCRAPE_PROXY_URL?: string;

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
