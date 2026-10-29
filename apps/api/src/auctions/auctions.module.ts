import { Module } from '@nestjs/common';
import { AuctionsService } from './auctions.service.js';
import { AuctionsController } from './auctions.controller.js';

@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
