import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers, stdTimeFunctions } from 'pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';
import { Environment } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
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
        const isProd = appConfig.env === Environment.Production;
        const isTest = appConfig.env === Environment.Test;
        return {
          // trace_id/span_id are injected by instrumentation-pino (bundled in
          // auto-instrumentations-node) when tracing is enabled — see src/tracing.ts.
          pinoHttp: {
            // Silent under jest — request logs would only pollute test output.
            level: isTest ? 'silent' : appConfig.logLevel,
            timestamp: stdTimeFunctions.isoTime,
            // Serialize the `error` key as a full Error — pino's default only handles `err`.
            serializers: { error: stdSerializers.err },
            transport:
              isProd || isTest
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
    ThrottlerModule.forRootAsync({
      inject: [configuration.KEY],
      useFactory: (appConfig: AppConfig) => ({
        throttlers: [{ ttl: appConfig.throttleTtl * 1000, limit: appConfig.throttleLimit }],
      }),
    }),
    // Prometheus metrics at GET /api/v1/metrics (+ default Node/process metrics).
    MetricsModule,
    HealthModule,
    UsersModule,
  ],
  providers: [
    // Global request validation — single source of truth so tests inherit it automatically.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
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
