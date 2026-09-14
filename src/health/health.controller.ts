import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

// Terminus defaults to 1s. The database is off-cluster and reached over the internet with TLS,
// and Supabase free sleeps when idle (PRODUCT_TECH.md § Ограничения) — one second does not
// cover a normal cold first attempt. Matches timeoutSeconds on the readiness probe in
// k8s/deployment.yaml: a shorter inner timeout would always fire first, answering 503 while
// the orchestrator was still willing to wait.
const DB_PING_TIMEOUT_MS = 3_000;

@ApiTags('health')
@SkipThrottle() // probes must never be rate-limited
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /**
   * Liveness probe — is the process alive? Keep it cheap and dependency-free:
   * a liveness probe that fails on transient issues causes restart loops.
   */
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * Readiness probe — can we serve traffic? Pulls the pod from the Service (without
   * restarting) while the database is unreachable.
   */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: DB_PING_TIMEOUT_MS }),
    ]);
  }
}
