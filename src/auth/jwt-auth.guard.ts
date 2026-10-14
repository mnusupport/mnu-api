import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verifyToken } from './jwt.util';

// Minimal reusable guard: verifies the Bearer token and attaches the
// decoded user id to the request so any handler behind it (via
// @CurrentUserId()) can access it without re-parsing the header itself.
// This is the "basic authentication guard/middleware" required by Day 4 —
// any future protected route (menu, tables, orders, ...) reuses this
// instead of duplicating the header/verify logic that /auth/me had inline.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Unauthenticated.');
    }

    try {
      const { user_id } = verifyToken(authorization.slice(7));
      request.userId = user_id;
      return true;
    } catch {
      throw new UnauthorizedException('Unauthenticated.');
    }
  }
}
