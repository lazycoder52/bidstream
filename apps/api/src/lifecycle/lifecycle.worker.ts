import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { AuctionClosePayload, LifecycleService } from './lifecycle.service.js';

@Injectable()
export class LifecycleWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LifecycleWorker.name);
  private worker: Worker<AuctionClosePayload> | null = null;

  constructor(
    private readonly lifecycleService: LifecycleService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    try {
      this.worker = new Worker<AuctionClosePayload>(
        'auction-close',
        async (job: Job<AuctionClosePayload>) => {
          this.logger.debug(`Processing close job ${job.id} for auction ${job.data.auctionId}`);
          await this.lifecycleService.closeAuction(job.data.auctionId);
        },
        {
          connection: {
            host,
            port,
            password: password || undefined,
            maxRetriesPerRequest: null,
          },
          concurrency: 5,
        },
      );

      this.worker.on('failed', (job, err) => {
        this.logger.error(`Auction close job ${job?.id} failed: ${err.message}`, err.stack);
      });
    } catch (err) {
      this.logger.warn(
        `Failed to initialize BullMQ worker: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
