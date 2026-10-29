import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse as SwaggerResponse, ApiTags } from '@nestjs/swagger';
import { BidsService } from './bids.service.js';
import { PlaceBidDto } from './dto/place-bid.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiResponse, BidDto, PlaceBidResult } from '@bidstream/contracts';

@ApiTags('Bids')
@Controller('auctions/:id/bids')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Place a bid on an active auction with pessimistic concurrency locking',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: 'Unique key ensuring safe retries without duplicate bid placement',
  })
  @SwaggerResponse({ status: 201, description: 'Bid placed successfully' })
  @SwaggerResponse({ status: 400, description: 'Self-bidding or invalid input' })
  @SwaggerResponse({ status: 403, description: 'Seller forbidden from bidding' })
  @SwaggerResponse({ status: 404, description: 'Auction not found' })
  @SwaggerResponse({ status: 409, description: 'Auction not active, expired, or outbid' })
  async placeBid(
    @Param('id', ParseUUIDPipe) auctionId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: PlaceBidDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ApiResponse<PlaceBidResult>> {
    const result = await this.bidsService.placeBid(auctionId, userId, dto, idempotencyKey);
    return {
      success: true,
      data: result,
    };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get recent bid history for an auction' })
  @SwaggerResponse({ status: 200, description: 'List of historical bids' })
  async getBids(
    @Param('id', ParseUUIDPipe) auctionId: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse<BidDto[]>> {
    const parsedLimit = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 100) : 50;
    const history = await this.bidsService.getBidHistory(auctionId, parsedLimit);
    return {
      success: true,
      data: history,
    };
  }
}
