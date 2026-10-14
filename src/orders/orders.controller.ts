import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { OrderStatus } from './schemas/order.schema';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { parsePagination } from '../common/pagination';

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = parsePagination({ page, limit });
    return this.ordersService.listOrders(restaurantId, userId, pagination);
  }

  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit(30, 60_000)
  @Get('notifications/summary')
  notifications(
    @Param('restaurantId') restaurantId: string,
    @CurrentUserId() userId: string,
    @Query('since') since?: string,
  ) {
    return this.ordersService.getOrderNotificationSummary(restaurantId, userId, since);
  }

  @Get(':orderId')
  get(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.ordersService.getOrder(restaurantId, orderId, userId);
  }

  // Part 2: dynamic order status, persisted to MongoDB (not hard-coded
  // on the frontend). See OrdersService.updateStatus for the allowed
  // transitions.
  @Patch(':orderId/status')
  updateStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() body: { status: OrderStatus },
    @CurrentUserId() userId: string,
  ) {
    return this.ordersService.updateStatus(restaurantId, orderId, userId, body?.status);
  }
}

// Separate controller (same module, same OrdersService) rather than a
// method on OrdersController — its route is `restaurants/:restaurantId/
// analytics/dashboard`, not nested under `/orders`, since these are
// restaurant-wide metrics rather than an operation on a specific order.
@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId/analytics')
export class AnalyticsController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit(30, 60_000)
  @Get('dashboard')
  getDashboard(
    @Param('restaurantId') restaurantId: string,
    @Query('period') period: 'week' | 'month' = 'week',
    @CurrentUserId() userId: string,
  ) {
    return this.ordersService.getDashboardAnalytics(restaurantId, userId, period);
  }
}

// Same reasoning as AnalyticsController above: a separate controller in
// this same module/file reusing OrdersService, rather than a new
// Customers module depending on Orders — "this restaurant's customers"
// is derived entirely from Order data (see
// OrdersService.listCustomersForRestaurant's own comment), so the
// service method belongs on OrdersService and this controller just
// exposes it under a route shape that reads naturally
// (`restaurants/:id/customers`, `restaurants/:id/customers/:id/orders`)
// rather than nesting it under `/orders`.
@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId/customers')
export class CustomersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = parsePagination({ page, limit });
    return this.ordersService.listCustomersForRestaurant(restaurantId, userId, pagination);
  }

  @Get(':customerId/orders')
  history(
    @Param('restaurantId') restaurantId: string,
    @Param('customerId') customerId: string,
    @CurrentUserId() userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = parsePagination({ page, limit });
    return this.ordersService.listCustomerOrdersForRestaurant(restaurantId, customerId, userId, pagination);
  }
}
