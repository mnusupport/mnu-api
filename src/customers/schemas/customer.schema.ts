import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

const CUSTOMER_NAME_MIN_LENGTH = 2;
const CUSTOMER_NAME_MAX_LENGTH = 80;
const CUSTOMER_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

function normalizeCustomerName(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ');
}

// One remembered browser/device for a customer, scoped by the owning Customer's
// restaurantId. Only a SHA-256 hash of the random browser token is stored; the
// raw token lives only in that browser. Recognition is a convenience layer and
// is never consulted by order creation.
@Schema({ _id: false })
export class CustomerRecognitionToken {
  @Prop({ type: String, required: true })
  tokenHash: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}
export const CustomerRecognitionTokenSchema = SchemaFactory.createForClass(CustomerRecognitionToken);

// Customer identity is scoped to the restaurant. The same phone number may
// legitimately belong to separate customer records at different restaurants;
// order history and profile data therefore cannot cross restaurant boundaries.
@Schema({ timestamps: true })
export class Customer {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId: Types.ObjectId;

  // Optional for legacy records; new QR orders always supply a phone number.
  @Prop({ type: String, required: false })
  mobileNumber?: string;

  @Prop({ type: String, required: false, unique: true, sparse: true })
  email?: string;

  @Prop({
    type: String,
    required: false,
    set: normalizeCustomerName,
    validate: {
      validator: (value: string | undefined) =>
        value == null ||
        (value.length >= CUSTOMER_NAME_MIN_LENGTH &&
          value.length <= CUSTOMER_NAME_MAX_LENGTH &&
          CUSTOMER_NAME_PATTERN.test(value)),
      message: `Customer name must be ${CUSTOMER_NAME_MIN_LENGTH}-${CUSTOMER_NAME_MAX_LENGTH} characters and contain only valid name characters.`,
    },
  })
  name?: string;

  // Short, human-facing identifier — same convention as Order.orderNumber
  // and TableSession.sessionId: nobody should ever have to read out a
  // raw ObjectId. Matches the "CUST_10284" style example in the task.
  @Prop({ type: String, required: true, unique: true })
  customerCode: string;

  // Remembered browsers (hashed). `select: false` keeps hashes out of every
  // existing query (admin customer list/history) unless explicitly requested;
  // `default: undefined` avoids writing an empty array onto every customer.
  @Prop({ type: [CustomerRecognitionTokenSchema], default: undefined, select: false })
  recognitionTokens?: CustomerRecognitionToken[];

  createdAt: Date;
  updatedAt: Date;
}

export type CustomerDocument = HydratedDocument<Customer>;
export const CustomerSchema = SchemaFactory.createForClass(Customer);

CustomerSchema.index({ restaurantId: 1, mobileNumber: 1 }, { unique: true, sparse: true });

// Additive, NON-unique, partial index for browser-recognition lookups
// ({ restaurantId, token hash }). The existing unique sparse
// { restaurantId, mobileNumber } index above is untouched.
CustomerSchema.index(
  { restaurantId: 1, 'recognitionTokens.tokenHash': 1 },
  { partialFilterExpression: { 'recognitionTokens.tokenHash': { $exists: true } } },
);
