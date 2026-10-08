import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

// Only ever meaningful on a route behind @UseGuards(CustomerAuthGuard) —
// same pattern as CurrentUserId for staff routes.
export const CurrentCustomerId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { customerId?: string }>();
  return request.customerId as string;
});
