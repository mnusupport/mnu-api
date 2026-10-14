import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'mnu_rate_limit';
export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RateLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } as RateLimitOptions);
