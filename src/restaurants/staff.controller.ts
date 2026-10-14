import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { PlatformAdminService } from '../platform-admin/platform-admin.service';

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId/staff')
export class StaffController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  list(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.platformAdminService.listStaff(userId, restaurantId);
  }
}
