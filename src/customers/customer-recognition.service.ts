import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import {
  ContactValidationError,
  legacyMobileCandidates,
  maskMobile,
  validateCustomerName,
  validateMobile,
} from './customer-contact.util';

// Customer recognition is an OPTIONAL CONVENIENCE layer.
//
//   recognition  ->  (maybe) a display name  ->  the browser sends it as the
//                                                normal `customerName`
//
// OrdersService.createOrder() never calls this service and never needs a
// customer. Every public method here is therefore total: validation problems
// become `{ status: 'invalid' }` and any database/infrastructure problem becomes
// `{ status: 'unavailable' }`. Nothing in this file throws to the HTTP layer,
// so a customer-database problem can never surface as a 500 during checkout.

// A browser may remember several devices per customer; keep the newest N so a
// customer document can never grow without bound.
const MAX_REMEMBERED_BROWSERS = 10;
// 32 random bytes, base64url, no padding => exactly 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CREATE_ATTEMPTS = 3;

export interface RecognizedCustomerView {
  name: string | null;
  maskedPhone: string;
}

export type RecognitionResponse =
  | { status: 'recognized'; customer: RecognizedCustomerView; token?: string }
  | { status: 'unrecognized' }
  | { status: 'not_found' }
  | { status: 'invalid'; message: string }
  | { status: 'cleared' }
  | { status: 'unavailable' };

type CustomerLike = { _id: Types.ObjectId; name?: string | null; mobileNumber?: string | null };

function hashToken(rawToken: unknown): string | null {
  if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) return null;
  return createHash('sha256').update(rawToken).digest('hex');
}

