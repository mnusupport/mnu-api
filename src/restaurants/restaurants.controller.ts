import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { RestaurantsService } from './restaurants.service';

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId/branding')
export class RestaurantsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
  ) {}

  @Get()
  getBranding(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.restaurantsService.getBranding(restaurantId, userId);
  }


  @Patch()
  updateBranding(
    @Param('restaurantId') restaurantId: string,
    @CurrentUserId() userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.restaurantsService.updateBranding(restaurantId, userId, body);
  }
}
