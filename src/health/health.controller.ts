import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@SkipThrottle() // probes must never be rate-limited
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  /**
   * Liveness probe — is the process alive? Keep it cheap and dependency-free:
   * a liveness probe that fails on transient issues causes restart loops.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /**
   * Readiness probe — can we serve traffic? Add dependency checks here so the pod
   * is pulled from the Service while a dependency is down (without restarting), e.g.:
   *
   *   return this.health.check([
   *     () => this.db.pingCheck('database'),
   *     () => this.http.pingCheck('upstream', 'https://...'),
   *   ]);
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([]);
  }
}
