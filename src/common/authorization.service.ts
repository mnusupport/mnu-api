import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PlatformRole } from './enums/platform-role.enum';
import { RestaurantRole } from './enums/restaurant-role.enum';
import { RestaurantMember, RestaurantMemberDocument } from '../restaurant-members/schemas/restaurant-member.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(RestaurantMember.name) private readonly memberModel: Model<RestaurantMemberDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
  ) {}

  async getPlatformRole(userId: string): Promise<PlatformRole> {
    if (!Types.ObjectId.isValid(userId)) throw new ForbiddenException('Unauthenticated.');
    const user = await this.userModel.findById(userId).select({ platformRole: 1 }).lean();
    if (!user) throw new ForbiddenException('Unauthenticated.');
    return user.platformRole ?? PlatformRole.USER;
  }

  async requireSuperAdmin(userId: string) {
    if (await this.getPlatformRole(userId) !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super Admin access required.');
    }
  }

  async requireRestaurantAccess(restaurantId: string, userId: string, manager = false) {
    if (!Types.ObjectId.isValid(restaurantId)) throw new NotFoundException('Restaurant not found.');
    if (await this.getPlatformRole(userId) === PlatformRole.SUPER_ADMIN) {
      // Super Admin may cross restaurant boundaries, but only to a restaurant
      // that actually exists — otherwise a mistyped/forged id could create
      // orphaned menu/table/category records under a non-existent restaurant.
      const exists = await this.restaurantModel.exists({ _id: restaurantId });
      if (!exists) throw new NotFoundException('Restaurant not found.');
      return { platformRole: PlatformRole.SUPER_ADMIN as const, membership: null };
    }

    const membership = await this.memberModel.findOne({ restaurantId, userId }).lean();
    if (!membership) throw new ForbiddenException('You are not a member of this restaurant.');
    if (manager && membership.role !== RestaurantRole.RESTAURANT_ADMIN) {
      throw new ForbiddenException('Only restaurant admins can manage this resource.');
    }
    return { platformRole: PlatformRole.USER as const, membership };
  }
}
