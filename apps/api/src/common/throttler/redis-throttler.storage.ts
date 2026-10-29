import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../../redis/redis.service.js';

export interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const redis = this.redisService.getClient();
    const redisKey = `throttler:${key}`;

    const multi = redis.multi();
    multi.incr(redisKey);
    multi.pttl(redisKey);

    const results = await multi.exec();
    if (!results) {
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }

    const totalHits = (results[0]?.[1] as number) || 1;
    let pttl = (results[1]?.[1] as number) || -1;

    if (pttl === -1) {
      await redis.pexpire(redisKey, ttl);
      pttl = ttl;
    }

    const timeToExpire = Math.max(0, Math.ceil(pttl / 1000));
    const isBlocked = totalHits > limit;

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? blockDuration : 0,
    };
  }
}
