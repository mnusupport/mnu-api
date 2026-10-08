import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { Order } from '../orders/schemas/order.schema';

export enum FeedbackFindingEase {
  EASY = 'EASY',
  MOSTLY = 'MOSTLY',
  SEARCHED = 'SEARCHED',
  COULD_NOT_FIND = 'COULD_NOT_FIND',
}

export enum FeedbackDecisionHelp {
  YES = 'YES',
  A_LITTLE = 'A_LITTLE',
  NOT_REALLY = 'NOT_REALLY',
  KNEW = 'KNEW',
}

@Schema({ timestamps: true })
export class Feedback {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  // Snapshot for the Super Admin view so historical feedback remains
  // understandable even if a restaurant later changes its name.
  @Prop({ type: String, required: true })
  restaurantName: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Order.name, required: true })
  orderId: Types.ObjectId;

  // Snapshot for a compact admin list; avoids an order lookup for every row.
  @Prop({ type: String, required: true })
  orderNumber: string;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ type: String, enum: Object.values(FeedbackFindingEase), required: false, default: null })
  findingEase?: FeedbackFindingEase | null;

  @Prop({ type: String, enum: Object.values(FeedbackDecisionHelp), required: false, default: null })
  decisionHelp?: FeedbackDecisionHelp | null;

  @Prop({ type: String, required: false, default: null, maxlength: 600 })
  friction?: string | null;

  @Prop({ type: String, required: false, default: null, maxlength: 600 })
  improvement?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type FeedbackDocument = HydratedDocument<Feedback>;
export const FeedbackSchema = SchemaFactory.createForClass(Feedback);

// One response per placed order keeps the platform feedback dataset from
// being inflated by repeated submissions from the same order confirmation.
FeedbackSchema.index({ orderId: 1 }, { unique: true });
FeedbackSchema.index({ restaurantId: 1, createdAt: -1 });
FeedbackSchema.index({ rating: 1, createdAt: -1 });
