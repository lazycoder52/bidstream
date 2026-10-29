import { z } from 'zod';
import { PaginationQuerySchema } from './common.js';

export const AuctionStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED']);
export type AuctionStatus = z.infer<typeof AuctionStatusSchema>;

export const CreateAuctionDtoSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120),
    description: z.string().trim().min(10, 'Description must be at least 10 characters').max(2000),
    startingPrice: z.coerce.number().positive('Starting price must be greater than 0'),
    reservePrice: z.coerce.number().positive('Reserve price must be greater than 0').optional(),
    minIncrement: z.coerce
      .number()
      .positive('Minimum increment must be greater than 0')
      .default(1.0),
    startTime: z.string().datetime({ message: 'Start time must be a valid ISO 8601 string' }),
    endTime: z.string().datetime({ message: 'End time must be a valid ISO 8601 string' }),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  })
  .refine((data) => !data.reservePrice || data.reservePrice >= data.startingPrice, {
    message: 'Reserve price must be greater than or equal to starting price',
    path: ['reservePrice'],
  });

export type CreateAuctionDto = z.infer<typeof CreateAuctionDtoSchema>;

export const UpdateAuctionDtoSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  reservePrice: z.coerce.number().positive().optional(),
  minIncrement: z.coerce.number().positive().optional(),
});

export type UpdateAuctionDto = z.infer<typeof UpdateAuctionDtoSchema>;

export const AuctionDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  startingPrice: z.number(),
  currentPrice: z.number(),
  reservePrice: z.number().nullable().optional(),
  minIncrement: z.number(),
  status: AuctionStatusSchema,
  sellerId: z.string().uuid(),
  sellerName: z.string().optional(),
  winnerId: z.string().uuid().nullable().optional(),
  winnerName: z.string().nullable().optional(),
  bidCount: z.number().int().nonnegative(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AuctionDto = z.infer<typeof AuctionDtoSchema>;

export const AuctionListQuerySchema = PaginationQuerySchema.extend({
  status: AuctionStatusSchema.optional(),
  search: z.string().optional(),
  sellerId: z.string().uuid().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().positive().optional(),
});

export type AuctionListQuery = z.infer<typeof AuctionListQuerySchema>;
