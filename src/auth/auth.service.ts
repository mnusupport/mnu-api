import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { RestaurantRole } from '../common/enums/restaurant-role.enum';
import { PlatformRole } from '../common/enums/platform-role.enum';
import { RestaurantMember, RestaurantMemberDocument } from '../restaurant-members/schemas/restaurant-member.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { signToken } from './jwt.util';

// Deliberately simple — this is format validation, not deliverability
// checking. Good enough to catch "not an email" without over-engineering.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterInput {
  restaurant_name: string;
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
}

interface LoginInput {
  email: string;
  password: string;
}

// Shape of a RestaurantMember document once `restaurantId` has been
// populated — replaces the Prisma `include: { restaurant: true }` shape.
interface PopulatedMembership {
  restaurantId: { _id: Types.ObjectId; name: string };
  role: RestaurantRole;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(RestaurantMember.name)
    private readonly restaurantMemberModel: Model<RestaurantMemberDocument>,
  ) {}

  async register(input: RegisterInput) {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Registration details are required.');
    }
    if (typeof input.email !== 'string' || !EMAIL_PATTERN.test(input.email.trim())) {
      throw new BadRequestException('Please provide a valid email address.');
    }
    if (typeof input.password !== 'string' || typeof input.password_confirmation !== 'string') {
      throw new BadRequestException('Password is required.');
    }
    if (typeof input.restaurant_name !== 'string' || !input.restaurant_name.trim() || typeof input.name !== 'string' || !input.name.trim()) {
      throw new BadRequestException('Restaurant name and user name are required.');
    }
    if (input.password !== input.password_confirmation) {
      throw new BadRequestException('Passwords do not match.');
    }
    if (input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email });
    if (existing) {
      throw new BadRequestException('Email already in use.');
    }

    // Not wrapped in a transaction: MongoDB multi-document transactions
    // require a replica set, which a default standalone `mongod` doesn't
    // have. These three writes run sequentially instead — fine for this
    // foundation stage, but worth revisiting (either enable a single-node
    // replica set locally, or use Atlas, which is a replica set by
    // default) before this matters for real user data. Same trade-off as
    // before the Mongoose migration, just no longer Prisma-specific.
    const restaurant = await this.restaurantModel.create({ name: input.restaurant_name });

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.userModel.create({ name: input.name.trim(), email, passwordHash, platformRole: PlatformRole.USER });

    const membership = await this.restaurantMemberModel.create({
      userId: user._id,
      restaurantId: restaurant._id,
      role: RestaurantRole.RESTAURANT_ADMIN,
    });

    const token = signToken({ user_id: user._id.toString() });

    return {
      token,
      user: { id: user._id.toString(), name: user.name, email: user.email, platformRole: user.platformRole },
      membership: {
        restaurant_id: membership.restaurantId.toString(),
        restaurant_name: restaurant.name,
        role: membership.role,
      },
    };
  }

  // Single credential check used by the one and only login endpoint. The
  // backend (not the client) determines the account's role afterwards and
  // returns it; there is deliberately no role/portal input here.
  private async authenticate(input: LoginInput) {
    if (!input || typeof input !== 'object' || typeof input.email !== 'string' || typeof input.password !== 'string') {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const email = input.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return user;
  }

  async login(input: LoginInput) {
    const user = await this.authenticate(input);
    const memberships = await this.restaurantMemberModel
      .find({ userId: user._id })
      .populate<{ restaurantId: PopulatedMembership['restaurantId'] }>('restaurantId')
      .lean();
    const token = signToken({ user_id: user._id.toString() });
    return {
      token,
      user: { id: user._id.toString(), name: user.name, email: user.email, platformRole: user.platformRole },
      platformRole: user.platformRole,
      memberships: memberships.map((m) => ({
        restaurant_id: m.restaurantId._id.toString(),
        restaurant_name: m.restaurantId.name,
        role: m.role,
      })),
    };
  }

  async me(userId: string) {
    // A valid JWT could still carry a malformed id (e.g. an old/tampered
    // token) — findById() would otherwise throw a raw Mongoose CastError
    // instead of the clean 401 every other invalid-auth path returns.
    if (!Types.ObjectId.isValid(userId)) {
      throw new UnauthorizedException('Unauthenticated.');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Unauthenticated.');
    }

    const memberships = await this.restaurantMemberModel
      .find({ userId: user._id })
      .populate<{ restaurantId: PopulatedMembership['restaurantId'] }>('restaurantId')
      .lean();

    return {
      user: { id: user._id.toString(), name: user.name, email: user.email, platformRole: user.platformRole },
      platformRole: user.platformRole,
      memberships: memberships.map((m) => ({
        restaurant_id: m.restaurantId._id.toString(),
        restaurant_name: m.restaurantId.name,
        role: m.role,
      })),
    };
  }
}
