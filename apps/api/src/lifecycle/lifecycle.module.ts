import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service.js';
import { LifecycleWorker } from './lifecycle.worker.js';
import { SweeperService } from './sweeper.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [RealtimeModule],
  providers: [LifecycleService, LifecycleWorker, SweeperService],
  exports: [LifecycleService, SweeperService],
})
export class LifecycleModule {}
