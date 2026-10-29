import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LifecycleService } from './lifecycle.service.js';

interface OverdueAuctionRow {
  id: string;
}

@Injectable()
export class SweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly sweepIntervalMs = 15000; // 15 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: LifecycleService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweepOverdueAuctions().catch((err) => {
        this.logger.error('Error during auction sweep execution', err);
      });
    }, this.sweepIntervalMs);

    // Unref timer so it does not block application teardown
    this.timer.unref();
  }

  async sweepOverdueAuctions(): Promise<number> {
    try {
      // Find overdue auctions with SKIP LOCKED so multiple API instances do not block each other
      const overdue = await this.prisma.$queryRaw<OverdueAuctionRow[]>`
        SELECT id FROM auctions
        WHERE status = 'ACTIVE' AND end_time <= NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT 50;
      `;

      if (overdue.length === 0) {
        return 0;
      }

      this.logger.log(
        `Sweeper detected ${overdue.length} overdue active auction(s). Initiating close.`,
      );

      for (const row of overdue) {
        await this.lifecycleService.closeAuction(row.id);
      }

      return overdue.length;
    } catch (err) {
      this.logger.error('Failed to query overdue auctions in sweeper', err);
      return 0;
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