function isDuplicateKeyError(error: unknown): error is { code: number; keyPattern?: Record<string, unknown>; index?: string } {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

@Injectable()
export class CustomerRecognitionService {
  private readonly logger = new Logger(CustomerRecognitionService.name);

  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
  ) {}

  // Case 3 — same browser. The token is validated server-side and only matches a
  // customer of THIS restaurant, so a token from restaurant A can never
  // recognize anyone in restaurant B.
  /**
   * Internal identity check for features that are allowed to use the
   * restaurant-scoped recognition token. The raw token never leaves the
   * server-facing header/body boundary and is never returned to callers.
   * A bad/missing token simply means there is no recognized customer.
   */
  async resolveCustomerId(restaurantId: string, rawToken: unknown): Promise<Types.ObjectId | null> {
    const tokenHash = hashToken(rawToken);
    const restaurantObjectId = this.toObjectId(restaurantId);
    if (!tokenHash || !restaurantObjectId) return null;
    try {
      const customer = await this.customerModel
        .findOne({ restaurantId: restaurantObjectId, 'recognitionTokens.tokenHash': tokenHash })
        .select('_id')
        .lean();
      return customer?._id ?? null;
    } catch (error) {
      this.logFailure('resolveCustomerId', restaurantId, error);
      return null;
    }
  }

  async resolve(restaurantId: string, rawToken: unknown): Promise<RecognitionResponse> {
    const tokenHash = hashToken(rawToken);
    const restaurantObjectId = this.toObjectId(restaurantId);
    if (!tokenHash || !restaurantObjectId) return { status: 'unrecognized' };
    try {
      const customer = await this.customerModel
        .findOne({ restaurantId: restaurantObjectId, 'recognitionTokens.tokenHash': tokenHash })
        .select('name mobileNumber')
        .lean();
      if (!customer) return { status: 'unrecognized' };
      return { status: 'recognized', customer: this.view(customer) };
    } catch (error) {
      this.logFailure('resolve', restaurantId, error);
      return { status: 'unavailable' };
    }
  }

  // Case 2 — existing customer on a NEW browser, identified by phone alone.
  async identifyReturning(restaurantId: string, rawPhone: unknown): Promise<RecognitionResponse> {
    let mobileNumber: string;
    try {
      mobileNumber = validateMobile(rawPhone);
    } catch (error) {
      return this.invalid(error);
    }
    const restaurantObjectId = this.toObjectId(restaurantId);
    if (!restaurantObjectId) return { status: 'unavailable' };
    try {
      const customer = await this.findByPhone(restaurantObjectId, mobileNumber);
      if (!customer) return { status: 'not_found' };
      const token = await this.issueToken(customer._id);
      return { status: 'recognized', token, customer: this.view(customer) };
    } catch (error) {
      this.logFailure('returning', restaurantId, error, mobileNumber);
      return { status: 'unavailable' };
    }
  }

  // Case 1 — new customer. If the phone already belongs to a customer of this
  // restaurant, that customer is reused (never duplicated) and keeps their
  // stored name.
  async register(restaurantId: string, rawName: unknown, rawPhone: unknown): Promise<RecognitionResponse> {
    let name: string;
    let mobileNumber: string;
    try {
      name = validateCustomerName(rawName);
      mobileNumber = validateMobile(rawPhone);
    } catch (error) {
      return this.invalid(error);
    }
    const restaurantObjectId = this.toObjectId(restaurantId);
    if (!restaurantObjectId) return { status: 'unavailable' };
    try {
      const restaurantExists = await this.restaurantModel.exists({ _id: restaurantObjectId });
      if (!restaurantExists) return { status: 'unavailable' };

      let customer: CustomerLike | null = await this.findByPhone(restaurantObjectId, mobileNumber);
      for (let attempt = 0; attempt < CREATE_ATTEMPTS && !customer; attempt += 1) {
        const _id = new Types.ObjectId();
        try {
          customer = await this.customerModel.create({
            _id,
            restaurantId: restaurantObjectId,
            mobileNumber,
            name,
            customerCode: `CUST-${_id.toString().slice(-6).toUpperCase()}`,
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          // A concurrent request may have created the same restaurant+phone
          // customer first. The unique index arbitrates; re-read and reuse.
          customer = await this.findByPhone(restaurantObjectId, mobileNumber);
          if (!customer) {
            // Not a same-restaurant phone duplicate (e.g. a customerCode
            // collision, retried with a new id, or a legacy/global index).
            // Log index details (never the phone/token) for diagnosis.
            this.logger.error(
              `Customer recognition duplicate-key conflict (restaurantId=${restaurantId}, operation=register, attempt=${attempt + 1}, phone=${maskMobile(mobileNumber)}, keyPattern=${JSON.stringify(error.keyPattern ?? {})}, index=${error.index ?? 'unknown'}).`,
            );
          }
        }
      }
      if (!customer) return { status: 'unavailable' };

      if (!customer.name?.trim()) {
        // Fill a missing legacy name only; never overwrite an existing one.
        await this.customerModel.updateOne({ _id: customer._id, restaurantId: restaurantObjectId }, { $set: { name } });
        customer = { _id: customer._id, name, mobileNumber: customer.mobileNumber };
      }

      const token = await this.issueToken(customer._id);
      return { status: 'recognized', token, customer: this.view(customer) };
    } catch (error) {
      this.logFailure('register', restaurantId, error, mobileNumber);
      return { status: 'unavailable' };
    }
  }

  // Case 4 — "Change customer". Revokes only THIS browser's token for THIS
  // restaurant. The Customer, other devices, other restaurants, previous orders
  // and admin authentication are untouched.
  async forget(restaurantId: string, rawToken: unknown): Promise<RecognitionResponse> {
    const tokenHash = hashToken(rawToken);
    const restaurantObjectId = this.toObjectId(restaurantId);
    if (!tokenHash || !restaurantObjectId) return { status: 'cleared' };
    try {
      await this.customerModel.updateOne(
        { restaurantId: restaurantObjectId, 'recognitionTokens.tokenHash': tokenHash },
        { $pull: { recognitionTokens: { tokenHash } } },
      );
      return { status: 'cleared' };
    } catch (error) {
      this.logFailure('forget', restaurantId, error);
      return { status: 'unavailable' };
    }
  }

  // ---- internals ----

  private findByPhone(restaurantId: Types.ObjectId, mobileNumber: string) {
    return this.customerModel
      .findOne({ restaurantId, mobileNumber: { $in: legacyMobileCandidates(mobileNumber) } })
      .select('name mobileNumber')
      .lean<CustomerLike>();
  }

  private async issueToken(customerId: Types.ObjectId): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const result = await this.customerModel.updateOne(
      { _id: customerId },
      {
        $push: {
          recognitionTokens: {
            $each: [{ tokenHash: hashToken(token) as string, createdAt: new Date() }],
            $slice: -MAX_REMEMBERED_BROWSERS,
          },
        },
      },
    );
    if (result.matchedCount === 0) throw new Error('Customer disappeared while issuing a recognition token.');
    return token;
  }

  private view(customer: CustomerLike): RecognizedCustomerView {
    return { name: customer.name?.trim() || null, maskedPhone: maskMobile(customer.mobileNumber) };
  }

  private toObjectId(id: string): Types.ObjectId | null {
    return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
  }

  private invalid(error: unknown): RecognitionResponse {
    if (error instanceof ContactValidationError) return { status: 'invalid', message: error.message };
    return { status: 'invalid', message: 'Please check the details and try again.' };
  }

  // Never logs the raw phone, the token, or the token hash.
  private logFailure(operation: string, restaurantId: string, error: unknown, mobileNumber?: string) {
    this.logger.error(
      `Customer recognition failed (operation=${operation}, restaurantId=${restaurantId}${mobileNumber ? `, phone=${maskMobile(mobileNumber)}` : ''}). Falling back to name-only ordering.`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
