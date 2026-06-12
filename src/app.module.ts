import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';
import { Environment } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { MetricsController } from './metrics/metrics.controller';
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
          pinoHttp: {
            // Silent under jest — request logs would only pollute test output.
            level: isTest ? 'silent' : appConfig.logLevel,
            transport: isProd || isTest ? undefined : { target: 'pino-pretty' },
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
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      controller: MetricsController,
    }),
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
