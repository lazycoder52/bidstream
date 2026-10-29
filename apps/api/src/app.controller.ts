import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';
import { MetricsService } from './metrics/metrics.service.js';

@ApiTags('Observability')
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metricsService: MetricsService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness & readiness health check for database and cache' })
  @ApiResponse({ status: 200, description: 'Service is fully healthy' })
  @ApiResponse({ status: 503, description: 'One or more downstream services are unhealthy' })
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const [dbResult, redisResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.getClient().ping(),
    ]);

    const isDbHealthy = dbResult.status === 'fulfilled';
    const isRedisHealthy = redisResult.status === 'fulfilled';
    const isAllHealthy = isDbHealthy && isRedisHealthy;

    if (!isAllHealthy) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: isAllHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      services: {
        database: isDbHealthy ? 'up' : 'down',
        redis: isRedisHealthy ? 'up' : 'down',
      },
    };
  }

  @Public()
  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  @ApiResponse({ status: 200, description: 'Prometheus formatted metrics' })
  async getMetrics(@Res() res: Response) {
    const metrics = await this.metricsService.getMetrics();
    res.setHeader('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }
}
