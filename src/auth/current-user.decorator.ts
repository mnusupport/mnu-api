import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

// Pulls the user id that JwtAuthGuard attached to the request. Only ever
// meaningful on a route already behind @UseGuards(JwtAuthGuard).
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
  return request.userId as string;
});
