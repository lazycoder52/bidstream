import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { RedisService } from '../src/redis/redis.service.js';
import { RedisThrottlerStorage } from '../src/common/throttler/redis-throttler.storage.js';
import { AppController } from '../src/app.controller.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MetricsService } from '../src/metrics/metrics.service.js';
import { EnvSchema } from '@bidstream/contracts';

describe('Redis Resilience, Failover Modes & Fail-Fast Behavior', () => {
  describe('Environment & Configuration Rules', () => {
    it('prohibits REDIS_IN_MEMORY in production environments', () => {
      const invalidProdConfig = {
        NODE_ENV: 'production',
        PORT: 3001,
        DATABASE_URL: 'postgresql://bidstream:pass@localhost:5432/db',
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_IN_MEMORY: true,
        JWT_ACCESS_SECRET: 'a_very_long_secret_key_at_least_32_characters_here',
        JWT_REFRESH_SECRET: 'another_very_long_secret_key_at_least_32_characters_here',
      };

      const result = EnvSchema.safeParse(invalidProdConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.errors.find((e) => e.path.includes('REDIS_IN_MEMORY'));
        expect(error).toBeDefined();
        expect(error?.message).toContain('REDIS_IN_MEMORY cannot be enabled in production');
      }
    });

    it('permits REDIS_IN_MEMORY in development environments', () => {
      const validDevConfig = {
        NODE_ENV: 'development',
        PORT: 3001,
        DATABASE_URL: 'postgresql://bidstream:pass@localhost:5432/db',
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_IN_MEMORY: true,
        JWT_ACCESS_SECRET: 'a_very_long_secret_key_at_least_32_characters_here',
        JWT_REFRESH_SECRET: 'another_very_long_secret_key_at_least_32_characters_here',
      };

      const result = EnvSchema.safeParse(validDevConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.REDIS_IN_MEMORY).toBe(true);
      }
    });
  });

  describe('RedisService Startup Modes', () => {
    it('fails fast at startup in production when Redis is unreachable', async () => {
      const mockConfig = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'REDIS_IN_MEMORY') return false;
          if (key === 'REDIS_HOST') return '127.0.0.1';
          if (key === 'REDIS_PORT') return 59999; // unreachable dead port
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const redisService = new RedisService(mockConfig);
      await expect(redisService.onModuleInit()).rejects.toThrow(
        /Failed to connect to Redis at 127\.0\.0\.1:59999\. Fail-fast startup enforced/i,
      );
    });

    it('initializes in-memory Redis client when explicit dev flag REDIS_IN_MEMORY is set', async () => {
      const mockConfig = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'NODE_ENV') return 'development';
          if (key === 'REDIS_IN_MEMORY') return true;
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const redisService = new RedisService(mockConfig);
      await redisService.onModuleInit();

      expect(redisService.isInMemory()).toBe(true);
      expect(await redisService.ping()).toBe(true);

      const client = redisService.getClient();
      await client.set('dev-key', 'active-token', 'EX', 3600);
      expect(await client.get('dev-key')).toBe('active-token');

      await client.del('dev-key');
      expect(await client.get('dev-key')).toBeNull();

      await redisService.onModuleDestroy();
    });
  });

  describe('Throttler Fail-Closed vs Fail-Open Policies', () => {
    it('fails open when THROTTLE_FAIL_OPEN=true and Redis encounters an error', async () => {
      const mockRedisService = {
        getClient: () => ({
          multi: () => ({
            incr: () => {},
            pttl: () => {},
            exec: () => Promise.reject(new Error('Redis connection severed')),
          }),
        }),
      } as unknown as RedisService;

      const mockConfig = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'THROTTLE_FAIL_OPEN') return true;
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const storage = new RedisThrottlerStorage(mockRedisService, mockConfig);
      const record = await storage.increment('test-ip', 60000, 100, 60000, 'default');

      expect(record.isBlocked).toBe(false);
      expect(record.totalHits).toBe(1);
    });

    it('fails closed with 503 when THROTTLE_FAIL_OPEN=false and Redis encounters an error', async () => {
      const mockRedisService = {
        getClient: () => ({
          multi: () => ({
            incr: () => {},
            pttl: () => {},
            exec: () => Promise.reject(new Error('Redis connection refused')),
          }),
        }),
      } as unknown as RedisService;

      const mockConfig = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'THROTTLE_FAIL_OPEN') return false;
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const storage = new RedisThrottlerStorage(mockRedisService, mockConfig);

      await expect(storage.increment('test-ip', 60000, 100, 60000, 'default')).rejects.toThrow(
        HttpException,
      );

      try {
        await storage.increment('test-ip', 60000, 100, 60000, 'default');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });
  });

  describe('/health Degraded Reporting at Runtime', () => {
    it('reports status degraded and 503 when Redis ping fails', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      } as unknown as PrismaService;

      const mockRedis = {
        ping: jest.fn().mockResolvedValue(false), // Redis down
      } as unknown as RedisService;

      const mockMetrics = {} as unknown as MetricsService;

      const controller = new AppController(mockPrisma, mockRedis, mockMetrics);

      const mockRes = {
        statusCode: 200,
        status: jest.fn(function (this: { statusCode: number }, code: number) {
          this.statusCode = code;
          return this;
        }),
      } as unknown as Response;

      const health = await controller.getHealth(mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(health.status).toBe('degraded');
      expect(health.services.database).toBe('up');
      expect(health.services.redis).toBe('down');
    });

    it('reports status ok and 200 when both database and Redis respond', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      } as unknown as PrismaService;

      const mockRedis = {
        ping: jest.fn().mockResolvedValue(true), // Redis healthy
      } as unknown as RedisService;

      const mockMetrics = {} as unknown as MetricsService;

      const controller = new AppController(mockPrisma, mockRedis, mockMetrics);

      const mockRes = {
        statusCode: 200,
        status: jest.fn(function (this: { statusCode: number }, code: number) {
          this.statusCode = code;
          return this;
        }),
      } as unknown as Response;

      const health = await controller.getHealth(mockRes);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(health.status).toBe('ok');
      expect(health.services.database).toBe('up');
      expect(health.services.redis).toBe('up');
    });
  });
});
