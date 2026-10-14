import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { parsePagination } from '../common/pagination';
import { FeedbackService } from './feedback.service';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../common/super-admin.guard';

@Controller('public/restaurants/:restaurantId/feedback')
export class PublicFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit(8, 60_000)
  @Post()
  submit(
    @Param('restaurantId') restaurantId: string,
    @Body()
    body: {
      orderId: string;
      rating: number;
      findingEase?: string;
      decisionHelp?: string;
      friction?: string;
      improvement?: string;
    },
  ) {
    return this.feedbackService.submitPublicFeedback(restaurantId, body);
  }
}

@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('super-admin/feedback')
export class PlatformFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  list(
    @CurrentUserId() userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('rating') rating?: string,
  ) {
    return this.feedbackService.listForSuperAdmin(
      userId,
      parsePagination({ page, limit }, 20, 100),
      restaurantId,
      rating,
    );
  }
}
