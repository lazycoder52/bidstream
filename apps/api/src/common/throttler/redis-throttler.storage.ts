import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
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
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      const failOpen = this.configService.get<boolean>('THROTTLE_FAIL_OPEN', false);
      if (failOpen) {
        this.logger.warn(
          `Throttler storage encountered error (${err instanceof Error ? err.message : String(err)}). Failing open: allowing request.`,
        );
        return {
          totalHits: 1,
          timeToExpire: Math.ceil(ttl / 1000),
          isBlocked: false,
          timeToBlockExpire: 0,
        };
      }

      this.logger.error(
        `Throttler storage encountered error (${err instanceof Error ? err.message : String(err)}). Failing closed: rejecting request.`,
      );
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'RATE_LIMITER_UNAVAILABLE',
            message: 'Rate limit service is temporarily unavailable (fail-closed policy enforced)',
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
