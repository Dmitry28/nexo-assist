import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Response } from 'express';

/**
 * Replaces the default PrometheusController so scrapes are exempt from the global
 * ThrottlerGuard — a tightened rate limit must never 429 the monitoring system.
 */
// NOTE: leave @Controller() without a path — PrometheusModule.register() overwrites it
// with its `path` option (default '/metrics').
@ApiTags('metrics')
@SkipThrottle()
@Controller()
export class MetricsController extends PrometheusController {
  @Get()
  override async index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
