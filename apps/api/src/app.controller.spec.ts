import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';
import { MetricsService } from './metrics/metrics.service.js';

describe('AppController', () => {
  let appController: AppController;
  let prismaMock: { $queryRaw: jest.Mock };
  let redisMock: { getClient: jest.Mock };
  let metricsMock: { getMetrics: jest.Mock; getContentType: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    redisMock = {
      getClient: jest.fn().mockReturnValue({
        ping: jest.fn().mockResolvedValue('PONG'),
      }),
    };

    metricsMock = {
      getMetrics: jest.fn().mockResolvedValue('# HELP bidstream_http_requests_total\n'),
      getContentType: jest.fn().mockReturnValue('text/plain; version=0.0.4; charset=utf-8'),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: MetricsService, useValue: metricsMock },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('getHealth', () => {
    it('should return status ok when database and redis are healthy', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
      } as unknown as Response;

      const result = await appController.getHealth(mockRes);
      expect(result.status).toBe('ok');
      expect(result.services.database).toBe('up');
      expect(result.services.redis).toBe('up');
      expect(typeof result.timestamp).toBe('string');
      expect(typeof result.uptime).toBe('number');
      expect(mockRes.status).not.toHaveBeenCalledWith(503);
    });

    it('should return degraded status and 503 if database fails', async () => {
      prismaMock.$queryRaw.mockRejectedValueOnce(new Error('Connection lost'));

      const mockRes = {
        status: jest.fn().mockReturnThis(),
      } as unknown as Response;

      const result = await appController.getHealth(mockRes);
      expect(result.status).toBe('degraded');
      expect(result.services.database).toBe('down');
      expect(result.services.redis).toBe('up');
      expect(mockRes.status).toHaveBeenCalledWith(503);
    });
  });

  describe('getMetrics', () => {
    it('should return Prometheus formatted metrics', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await appController.getMetrics(mockRes);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(mockRes.send).toHaveBeenCalledWith('# HELP bidstream_http_requests_total\n');
    });
  });
});
