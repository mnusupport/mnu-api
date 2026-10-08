import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { Table } from '../../tables/schemas/table.schema';
import { TableSession } from '../../table-sessions/schemas/table-session.schema';
import { MenuItem } from '../../menu/schemas/menu-item.schema';

// Full lifecycle (this task): NEW is where every order starts; from
// there an admin/staff member moves it forward one step at a time
// (enforced in OrdersService.updateStatus, not in the schema itself),
// ending at the terminal COMPLETED — or CANCELLED, reachable from any
// non-terminal state.
export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
}

export enum OrderStatus {
  NEW = 'NEW',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// One line of an order. Deliberately a *snapshot* of the menu item at
// the moment of ordering (name/price copied in, not just a reference) —
// if the restaurant later renames the item or changes its price, past
// orders must keep showing what the customer actually saw and paid.
// This is exactly why menuItemId is kept too: to trace back to the
// current item if needed, while name/price/lineTotal never change again
// after creation.
@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: MenuItem.name, required: true })
  menuItemId: Types.ObjectId;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: Number, required: true })
  price: number;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: Number, required: true })
  lineTotal: number;

  // Snapshot of the menu image at checkout so historical admin orders do not
  // depend on the current menu item remaining unchanged.
  @Prop({ type: String, required: false, default: null })
  imageUrl?: string | null;

  // ---- Group ordering ----
  // Who at the table asked for this line. Null on a normal solo order;
  // always set on a group order, because a single combined order is
  // useless to the floor staff if nobody can tell who the biryani
  // belongs to. `addedByName` is a snapshot for the same reason every
  // other display string here is one — the admin order view must not
  // depend on a Customer lookup that could change or disappear later.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', required: false, default: null })
  addedByCustomerId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, default: null })
  addedByName?: string | null;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ _id: false })
export class OrderGroupMemberSnapshot {
  @Prop({ type: String, required: true })
  participantId: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: false, default: null })
  phoneMasked?: string | null;
}
export const OrderGroupMemberSnapshotSchema = SchemaFactory.createForClass(OrderGroupMemberSnapshot);

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Table.name, required: false, default: null })
  tableId?: Types.ObjectId | null;

  // Snapshotted alongside tableId, same rationale as item name/price
  // above — the admin orders list (Day 12, Part 5) needs to show a
  // table number per row without an extra lookup per order, and a
  // table's own number could in principle be renamed later without that
  // affecting what an already-placed order displays.
  @Prop({ type: String, required: false, default: null })
  tableNumber?: string | null;

  @Prop({ type: String, enum: OrderType, required: true, default: OrderType.DINE_IN })
  orderType: OrderType;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: TableSession.name, required: false, default: null })
  tableSessionId?: Types.ObjectId | null;

  // Short, customer/admin-facing identifier — distinct from Mongo's own
  // _id, same reasoning as TableSession.sessionId: never make someone
  // read out a raw ObjectId.
  @Prop({ type: String, required: true })
  orderNumber: string;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ type: Number, required: true })
  subtotal: number;

  // Equal to subtotal for now — no tax/fees/discounts exist yet. Kept
  // as its own field (not derived at read time) because a future task
  // adding fees/discounts will need `total` to diverge from `subtotal`
  // without a schema change.
  @Prop({ type: Number, required: true })
  total: number;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.NEW })
  status: OrderStatus;
  // Client-generated idempotency key for a single checkout attempt. A
  // network retry with the same key returns the original order instead of
  // creating a duplicate. It is optional for legacy rows.
  @Prop({ type: String, required: false })
  idempotencyKey?: string;


  // Name typed by the customer at checkout (QR / takeaway). Name only - no phone
  // number is collected. Stored on the existing orders collection; no Customer
  // record is created. Optional so legacy orders without a name remain valid.
  @Prop({ type: String, required: false, default: null })
  customerName?: string | null;

  // Privacy-safe contact snapshot for public orders. Display data only; it is
  // never used as customer identity or authorization. Optional for name-only
  // checkout and older orders.
  @Prop({ type: String, required: false, default: null, maxlength: 32 })
  customerPhoneMasked?: string | null;

  // Legacy optional customer association. Public QR ordering no longer
  // creates or requires Customer records; older/admin-managed orders may
  // still contain this field and it remains optional for compatibility.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', required: false, default: null })
  customerId?: Types.ObjectId | null;

  // ---- Group ordering ----
  // Set only when this order was placed from a group lobby. Its presence
  // is what makes an order "a group order" — there is no separate
  // collection of group orders and no second order shape. A group still
  // produces exactly ONE Order document; the per-member breakdown lives
  // in `items[].addedByCustomerId`, and `customerId` above is whoever
  // submitted it on the group's behalf.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'GroupOrder', required: false, default: null })
  groupOrderId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, default: null })
  groupCode?: string | null;

  @Prop({ type: [OrderGroupMemberSnapshotSchema], required: false, default: [] })
  groupMembers: OrderGroupMemberSnapshot[];

  // Populated automatically by `{ timestamps: true }` above (Mongoose
  // adds the actual schema paths itself) — declared here, undecorated,
  // purely so TypeScript knows these exist on a hydrated document. Part
  // 5's admin list needs to show "Created time" per order, so this
  // needed to actually be typed rather than accessed via a cast.
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<Order>;
export const OrderSchema = SchemaFactory.createForClass(Order);

// Admin order list: all of one restaurant's orders, most recent first.
OrderSchema.index({ restaurantId: 1, createdAt: -1 });
// Not queried by any endpoint yet, but useful for e.g. "all orders from
// this visit" later — cheap to add now, consistent with every other
// schema in this project indexing its foreign keys.
// Restaurant dashboard/notification polling and the pending-order count filter
// by restaurantId + status (+ createdAt). Added Day 39 for those queries.
OrderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ tableSessionId: 1 });
OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index(
  { restaurantId: 1, customerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
// Part 7/8 foundation: a customer's order history, scoped to one
// restaurant at a time — every history lookup filters by both fields
// together, which is what keeps one restaurant from ever seeing a
// customer's orders at another restaurant.
OrderSchema.index({ customerId: 1, restaurantId: 1 });
// "Has this group already been ordered?" — the idempotency check that
// stops a second member from submitting the same group a second time.
OrderSchema.index({ groupOrderId: 1 });
