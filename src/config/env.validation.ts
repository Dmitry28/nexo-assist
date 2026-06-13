import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export enum Environment {
  Development = 'development',
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
