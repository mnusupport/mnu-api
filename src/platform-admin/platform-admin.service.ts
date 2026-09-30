import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthorizationService } from '../common/authorization.service';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { RestaurantMember, RestaurantMemberDocument } from '../restaurant-members/schemas/restaurant-member.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PaginationResult } from '../common/pagination';
import { AuditLog, AuditLogDocument } from '../audit/audit-log.schema';

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(RestaurantMember.name) private readonly memberModel: Model<RestaurantMemberDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  async listAuditLogs(userId: string, pagination: PaginationResult, restaurantId?: string) {
    await this.authorization.requireSuperAdmin(userId);
    if (restaurantId !== undefined && !Types.ObjectId.isValid(restaurantId)) {
      throw new BadRequestException('Invalid restaurantId.');
    }
    const filter = restaurantId ? { restaurantId: new Types.ObjectId(restaurantId) } : {};
    const [rows, total] = await Promise.all([
      this.auditModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
      this.auditModel.countDocuments(filter),
    ]);
    return {
      items: rows.map((row) => ({
        id: row._id.toString(),
        actorUserId: row.actorUserId.toString(),
        actorEmail: row.actorEmail,
        action: row.action,
        method: row.method,
        restaurantId: row.restaurantId.toString(),
        resourceType: row.resourceType,
        resourceId: row.resourceId ?? null,
        statusCode: row.statusCode,
        createdAt: row.createdAt,
      })),
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
    };
  }

  async dashboard(userId: string) {
    await this.authorization.requireSuperAdmin(userId);
    const [totalRestaurants, recent] = await Promise.all([
      this.restaurantModel.countDocuments(),
      this.restaurantModel.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    return {
      totalRestaurants,
      recentRestaurants: recent.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        createdAt: r.createdAt,
      })),
    };
  }

  async listRestaurants(userId: string, pagination: PaginationResult, search?: string) {
    await this.authorization.requireSuperAdmin(userId);
    const cleanSearch = typeof search === 'string' ? search.trim().slice(0, 80) : '';
    const filter = cleanSearch ? { name: { $regex: cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const [restaurants, total] = await Promise.all([
      this.restaurantModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
      this.restaurantModel.countDocuments(filter),
    ]);

    const ids = restaurants.map((r) => r._id);
    const members = ids.length ? await this.memberModel.find({ restaurantId: { $in: ids } }).lean() : [];
    const userIds = [...new Set(members.map((m) => m.userId.toString()))];
    const users = userIds.length ? await this.userModel.find({ _id: { $in: userIds } }).select({ name: 1, email: 1 }).lean() : [];
    const usersById = new Map(users.map((u) => [u._id.toString(), u]));
    const membersByRestaurant = new Map<string, typeof members>();
    for (const member of members) {
      const key = member.restaurantId.toString();
      const list = membersByRestaurant.get(key) ?? [];
      list.push(member);
      membersByRestaurant.set(key, list);
    }

    return {
      items: restaurants.map((r) => {
        const restaurantMembers = membersByRestaurant.get(r._id.toString()) ?? [];
        const admins = restaurantMembers
          .filter((m) => m.role === 'RESTAURANT_ADMIN')
          .map((m) => usersById.get(m.userId.toString()))
          .filter(Boolean)
          .map((u) => ({ name: u!.name, email: u!.email }));
        return {
          id: r._id.toString(),
          name: r.name,
          createdAt: r.createdAt,
          admins,
          memberCount: restaurantMembers.length,
        };
      }),
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  async getRestaurant(userId: string, restaurantId: string) {
    await this.authorization.requireSuperAdmin(userId);
    if (!Types.ObjectId.isValid(restaurantId)) throw new BadRequestException('Invalid restaurant id.');
    const restaurant = await this.restaurantModel.findById(restaurantId).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return { id: restaurant._id.toString(), name: restaurant.name, createdAt: restaurant.createdAt };
  }

  async listStaff(userId: string, restaurantId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    const members = await this.memberModel.find({ restaurantId }).lean();
    const userIds = members.map((m) => m.userId);
    const users = userIds.length ? await this.userModel.find({ _id: { $in: userIds } }).select({ name: 1, email: 1 }).lean() : [];
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    return members.map((m) => ({
      id: m.userId.toString(),
      name: byId.get(m.userId.toString())?.name ?? 'Unknown user',
      email: byId.get(m.userId.toString())?.email ?? null,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }
}
