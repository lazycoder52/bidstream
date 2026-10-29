import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { CreateAuctionDto } from './dto/create-auction.dto.js';
import { UpdateAuctionDto } from './dto/update-auction.dto.js';
import { AuctionListQueryDto } from './dto/auction-list-query.dto.js';
import { AuctionDto, PaginatedResponse } from '@bidstream/contracts';

interface AuctionWithRelations {
  id: string;
  title: string;
  description: string;
  startingPrice: number;
  currentPrice: number;
  reservePrice: number | null;
  minIncrement: number;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  sellerId: string;
  winnerId: string | null;
  bidCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt: Date;
  seller: { name: string };
  winner?: { name: string } | null;
}

@Injectable()
export class AuctionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: LifecycleService,
  ) {}

  async create(sellerId: string, dto: CreateAuctionDto): Promise<AuctionDto> {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const now = new Date();

    if (endTime <= startTime) {
      throw new BadRequestException('End time must be strictly after start time');
    }

    const initialStatus = startTime <= now ? 'ACTIVE' : 'DRAFT';

    const auction = await this.prisma.auction.create({
      data: {
        title: dto.title,
        description: dto.description,
        startingPrice: dto.startingPrice,
        currentPrice: dto.startingPrice,
        reservePrice: dto.reservePrice ?? null,
        minIncrement: dto.minIncrement || 1.0,
        status: initialStatus,
        sellerId,
        startTime,
        endTime,
      },
      include: {
        seller: { select: { name: true } },
      },
    });

    if (initialStatus === 'ACTIVE') {
      await this.lifecycleService.scheduleAuctionClose(auction.id, auction.endTime);
    }

    return this.mapToDto(auction);
  }

  async findAll(query: AuctionListQueryDto): Promise<PaginatedResponse<AuctionDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AuctionWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.sellerId) {
      where.sellerId = query.sellerId;
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.currentPrice = {};
      if (query.minPrice !== undefined) {
        where.currentPrice.gte = query.minPrice;
      }
      if (query.maxPrice !== undefined) {
        where.currentPrice.lte = query.maxPrice;
      }
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.auction.count({ where }),
      this.prisma.auction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          seller: { select: { name: true } },
          winner: { select: { name: true } },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: (items as AuctionWithRelations[]).map((item: AuctionWithRelations) =>
        this.mapToDto(item),
      ),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }

  async findById(id: string): Promise<AuctionDto> {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: {
        seller: { select: { name: true } },
        winner: { select: { name: true } },
      },
    });

    if (!auction) {
      throw new NotFoundException(`Auction with ID ${id} not found`);
    }

    return this.mapToDto(auction);
  }

  async update(
    id: string,
    userId: string,
    userRole: string,
    dto: UpdateAuctionDto,
  ): Promise<AuctionDto> {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: { seller: { select: { name: true } } },
    });

    if (!auction) {
      throw new NotFoundException(`Auction with ID ${id} not found`);
    }

    if (auction.sellerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('You are not authorized to update this auction');
    }

    if (auction.status !== 'DRAFT' && new Date() >= auction.startTime) {
      throw new BadRequestException('Cannot modify an auction that has already commenced');
    }

    const updated = await this.prisma.auction.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.description ? { description: dto.description } : {}),
        ...(dto.reservePrice !== undefined ? { reservePrice: dto.reservePrice } : {}),
        ...(dto.minIncrement !== undefined ? { minIncrement: dto.minIncrement } : {}),
      },
      include: {
        seller: { select: { name: true } },
        winner: { select: { name: true } },
      },
    });

    return this.mapToDto(updated);
  }

  private mapToDto(auction: AuctionWithRelations): AuctionDto {
    return {
      id: auction.id,
      title: auction.title,
      description: auction.description,
      startingPrice: auction.startingPrice,
      currentPrice: auction.currentPrice,
      reservePrice: auction.reservePrice,
      minIncrement: auction.minIncrement,
      status: auction.status,
      sellerId: auction.sellerId,
      sellerName: auction.seller.name,
      winnerId: auction.winnerId,
      winnerName: auction.winner?.name ?? null,
      bidCount: auction.bidCount,
      startTime: auction.startTime.toISOString(),
      endTime: auction.endTime.toISOString(),
      createdAt: auction.createdAt.toISOString(),
      updatedAt: auction.updatedAt.toISOString(),
    };
  }
}
