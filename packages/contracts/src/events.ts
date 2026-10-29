import { z } from 'zod';
import { BidDtoSchema } from './bids.js';

export const BidPlacedEventSchema = z.object({
  auctionId: z.string().uuid(),
  bid: BidDtoSchema,
  currentPrice: z.number(),
  bidCount: z.number(),
  endTime: z.string().datetime(),
});

export type BidPlacedEvent = z.infer<typeof BidPlacedEventSchema>;

export const OutbidNoticeEventSchema = z.object({
  auctionId: z.string().uuid(),
  previousBid: z.number(),
  newPrice: z.number(),
});

export type OutbidNoticeEvent = z.infer<typeof OutbidNoticeEventSchema>;

export const AuctionExtendedEventSchema = z.object({
  auctionId: z.string().uuid(),
  newEndTime: z.string().datetime(),
  reason: z.string(),
});

export type AuctionExtendedEvent = z.infer<typeof AuctionExtendedEventSchema>;

export const AuctionClosedEventSchema = z.object({
  auctionId: z.string().uuid(),
  winnerId: z.string().uuid().nullable(),
  winnerName: z.string().nullable().optional(),
  finalPrice: z.number(),
  status: z.literal('ENDED'),
});

export type AuctionClosedEvent = z.infer<typeof AuctionClosedEventSchema>;

export const TimeSyncRequestSchema = z.object({
  clientSendTime: z.number(),
});

export type TimeSyncRequest = z.infer<typeof TimeSyncRequestSchema>;

export const TimeSyncResponseSchema = z.object({
  clientSendTime: z.number(),
  serverReceiveTime: z.number(),
  serverSendTime: z.number(),
});

export type TimeSyncResponse = z.infer<typeof TimeSyncResponseSchema>;

export const AuctionJoinSchema = z.object({
  auctionId: z.string().uuid(),
  lastBidId: z.string().uuid().optional(),
});

export type AuctionJoinPayload = z.infer<typeof AuctionJoinSchema>;

export const AuctionLeaveSchema = z.object({
  auctionId: z.string().uuid(),
});

export type AuctionLeavePayload = z.infer<typeof AuctionLeaveSchema>;

export interface ServerToClientEvents {
  'bid:placed': (event: BidPlacedEvent) => void;
  'bid:outbid': (event: OutbidNoticeEvent) => void;
  'auction:extended': (event: AuctionExtendedEvent) => void;
  'auction:closed': (event: AuctionClosedEvent) => void;
  'time:sync:response': (event: TimeSyncResponse) => void;
  'auction:joined': (payload: { auctionId: string; replayedCount: number }) => void;
  error: (error: { message: string }) => void;
}

export interface ClientToServerEvents {
  'auction:join': (
    payload: AuctionJoinPayload,
    callback?: (response: { status: 'ok'; replayedCount: number }) => void,
  ) => void;
  'auction:leave': (payload: AuctionLeavePayload) => void;
  'time:sync:request': (payload: TimeSyncRequest) => void;
}
