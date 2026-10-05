import { BadRequestException, Body, Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { parsePagination } from '../common/pagination';

// Public QR ordering needs only a customer name. No login or Customer record is involved.
@Controller('public/restaurants/:restaurantId/orders')
export class PublicOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  @Post()
  create(
    @Param('restaurantId') restaurantId: string,
    @Body() body: { tableId?: string; orderType?: 'DINE_IN' | 'TAKEAWAY'; items: { itemId: string; quantity: number }[]; idempotencyKey?: string; customerName?: string },
  ) {
    return this.ordersService.createOrder(restaurantId, body?.tableId, body?.orderType, body?.items, body?.idempotencyKey, body?.customerName);
  }

  @Get()
  history(
    @Param('restaurantId') restaurantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = parsePagination({ page, limit });
    return this.ordersService.listPublicOrdersForRestaurant(restaurantId, pagination);
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

  @UseGuards(RateLimitGuard)
  @RateLimit(60, 60_000)
  @Get(':orderId')
  getOwnOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getPublicOrderForRestaurant(restaurantId, orderId);
  }
}
