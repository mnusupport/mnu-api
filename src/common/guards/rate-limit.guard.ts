import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

type Bucket = { count: number; resetAt: number };

type RequestWithIdentity = Request & { userId?: string };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<RequestWithIdentity>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    const route = `${request.method}:${request.route?.path ?? request.path}`;
    const identity = request.userId ? `user:${request.userId}` : `ip:${request.ip ?? 'unknown'}`;
    const key = `${route}:${identity}`;
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    response.setHeader('X-RateLimit-Limit', String(options.limit));
    response.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.limit - bucket.count)));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.limit) {
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Prevent unbounded growth in a long-lived process. This is intentionally
    // small and local; a multi-instance deployment should move these buckets
    // to shared infrastructure rather than treating memory as distributed state.
    if (this.buckets.size > 10000) {
      for (const [bucketKey, candidate] of this.buckets) {
        if (candidate.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }

    return true;
  }
}
