import { Module } from '@nestjs/common';
import { BidsService } from './bids.service.js';
import { BidsController } from './bids.controller.js';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';

@Module({
  imports: [LifecycleModule],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
