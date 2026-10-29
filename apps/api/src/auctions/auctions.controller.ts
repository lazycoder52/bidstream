import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import { AuctionsService } from './auctions.service.js';
import { CreateAuctionDto } from './dto/create-auction.dto.js';
import { UpdateAuctionDto } from './dto/update-auction.dto.js';
import { AuctionListQueryDto } from './dto/auction-list-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiResponse, AuctionDto, JwtPayload, PaginatedResponse } from '@bidstream/contracts';

@ApiTags('Auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Create a new auction listing (Seller/Admin only)' })
  @SwaggerResponse({ status: 201, description: 'Auction created successfully' })
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAuctionDto,
  ): Promise<ApiResponse<AuctionDto>> {
    const auction = await this.auctionsService.create(userId, dto);
    return {
      success: true,
      data: auction,
    };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List auctions with filtering and pagination' })
  @SwaggerResponse({ status: 200, description: 'List of auctions' })
  async findAll(
    @Query() query: AuctionListQueryDto,
  ): Promise<ApiResponse<PaginatedResponse<AuctionDto>>> {
    const result = await this.auctionsService.findAll(query);
    return {
      success: true,
      data: result,
    };
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get auction details by ID' })
  @SwaggerResponse({ status: 200, description: 'Auction details' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponse<AuctionDto>> {
    const auction = await this.auctionsService.findById(id);
    return {
      success: true,
      data: auction,
    };
  }

  @Patch(':id')
  @Roles('SELLER', 'ADMIN')
  @ApiOperation({ summary: 'Update auction details prior to commencement' })
  @SwaggerResponse({ status: 200, description: 'Auction updated successfully' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAuctionDto,
  ): Promise<ApiResponse<AuctionDto>> {
    const updated = await this.auctionsService.update(id, user.sub, user.role, dto);
    return {
      success: true,
      data: updated,
    };
  }
}
