import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { InMemoryRedisClient } from './in-memory-redis.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | InMemoryRedisClient | null = null;
  private isInMemoryMode = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const inMemoryConfig = this.configService.get<boolean>('REDIS_IN_MEMORY', false);

    if (inMemoryConfig) {
      if (nodeEnv === 'production') {
        throw new Error('REDIS_IN_MEMORY cannot be enabled in production environments.');
      }
      this.isInMemoryMode = true;
      this.client = new InMemoryRedisClient();
      this.logger.warn(
        'Explicit dev flag REDIS_IN_MEMORY is active. Using in-memory Redis client (not suitable for multi-instance production).',
      );
      return;
    }

    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    const realClient = new Redis({
      host,
      port,
      password: password || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
    });

    try {
      const connectTimeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Connection timed out after 3000ms to ${host}:${port}`)),
          3000,
        ),
      );
      await Promise.race([realClient.connect(), connectTimeout]);
      this.client = realClient;
      this.logger.log(`Connected to Redis at ${host}:${port}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to connect to Redis at ${host}:${port}: ${errorMsg}`);

      // Fail fast at startup: never fall back to in-memory silently
      throw new Error(
        `Failed to connect to Redis at ${host}:${port}. Fail-fast startup enforced in ${nodeEnv} mode: ${errorMsg}`,
      );
    }
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client has not been initialized');
    }
    return this.client as unknown as Redis;
  }

  isInMemory(): boolean {
    return this.isInMemoryMode;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const timeoutPromise = new Promise<'TIMEOUT'>((resolve) =>
        setTimeout(() => resolve('TIMEOUT'), 2000),
      );
      const res = await Promise.race([this.client.ping(), timeoutPromise]);
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
