import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Customer } from '../../customers/schemas/customer.schema';
import { MenuItem } from '../../menu/schemas/menu-item.schema';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { Table } from '../../tables/schemas/table.schema';
import { TableSession } from '../../table-sessions/schemas/table-session.schema';

export enum GroupOrderStatus {
  OPEN = 'OPEN',
  // The group's single combined Order has been placed. Terminal: members
  // can still view the lobby, but nobody can add items or submit again.
  ORDERED = 'ORDERED',
  CLOSED = 'CLOSED',
}

// One member's current contribution to the group. Deliberately a
// *snapshot of that member's own cart*, not a second cart system:
// lib/cart.ts (localStorage, per-restaurant) remains the single source
// of truth for what a customer is personally building, and this is only
// what they've explicitly shared with the group so far. Part 7's "do not
// duplicate the existing cart system unnecessarily" is why this stores
// item references + quantities rather than reimplementing add/remove
// semantics server-side.
//
// Prices are NOT stored here. A group lobby's totals are recomputed from
// live MenuItem prices on every read (see GroupOrdersService.serialize)
// — the price *snapshot* that matters legally is the one taken at order
// creation (Order.items, Day 12), and this is a pre-order staging area,
// not an order.
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
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Customer.name, required: true })
  customerId: Types.ObjectId;

  // Display-name snapshot taken at join time. Customer.name is optional
  // (a diner can verify with just a phone and never give a name), so the
  // lobby falls back to a masked contact/customerCode — see
  // GroupOrdersService.displayNameFor.
  @Prop({ type: String, default: null })
  displayName: string | null;

  @Prop({ type: Date, required: true })
  joinedAt: Date;

  @Prop({ type: [GroupMemberItemSchema], default: [] })
  items: GroupMemberItem[];
}

export const GroupMemberSchema = SchemaFactory.createForClass(GroupMember);

// A group order is pinned to one restaurant AND one table AND one table
// session. All three are stored (not derived on read) so a group can
// never be re-pointed at a different restaurant later, and so an expired
// table session makes its groups verifiably stale rather than silently
// portable. Part 9/10: every lookup in the service filters by
// restaurantId *together with* groupCode — a code alone is never a key.
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

  // Short, human-readable join code — the same "nobody reads out a raw
  // ObjectId" convention as Order.orderNumber / Customer.customerCode.
  // Unique globally (not just per restaurant) so a customer who mistypes
  // can never silently land in a *different* restaurant's group; the
  // service still re-checks restaurantId on every lookup regardless.
  @Prop({ type: String, required: true, unique: true })
  groupCode: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Customer.name, required: true })
  createdByCustomerId: Types.ObjectId;

  @Prop({ type: String, enum: GroupOrderStatus, default: GroupOrderStatus.OPEN })
  status: GroupOrderStatus;

  @Prop({ type: [GroupMemberSchema], default: [] })
  members: GroupMember[];

  // The one Order this group produced, once submitted. A group places
  // exactly one order — this field is both the link to it and the
  // idempotency guard that stops a second member submitting a duplicate.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: false, default: null })
  placedOrderId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, default: null })
  placedOrderNumber?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type GroupOrderDocument = HydratedDocument<GroupOrder>;
export const GroupOrderSchema = SchemaFactory.createForClass(GroupOrder);

// NOTE: no explicit index on `groupCode` here — `@Prop({ unique: true })`
// above already creates one, and declaring it both ways makes Mongoose
// emit a "Duplicate schema index" warning at boot.
// "Is there already an open group at this table?" — the create path.
GroupOrderSchema.index({ tableSessionId: 1, status: 1 });
// Restaurant-scoped listing, consistent with every other schema here.
GroupOrderSchema.index({ restaurantId: 1, createdAt: -1 });
