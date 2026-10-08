import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { RestaurantMember, RestaurantMemberSchema } from '../restaurant-members/schemas/restaurant-member.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { SuperAdminGuard } from '../common/super-admin.guard';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Restaurant.name, schema: RestaurantSchema },
    { name: RestaurantMember.name, schema: RestaurantMemberSchema },
    { name: User.name, schema: UserSchema },
  ])],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, SuperAdminGuard],
})
export class PlatformAdminModule {}
