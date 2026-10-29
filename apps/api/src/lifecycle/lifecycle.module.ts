import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service.js';
import { LifecycleWorker } from './lifecycle.worker.js';
import { SweeperService } from './sweeper.service.js';

@Module({
  providers: [LifecycleService, LifecycleWorker, SweeperService],
  exports: [LifecycleService, SweeperService],
})
export class LifecycleModule {}
