import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { BillingService } from './billing.service';

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('orders/:orderId/bill')
  getForOrder(@Param('restaurantId') restaurantId: string, @Param('orderId') orderId: string, @CurrentUserId() userId: string) {
    return this.billing.getForOrder(restaurantId, orderId, userId);
  }

  @Post('orders/:orderId/bill')
  generate(@Param('restaurantId') restaurantId: string, @Param('orderId') orderId: string, @CurrentUserId() userId: string) {
    return this.billing.generate(restaurantId, orderId, userId);
  }


  @Get('bills/:billId')
  getBill(@Param('restaurantId') restaurantId: string, @Param('billId') billId: string, @CurrentUserId() userId: string) {
    return this.billing.getBill(restaurantId, billId, userId);
  }

  @Post('bills/:billId/payment')
  recordPayment(@Param('restaurantId') restaurantId: string, @Param('billId') billId: string, @CurrentUserId() userId: string, @Body() body: { method?: unknown }) {
    return this.billing.recordPayment(restaurantId, billId, userId, body?.method);
  }

  @Get('bills')
  list(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string, @Query() query: { search?: string; status?: string; method?: string; from?: string; to?: string; page?: string; limit?: string }) {
    return this.billing.list(restaurantId, userId, query);
  }
}
