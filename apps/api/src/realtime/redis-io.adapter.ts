import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  async connectToRedis(redisHost: string, redisPort: number, allowInMemory = false): Promise<void> {
    try {
      this.pubClient = new Redis({
        host: redisHost,
        port: redisPort,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 3000,
      });
      this.subClient = this.pubClient.duplicate();

      const connectTimeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Redis adapter connection timed out after 3000ms to ${redisHost}:${redisPort}`,
              ),
            ),
          3000,
        ),
      );

      await Promise.race([
        Promise.all([this.pubClient.connect(), this.subClient.connect()]),
        connectTimeout,
      ]);

      this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
      this.adapterLogger.log(`Connected to Redis adapter at ${redisHost}:${redisPort}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (allowInMemory) {
        this.adapterLogger.warn(
          `Failed to connect to Redis adapter (${errorMsg}). Explicit dev flag allows in-memory adapter fallback.`,
        );
        this.adapterConstructor = null;
        return;
      }

      this.adapterLogger.error(
        `Failed to connect to Redis adapter at ${redisHost}:${redisPort}: ${errorMsg}. Fail-fast startup enforced.`,
      );
      throw new Error(
        `Failed to connect to Redis adapter at ${redisHost}:${redisPort}: ${errorMsg}. Silent in-memory fallback is disabled.`,
      );
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: '*',
        credentials: true,
      },
    }) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }

  async closeRedis(): Promise<void> {
    if (this.pubClient) {
      await this.pubClient.quit().catch(() => {});
      this.pubClient = null;
    }
    if (this.subClient) {
      await this.subClient.quit().catch(() => {});
      this.subClient = null;
    }
  }
}
