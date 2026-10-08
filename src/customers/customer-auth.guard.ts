import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verifyCustomerToken } from '../auth/jwt.util';

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { customerId?: string }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Customer session required.');
    }
    try {
      const payload = verifyCustomerToken(authorization.slice(7));
      const restaurantId = request.params?.restaurantId;
      if (restaurantId && payload.restaurant_id !== restaurantId) {
        throw new UnauthorizedException('Customer session is for a different restaurant.');
      }
      request.customerId = payload.customer_id;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Customer session required.');
    }
  }
}
