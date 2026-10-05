import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { CustomerRecognitionService } from './customer-recognition.service';

// Optional customer recognition for the public QR menu. Deliberately separate
// from `public/restaurants/:restaurantId/orders`: order creation never calls
// these endpoints and never requires their result.
//
// Responses are always HTTP 200 with a `status` field so a customer-side
// problem can never look like (or cause) a failed checkout.
@Controller('public/restaurants/:restaurantId/customer-recognition')
@UseGuards(RateLimitGuard)
export class CustomerRecognitionController {
  constructor(private readonly recognition: CustomerRecognitionService) {}

  @Post('resolve')
  @HttpCode(200)
  @RateLimit(60, 60_000)
  resolve(@Param('restaurantId') restaurantId: string, @Body() body: { token?: unknown }) {
    return this.recognition.resolve(restaurantId, body?.token);
  }

  // Phone lookups are tightly rate limited: without OTP this is the endpoint a
  // third party could try to use to probe for known phone numbers.
  @Post('returning')
  @HttpCode(200)
  @RateLimit(10, 60_000)
  returning(@Param('restaurantId') restaurantId: string, @Body() body: { phone?: unknown }) {
    return this.recognition.identifyReturning(restaurantId, body?.phone);
  }

  @Post('register')
  @HttpCode(200)
  @RateLimit(10, 60_000)
  register(@Param('restaurantId') restaurantId: string, @Body() body: { name?: unknown; phone?: unknown }) {
    return this.recognition.register(restaurantId, body?.name, body?.phone);
  }

  @Post('forget')
  @HttpCode(200)
  @RateLimit(30, 60_000)
  forget(@Param('restaurantId') restaurantId: string, @Body() body: { token?: unknown }) {
    return this.recognition.forget(restaurantId, body?.token);
  }
}
