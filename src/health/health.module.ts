import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { HeartbeatService } from './heartbeat.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  // Heartbeat lives here: both answer "is this app alive", inward (probes) and outward (watchdog).
  providers: [HeartbeatService],
})
export class HealthModule {}
