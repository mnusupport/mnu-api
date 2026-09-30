import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { signCustomerToken } from '../auth/jwt.util';

const MOBILE_PATTERN = /^\+?[0-9]{7,15}$/;
const INDIAN_MOBILE_PATTERN = /^[0-9]{10}$/;
const CUSTOMER_NAME_MIN_LENGTH = 2;
const CUSTOMER_NAME_MAX_LENGTH = 80;
const CUSTOMER_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

@Injectable()
export class CustomerAuthService {
  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
  ) {}

  normalizeMobile(value: string): string {
    const compact = value.replace(/[\s()-]/g, '');
    if (INDIAN_MOBILE_PATTERN.test(compact)) return `+91${compact}`;
    return compact;
  }

  validateName(rawName: string): string {
    const name = (rawName ?? '').trim().replace(/\s+/g, ' ');
    if (
      name.length < CUSTOMER_NAME_MIN_LENGTH ||
      name.length > CUSTOMER_NAME_MAX_LENGTH ||
      !CUSTOMER_NAME_PATTERN.test(name)
    ) {
      throw new BadRequestException(
        `Please enter a valid name (${CUSTOMER_NAME_MIN_LENGTH}-${CUSTOMER_NAME_MAX_LENGTH} characters).`,
      );
    }
    return name;
  }

  validatePhone(rawPhone: string): string {
    const compact = (rawPhone ?? '').trim().replace(/[\s()-]/g, '');
    if (!MOBILE_PATTERN.test(compact)) {
      throw new BadRequestException('Please enter a valid phone number.');
    }
    return this.normalizeMobile(compact);
  }

  async identify(restaurantId: string, rawName: string, rawPhone: string) {
    if (!Types.ObjectId.isValid(restaurantId)) throw new NotFoundException('Restaurant not found.');
    const restaurant = await this.restaurantModel.findById(restaurantId).select('_id').lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');

    const name = this.validateName(rawName);
    const mobileNumber = this.validatePhone(rawPhone);

    let customer = await this.customerModel.findOne({ restaurantId, mobileNumber });
    if (!customer) {
      const _id = new Types.ObjectId();
      customer = await this.customerModel.create({
        _id,
        restaurantId: new Types.ObjectId(restaurantId),
        mobileNumber,
        name,
        customerCode: `CUST-${_id.toString().slice(-6).toUpperCase()}`,
      });
    } else if (!customer.name) {
      // Preserve an existing customer-provided name rather than silently
      // overwriting it on every later order.
      customer.name = name;
      await customer.save();
    }

    const token = signCustomerToken(customer._id.toString(), restaurantId);
    return { token, customer: this.serializeCustomer(customer) };
  }

  async updateName(customerId: string, rawName: string) {
    if (!Types.ObjectId.isValid(customerId)) {
      throw new UnauthorizedException('Customer session expired.');
    }
    const name = this.validateName(rawName);
    const customer = await this.customerModel.findById(customerId);
    if (!customer) throw new UnauthorizedException('Customer session expired.');
    customer.name = name;
    await customer.save();
    return this.serializeCustomer(customer);
  }

  async me(customerId: string, restaurantId?: string) {
    if (!Types.ObjectId.isValid(customerId)) throw new UnauthorizedException('Customer session expired.');
    const filter: Record<string, unknown> = { _id: customerId };
    if (restaurantId) {
      if (!Types.ObjectId.isValid(restaurantId)) throw new UnauthorizedException('Customer session expired.');
      filter.restaurantId = restaurantId;
    }
    const customer = await this.customerModel.findOne(filter);
    if (!customer) throw new UnauthorizedException('Customer session expired.');
    return this.serializeCustomer(customer);
  }

  private serializeCustomer(customer: CustomerDocument) {
    return {
      id: customer._id.toString(),
      restaurantId: customer.restaurantId.toString(),
      customerCode: customer.customerCode,
      mobileNumber: customer.mobileNumber ?? null,
      email: customer.email ?? null,
      name: customer.name ?? null,
    };
  }
}
