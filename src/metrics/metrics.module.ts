import { Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';

import { MetricsController } from './metrics.controller';
import {
  ACTIVE_SUBSCRIPTIONS,
  DELIVERIES_TOTAL,
  POLL_ERRORS_TOTAL,
  SUBSCRIPTIONS_PAUSED_TOTAL,
  USERS,
  WatchMetrics,
} from './watch.metrics';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      controller: MetricsController,
    }),
  ],
  providers: [
    makeCounterProvider({
      name: DELIVERIES_TOTAL,
      help: 'Digest messages delivered to users',
      labelNames: ['source'],
    }),
    makeCounterProvider({
      name: POLL_ERRORS_TOTAL,
      help: 'Source poll failures',
      labelNames: ['source'],
    }),
    makeCounterProvider({
      name: SUBSCRIPTIONS_PAUSED_TOTAL,
      help: 'Subscriptions auto-paused, by reason',
      labelNames: ['reason'],
    }),
    makeGaugeProvider({ name: USERS, help: 'Current number of users' }),
    makeGaugeProvider({
      name: ACTIVE_SUBSCRIPTIONS,
      help: 'Current number of active subscriptions',
    }),
    WatchMetrics,
  ],
  exports: [WatchMetrics],
})
export class MetricsModule {}
