import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { SuperAdminGuard } from '../common/super-admin.guard';
import { parsePagination } from '../common/pagination';
import { PlatformAdminService } from './platform-admin.service';

@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('super-admin')
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @UseGuards(JwtAuthGuard, SuperAdminGuard, RateLimitGuard)
  @RateLimit(30, 60_000)
  @Get('dashboard')
  dashboard(@CurrentUserId() userId: string) {
    return this.service.dashboard(userId);
  }

  @Get('audit-logs')
  auditLogs(
    @CurrentUserId() userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('restaurantId') restaurantId?: string,
  ) {
    return this.service.listAuditLogs(userId, parsePagination({ page, limit }), restaurantId);
  }

  @Get('restaurants')
  restaurants(
    @CurrentUserId() userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listRestaurants(userId, parsePagination({ page, limit }), search);
  }

  @Get('restaurants/:restaurantId')
  restaurant(@CurrentUserId() userId: string, @Param('restaurantId') restaurantId: string) {
    return this.service.getRestaurant(userId, restaurantId);
  }
}
