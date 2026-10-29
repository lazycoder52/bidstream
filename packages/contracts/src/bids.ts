import { z } from 'zod';

export const PlaceBidDtoSchema = z.object({
  amount: z.coerce.number().positive('Bid amount must be greater than 0'),
});

export type PlaceBidDto = z.infer<typeof PlaceBidDtoSchema>;

export const BidDtoSchema = z.object({
  id: z.string().uuid(),
  auctionId: z.string().uuid(),
  bidderId: z.string().uuid(),
  bidderName: z.string().optional(),
  amount: z.number(),
  createdAt: z.string().datetime(),
});

export type BidDto = z.infer<typeof BidDtoSchema>;

export const PlaceBidResultSchema = z.object({
  bid: BidDtoSchema,
  currentPrice: z.number(),
  bidCount: z.number(),
  endTime: z.string().datetime(),
  extended: z.boolean(),
});

export type PlaceBidResult = z.infer<typeof PlaceBidResultSchema>;
