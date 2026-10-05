import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { Table } from '../../tables/schemas/table.schema';
import { TableSession } from '../../table-sessions/schemas/table-session.schema';
import { MenuItem } from '../../menu/schemas/menu-item.schema';

export enum GroupOrderStatus {
  OPEN = 'OPEN',
  ORDERED = 'ORDERED',
  CLOSED = 'CLOSED',
}

@Schema({ _id: false })
export class GroupMemberItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: MenuItem.name, required: true })
  menuItemId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;
}
export const GroupMemberItemSchema = SchemaFactory.createForClass(GroupMemberItem);

@Schema({ _id: false })
export class GroupMember {
  // Anonymous browser participant. This is not a customer account, auth
  // credential, phone number, or persistent customer record.
  @Prop({ type: String, required: false, default: null })
  participantId?: string | null;

  @Prop({ type: String, required: false, default: 'Guest' })
  displayName?: string | null;

  @Prop({ type: Date, required: true })
  joinedAt: Date;

  @Prop({ type: [GroupMemberItemSchema], default: [] })
  items: GroupMemberItem[];
}
export const GroupMemberSchema = SchemaFactory.createForClass(GroupMember);

@Schema({ timestamps: true })
export class GroupOrder {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Table.name, required: true })
  tableId: Types.ObjectId;

  @Prop({ type: String, required: true })
  tableNumber: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: TableSession.name, required: true })
  tableSessionId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  groupCode: string;

  @Prop({ type: String, required: false, default: null })
  createdByParticipantId?: string | null;

  @Prop({ type: String, enum: GroupOrderStatus, default: GroupOrderStatus.OPEN })
  status: GroupOrderStatus;

  @Prop({ type: [GroupMemberSchema], default: [] })
  members: GroupMember[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: false, default: null })
  placedOrderId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, default: null })
  placedOrderNumber?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type GroupOrderDocument = HydratedDocument<GroupOrder>;
export const GroupOrderSchema = SchemaFactory.createForClass(GroupOrder);
GroupOrderSchema.index({ tableSessionId: 1, status: 1 });
GroupOrderSchema.index({ restaurantId: 1, createdAt: -1 });
