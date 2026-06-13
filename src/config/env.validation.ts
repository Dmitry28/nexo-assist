import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
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

  /** Telegram bot token from @BotFather. When unset, the bot stays disabled. */
  @IsString()
  @IsOptional()
  TELEGRAM_BOT_TOKEN?: string;

  /** Cron expression for the daily subscription check. Boot validates the field count (5–6). */
  @IsString()
  @Matches(/^(\S+\s+){4,5}\S+$/, { message: 'WATCH_CRON must be a 5- or 6-field cron expression' })
  @IsOptional()
  WATCH_CRON: string = '0 9 * * *';
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
