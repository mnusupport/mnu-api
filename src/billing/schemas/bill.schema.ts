import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { Order } from '../../orders/schemas/order.schema';

export type BillPaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER';
export type BillPaymentStatus = 'UNPAID' | 'PAID';

@Schema({ _id: false })
export class BillLineSnapshot {
  @Prop({ type: String, required: true }) name: string;
  @Prop({ type: Number, required: true, min: 0 }) quantity: number;
  @Prop({ type: Number, required: true, min: 0 }) unitPrice: number;
  @Prop({ type: Number, required: true, min: 0 }) lineTotal: number;
}
export const BillLineSnapshotSchema = SchemaFactory.createForClass(BillLineSnapshot);

@Schema({ _id: false })
export class BillPayment {
  @Prop({ type: String, enum: ['CASH', 'UPI', 'CARD', 'OTHER'], required: true }) method: BillPaymentMethod;
  @Prop({ type: Number, required: true, min: 0 }) amount: number;
  @Prop({ type: Date, required: true }) recordedAt: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) recordedBy: Types.ObjectId;
}
export const BillPaymentSchema = SchemaFactory.createForClass(BillPayment);

@Schema({ timestamps: true, collection: 'RestaurantBill' })
export class RestaurantBill {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true, index: true }) restaurantId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Order.name, required: true }) orderId: Types.ObjectId;
  @Prop({ type: String, required: true }) orderNumber: string;
  @Prop({ type: String, required: true }) invoiceNumber: string;
  // Numeric part of invoiceNumber. Bills are numbered max(existing)+1 AT INSERT TIME, so a number is only
  // ever consumed by a bill that was actually saved (no gaps from retries/races). Optional for bills created
  // before this field existed; the legacy per-restaurant counter is still honoured when picking the next number.
  @Prop({ type: Number, required: false, min: 1 }) invoiceSequence?: number;
  @Prop({ type: Date, required: true }) issuedAt: Date;
  @Prop({ type: String, required: true }) invoiceKind: 'TAX_INVOICE' | 'RECEIPT';
  @Prop({ type: Object, required: true }) restaurantSnapshot: Record<string, unknown>;
  @Prop({ type: Object, required: true }) orderSnapshot: Record<string, unknown>;
  @Prop({ type: [BillLineSnapshotSchema], required: true }) items: BillLineSnapshot[];
  @Prop({ type: Number, required: true, min: 0 }) subtotal: number;
  @Prop({ type: Number, required: true, min: 0, default: 0 }) discountAmount: number;
  @Prop({ type: Number, required: true, min: 0, default: 0 }) serviceChargeAmount: number;
  @Prop({ type: Number, required: true, min: 0, default: 0 }) taxableAmount: number;
  @Prop({ type: Number, required: true, min: 0, default: 0 }) taxRatePercent: number;
  @Prop({ type: Number, required: true, min: 0, default: 0 }) taxAmount: number;
  @Prop({ type: Object, required: true, default: {} }) taxBreakdown: Record<string, unknown>;
  @Prop({ type: Number, required: true, min: 0 }) total: number;
  @Prop({ type: String, enum: ['UNPAID', 'PAID'], default: 'UNPAID', required: true }) paymentStatus: BillPaymentStatus;
  @Prop({ type: BillPaymentSchema, default: null }) payment?: BillPayment | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) generatedBy: Types.ObjectId;
  // A bill is never deleted (its number stays in the sequence). If its order is cancelled before payment,
  // the bill is marked void instead. A paid bill blocks cancellation (no refund / credit-note flow exists).
  @Prop({ type: Date, default: null }) voidedAt?: Date | null;
  @Prop({ type: String, default: null }) voidReason?: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null }) voidedBy?: Types.ObjectId | null;
  @Prop({ type: String, required: true }) currency: string;
  createdAt: Date;
  updatedAt: Date;
}
export type RestaurantBillDocument = HydratedDocument<RestaurantBill>;
export const RestaurantBillSchema = SchemaFactory.createForClass(RestaurantBill);
RestaurantBillSchema.index({ restaurantId: 1, orderId: 1 }, { unique: true });
RestaurantBillSchema.index({ restaurantId: 1, invoiceNumber: 1 }, { unique: true });
RestaurantBillSchema.index({ restaurantId: 1, issuedAt: -1 });
RestaurantBillSchema.index({ restaurantId: 1, invoiceSequence: -1 });

@Schema({ timestamps: true, collection: 'RestaurantInvoiceCounter' })
export class RestaurantInvoiceCounter {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true, unique: true }) restaurantId: Types.ObjectId;
  @Prop({ type: Number, required: true, default: 0, min: 0 }) sequence: number;
  createdAt: Date;
  updatedAt: Date;
}
export type RestaurantInvoiceCounterDocument = HydratedDocument<RestaurantInvoiceCounter>;
export const RestaurantInvoiceCounterSchema = SchemaFactory.createForClass(RestaurantInvoiceCounter);
