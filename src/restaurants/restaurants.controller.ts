import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { RestaurantsService } from './restaurants.service';

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId')
export class RestaurantsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
  ) {}

  @Get('branding')
  getBranding(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.restaurantsService.getBranding(restaurantId, userId);
  }


  @Patch('branding')
  updateBranding(
    @Param('restaurantId') restaurantId: string,
    @CurrentUserId() userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.restaurantsService.updateBranding(restaurantId, userId, body);
  }

  @Get('profile')
  getProfile(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.restaurantsService.getProfile(restaurantId, userId);
  }

  @Patch('profile')
  updateProfile(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string, @Body() body: Record<string, unknown>) {
    return this.restaurantsService.updateProfile(restaurantId, userId, body);
  }

  @Post('profile/logo')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.restaurantsService.uploadRestaurantLogo(restaurantId, userId, file);
  }

  @Get('billing-settings')
  getBillingSettings(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.restaurantsService.getBillingSettings(restaurantId, userId);
  }

  @Patch('billing-settings')
  updateBillingSettings(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string, @Body() body: Record<string, unknown>) {
    return this.restaurantsService.updateBillingSettings(restaurantId, userId, body);
  }

}
