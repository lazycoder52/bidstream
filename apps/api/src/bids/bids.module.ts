import { Module } from '@nestjs/common';
import { BidsService } from './bids.service.js';
import { BidsController } from './bids.controller.js';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [LifecycleModule, RealtimeModule],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
