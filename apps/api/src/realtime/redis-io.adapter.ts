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

  async connectToRedis(redisHost: string, redisPort: number): Promise<void> {
    try {
      this.pubClient = new Redis({
        host: redisHost,
        port: redisPort,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
      this.subClient = this.pubClient.duplicate();

      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
      this.adapterLogger.log(`Connected to Redis adapter at ${redisHost}:${redisPort}`);
    } catch (error) {
      this.adapterLogger.warn(
        `Failed to connect to Redis adapter (${error instanceof Error ? error.message : String(error)}). Falling back to in-memory adapter.`,
      );
      this.adapterConstructor = null;
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
