import { BadRequestException, Body, Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { parsePagination } from '../common/pagination';
import { CustomerAuthGuard } from '../customers/customer-auth.guard';
import { CurrentCustomerId } from '../customers/current-customer.decorator';

// Public QR ordering stays anonymous until checkout. Customer identity is
// captured as name + phone on the order request; the server creates or
// recognizes the restaurant-scoped customer record and returns a session
// token for repeat ordering/history. The phone is not verified.
@Controller('public/restaurants/:restaurantId/orders')
export class PublicOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  @Post()
  create(
    @Param('restaurantId') restaurantId: string,
    @Body() body: { tableId: string; items: { itemId: string; quantity: number }[]; customer?: { name: string; phone: string }; idempotencyKey?: string },
  ) {
    return this.ordersService.createOrder(restaurantId, body?.tableId, body?.items, body?.customer?.name ?? '', body?.customer?.phone ?? '', body?.idempotencyKey);
  }

  // Day 14 — backs the customer Home page's "Popular" section with real
  // order history instead of a fabricated field. See
  // OrdersService.getPopularItems() for exactly what "popular" means
  // here and why it can legitimately return an empty array.
  @UseGuards(CustomerAuthGuard)
  @Get()
  history(
    @Param('restaurantId') restaurantId: string,
    @CurrentCustomerId() customerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = parsePagination({ page, limit });
    return this.ordersService.listOwnOrdersForRestaurant(restaurantId, customerId, pagination);
  }

  @Get('popular')
  getPopular(@Param('restaurantId') restaurantId: string, @Query('limit') limit?: string) {
    if (limit !== undefined && !/^\d+$/.test(limit)) {
      throw new BadRequestException('Limit must be a positive integer.');
    }
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20)) {
      throw new BadRequestException('Limit must be an integer between 1 and 20.');
    }
    return this.ordersService.getPopularItems(restaurantId, parsedLimit);
  }

  @UseGuards(CustomerAuthGuard, RateLimitGuard)
  @RateLimit(60, 60_000)
  @Get(':orderId')
  getOwnOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @CurrentCustomerId() customerId: string,
  ) {
    return this.ordersService.getOwnOrderForRestaurant(restaurantId, orderId, customerId);
  }
}
