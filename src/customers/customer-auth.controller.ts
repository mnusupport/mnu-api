import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CurrentCustomerId } from './current-customer.decorator';

@Controller('public/customer-auth')
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  // This is identity capture, not authentication by a third-party verifier.
  // The phone number is customer-provided and is never marked as verified.
  @Post('identify')
  identify(@Body() body: { restaurantId: string; name: string; phone: string }) {
    return this.customerAuthService.identify(body?.restaurantId, body?.name, body?.phone);
  }

  @UseGuards(CustomerAuthGuard)
  @Post('me/name')
  updateName(@CurrentCustomerId() customerId: string, @Body() body: { name: string }) {
    return this.customerAuthService.updateName(customerId, body.name);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('me')
  me(@CurrentCustomerId() customerId: string) {
    return this.customerAuthService.me(customerId);
  }
}
