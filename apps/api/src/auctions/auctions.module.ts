import { Module } from '@nestjs/common';
import { AuctionsService } from './auctions.service.js';
import { AuctionsController } from './auctions.controller.js';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';

@Module({
  imports: [LifecycleModule],
  controllers: [AuctionsController],
  providers: [AuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
