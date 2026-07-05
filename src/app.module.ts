import { Module, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers, stdTimeFunctions } from 'pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      // NOTE: isGlobal — inject config anywhere without re-importing this module;
      // cache — read process.env once; expandVariables — allow ${VAR} refs in .env.
      isGlobal: true,
      cache: true,
      expandVariables: true,
      // `configuration` validates env via validateEnv and exposes it as `app.*`.
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [configuration.KEY],
      useFactory: (appConfig: AppConfig) => {
        const { isProduction, isTest } = appConfig;
        return {
          // NOTE: override nestjs-pino's default `*` route — Express 5 needs a named
          // wildcard, otherwise Nest logs a LegacyRouteConverter warning at boot.
          forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
          // trace_id/span_id are injected by instrumentation-pino (bundled in
          // auto-instrumentations-node) when tracing is enabled — see src/tracing.ts.
          pinoHttp: {
            // Silent under jest — request logs would only pollute test output.
            level: isTest ? 'silent' : appConfig.logLevel,
            timestamp: stdTimeFunctions.isoTime,
            // Serialize the `error` key as a full Error — pino's default only handles `err`.
            serializers: { error: stdSerializers.err },
            transport:
              isProduction || isTest
                ? undefined
                : {
                    target: 'pino-pretty',
                    options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
                  },
            // Don't log request/response bodies by default — they may contain PII.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: true,
          },
        };
      },
    }),
    // Rate limiting — config-driven, applied globally via the guard below.
    // Storage is in-memory (per process): with N replicas a client effectively gets
    // N × THROTTLE_LIMIT. Switch to ThrottlerStorageRedisService when that matters.
    ThrottlerModule.forRootAsync({
      inject: [configuration.KEY],
      useFactory: (appConfig: AppConfig) => ({
        throttlers: [{ ttl: appConfig.throttleTtl * 1000, limit: appConfig.throttleLimit }],
      }),
    }),
    // Postgres via TypeORM. Schema changes only through migrations (Phase 3.2+).
    TypeOrmModule.forRootAsync({
      inject: [configuration.KEY],
      useFactory: (appConfig: AppConfig): TypeOrmModuleOptions => ({
        type: 'postgres',
        url: appConfig.databaseUrl,
        // NOTE: autoLoadEntities — register every entity a module pulls in via
        // TypeOrmModule.forFeature, so we never maintain a manual entities list.
        autoLoadEntities: true,
        // NOTE: never auto-create/alter tables from entities — schema changes go only
        // through reviewed migrations (Phase 3.2+); autosync would risk data loss in prod.
        synchronize: false,
        // Managed Postgres (Neon) requires SSL; local docker doesn't. Cert verification
        // (anti-MITM) is driven by `sslmode=verify-full` in DATABASE_URL — pg lets the URL
        // govern SSL when sslmode is set (see DEPLOY.md), and verify-full is stable across
        // pg versions. This option is a fallback: verify for prod/staging if the URL omits
        // sslmode, and disable TLS for local docker.
        ssl: appConfig.isProduction || appConfig.isStaging ? { rejectUnauthorized: true } : false,
      }),
    }),
    // Cron scheduler for the daily subscription check.
    ScheduleModule.forRoot(),
    // Prometheus metrics at GET /api/v1/metrics (+ default Node/process metrics).
    MetricsModule,
    HealthModule,
    TelegramModule,
  ],
  providers: [
    // Global request validation — single source of truth so tests inherit it automatically.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        // Conversions are explicit via @Type() in DTOs — implicit conversion is off
        // because it coerces any non-empty string (even 'false') to boolean true.
        transform: true,
      }),
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
