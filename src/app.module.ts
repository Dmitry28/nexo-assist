import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import configuration from './config/configuration';
import { Environment } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `configuration` validates env via validateEnv and exposes it as `app.*`.
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get('app.env', { infer: true }) === Environment.Production;
        return {
          pinoHttp: {
            level: config.get<string>('app.logLevel'),
            transport: isProd ? undefined : { target: 'pino-pretty' },
            // Don't log request/response bodies by default — they may contain PII.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: true,
          },
        };
      },
    }),
    // Rate limiting — config-driven, applied globally via the guard below.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('app.throttleTtl') * 1000,
            limit: config.getOrThrow<number>('app.throttleLimit'),
          },
        ],
      }),
    }),
    // Prometheus metrics at GET /api/v1/metrics (+ default Node/process metrics).
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    HealthModule,
    UsersModule,
  ],
  providers: [
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
