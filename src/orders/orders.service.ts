import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RestaurantMember, RestaurantMemberDocument } from '../restaurant-members/schemas/restaurant-member.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { Table, TableDocument } from '../tables/schemas/table.schema';
import { TableSession, TableSessionDocument, TableSessionStatus } from '../table-sessions/schemas/table-session.schema';
import { MenuItem, MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { Order, OrderDocument, OrderStatus, OrderType } from './schemas/order.schema';
import { PaginationResult } from '../common/pagination';
import { AuthorizationService } from '../common/authorization.service';

// Day 22 (Part 5/6/15) — minimum total quantity ordered before an item
// is allowed to appear in the customer-facing "Most ordered" section.
// Set to 3 deliberately: 1–2 is noise (one party ordering one dish), and
// this is the difference between a real signal and inventing popularity.
// If nothing clears the bar, the section is hidden entirely rather than
// filled with weak data.
const MIN_ORDERS_TO_BE_POPULAR = 3;

// Forward-only lifecycle, plus CANCELLED reachable from anywhere that
// isn't already terminal. COMPLETED/CANCELLED are terminal — no further
// status change is accepted once an order lands there (see
// updateStatus() below).
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.NEW]: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

interface OrderItemInput {
  itemId: string;
  quantity: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(TableSession.name) private readonly sessionModel: Model<TableSessionDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(RestaurantMember.name)
    private readonly restaurantMemberModel: Model<RestaurantMemberDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  // ---- Shared validation ----

  private normalizeCustomerName(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new BadRequestException('Please enter your name to place the order.');
    }
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) {
      throw new BadRequestException('Name must be between 2 and 80 characters.');
    }
    if (!/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u.test(name)) {
      throw new BadRequestException('Name can contain only letters, spaces, apostrophes, dots and hyphens.');
    }
    return name;
  }

  private assertValidId(id: string, label: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`${label} not found.`);
    }
  }

  // ---- Public: anonymous QR order creation ----

  // Only a customer name is required - no other contact detail, customer record or
  // customer session is involved. Prices and totals are always recomputed from
  // restaurant-owned menu data on the server.
  async createOrder(restaurantId: string, tableId: string | undefined, rawOrderType: 'DINE_IN' | 'TAKEAWAY' | undefined, rawItems: OrderItemInput[], rawIdempotencyKey?: string, rawCustomerName?: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    const customerName = this.normalizeCustomerName(rawCustomerName);
    const orderType = rawOrderType ?? OrderType.DINE_IN;
    if (!Object.values(OrderType).includes(orderType as OrderType)) {
      throw new BadRequestException('Invalid order type.');
    }
    if (orderType === OrderType.DINE_IN) {
      if (!tableId) throw new BadRequestException('A table is required for dine-in orders.');
      this.assertValidId(tableId, 'Table');
    } else if (tableId) {
      throw new BadRequestException('Takeaway orders cannot specify a table.');
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new BadRequestException('Your cart is empty.');
    }
    if (rawItems.length > 100) {
      throw new BadRequestException('Too many distinct cart lines.');
    }

    const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : undefined;
    if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('Invalid order idempotency key.');
    }

    const restaurant = await this.restaurantModel.findById(restaurantId);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
    }

    if (idempotencyKey) {
      const existing = await this.orderModel.findOne({ restaurantId, idempotencyKey });
      if (existing) {
        return {
          id: existing._id.toString(),
          orderNumber: existing.orderNumber,
          status: existing.status,
          subtotal: existing.subtotal,
          total: existing.total,
          items: existing.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity, lineTotal: i.lineTotal })),
          orderType: existing.orderType,
          table: existing.tableNumber ? { tableNumber: existing.tableNumber } : null,
          restaurant: { name: (await this.restaurantModel.findById(existing.restaurantId))?.name ?? 'Restaurant' },
          createdAt: existing.createdAt,
        };
      }
    }

    let table: TableDocument | null = null;
    let session: TableSessionDocument | null = null;
    if (orderType === OrderType.DINE_IN) {
      // Table must exist AND belong to this restaurant.
      table = await this.tableModel.findOne({ _id: tableId, restaurantId });
      if (!table) throw new NotFoundException('Table not found.');

      // Dine-in orders still require the active QR table session. Takeaway
      // orders deliberately have neither a table nor a table session.
      session = await this.sessionModel.findOne({ tableId, restaurantId, status: TableSessionStatus.ACTIVE });
      if (!session) throw new BadRequestException('No active session for this table. Please scan the table QR code again.');
    }

    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object' || typeof raw.itemId !== 'string') {
        throw new BadRequestException('Invalid item in cart.');
      }
      this.assertValidId(raw.itemId, 'Menu item');
      if (!Number.isInteger(raw.quantity) || raw.quantity < 1) {
        throw new BadRequestException('Invalid quantity.');
      }
    }

    // One query for every distinct item, scoped to this restaurant —
    // this single `restaurantId` filter is what prevents a customer
    // from ordering an item that belongs to a different restaurant: an
    // id that's real but scoped elsewhere simply won't come back here,
    // and the count check below catches that.
    const distinctIds = [...new Set(rawItems.map((i) => i.itemId))];
    const menuItems = await this.menuItemModel.find({ _id: { $in: distinctIds }, restaurantId });
    if (menuItems.length !== distinctIds.length) {
      throw new BadRequestException('One or more items are not available from this restaurant.');
    }

    const menuItemsById = new Map(menuItems.map((m) => [m._id.toString(), m]));

    const items = rawItems.map((raw) => {
      const menuItem = menuItemsById.get(raw.itemId)!;
      if (!menuItem.isAvailable) {
        throw new BadRequestException(`"${menuItem.name}" is currently unavailable.`);
      }
      // Price is read from `menuItem` (MongoDB), never from `raw` — the
      // request body has no price field at all, so there's nothing to
      // even accidentally trust here.
      const lineTotal = menuItem.price * raw.quantity;
      return {
        menuItemId: menuItem._id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: raw.quantity,
        lineTotal,
        imageUrl: menuItem.imageUrl ?? null,
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    // No tax/fees/discounts exist yet (Day 12 scope) — total mirrors
    // subtotal today, but stays a separate stored field (see schema
    // comment) for when that stops being true.
    const total = subtotal;

    // Pre-generating the _id lets orderNumber be derived from it and
    // stored in the same insert, rather than a create-then-update.
    const _id = new Types.ObjectId();
    const orderNumber = `ORD-${_id.toString().slice(-6).toUpperCase()}`;

    let order: OrderDocument;
    try {
      order = await this.orderModel.create({
        _id,
        restaurantId,
        tableId: table?._id ?? null,
        tableNumber: table?.tableNumber ?? null,
        orderType,
        tableSessionId: session?._id ?? null,
        orderNumber,
        customerName,
        items,
        subtotal,
        total,
        status: OrderStatus.NEW,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
    } catch (err: unknown) {
      if (idempotencyKey && typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 11000) {
        const existing = await this.orderModel.findOne({ restaurantId, idempotencyKey });
        if (existing) {
          return {
            id: existing._id.toString(),
            orderNumber: existing.orderNumber,
            status: existing.status,
            subtotal: existing.subtotal,
            total: existing.total,
            items: existing.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity, lineTotal: i.lineTotal })),
            orderType: existing.orderType,
            table: existing.tableNumber ? { tableNumber: existing.tableNumber } : null,
            restaurant: { name: restaurant.name },
            createdAt: existing.createdAt,
          };
        }
      }
      throw err;
    }

    return {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: order.subtotal,
      total: order.total,
      items: order.items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
      })),
      orderType: order.orderType,
      table: order.tableNumber ? { tableNumber: order.tableNumber } : null,
      restaurant: { name: restaurant.name },
      createdAt: order.createdAt,
    };
  }

  // ---- Public: popular items (Day 14 — Customer Home page) ----

  // Real popularity, derived from actual placed orders — never
  // fabricated. This is exactly what the Day 14 task calls for: "use an
  // existing popularity field if available" — none exists as a stored
  // field, but real order history now does (Day 12), which is a better
  // signal than a hand-set field would be anyway. If a restaurant has no
  // orders yet, this returns an empty array and the Home page simply
  // hides the Popular section rather than showing anything invented.
  //
  // Only currently-available items from *this* restaurant are returned
  // — an item that racked up orders in the past but has since been
  // deleted or 86'd is skipped, not shown as "popular" for something a
  // customer can no longer actually order. `orderCount` sums quantity
  // across all of that restaurant's orders, not just number of orders
  // that included it.
  //
  // Day 22 security fix (Part 17): `orderCount` is used for *ranking*
  // here but is deliberately NOT returned. This endpoint is public and
  // unauthenticated — returning it published a restaurant's real sales
  // volume per dish to anyone who scanned (or guessed) a menu URL,
  // which is internal performance data. Customers see the ordering
  // ("Popular", "Most ordered"), never the numbers behind it. The
  // minimum threshold below is applied server-side for the same reason:
  // the client can't be trusted to decide what counts as popular, and
  // shouldn't need the raw counts to do so.
  async getPopularItems(restaurantId: string, limit = 6) {
    this.assertValidId(restaurantId, 'Restaurant');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BadRequestException('Limit must be an integer between 1 and 20.');
    }
    const restaurantObjectId = new Types.ObjectId(restaurantId);

    const ranked: { _id: Types.ObjectId; orderCount: number }[] = await this.orderModel.aggregate([
      { $match: { restaurantId: restaurantObjectId } },
      { $unwind: '$items' },
      { $group: { _id: '$items.menuItemId', orderCount: { $sum: '$items.quantity' } } },
      { $sort: { orderCount: -1 } },
      // A generous buffer over `limit` — some ranked items may turn out
      // to be unavailable/deleted by the time we join against the live
      // MenuItem collection below, and get filtered out.
      { $limit: limit * 4 },
    ]);

    if (ranked.length === 0) return [];

    const ids = ranked.map((r) => r._id);
    const menuItems = await this.menuItemModel.find({ _id: { $in: ids }, restaurantId, isAvailable: true });
    const byId = new Map(menuItems.map((m) => [m._id.toString(), m]));

    const toRecord = (r: { _id: Types.ObjectId }) => {
      const item = byId.get(r._id.toString());
      if (!item) return null; // deleted or no longer available — never shown
      return {
        id: item._id.toString(),
        name: item.name,
        description: item.description ?? null,
        price: item.price,
        // NOTE: orderCount intentionally omitted — see the security
        // note on this method. It ranks, it isn't published.
        imageUrl: item.imageUrl ?? null,
      };
    };

    // Day 28 fix — this used to be a hard cutoff: an item under
    // MIN_ORDERS_TO_BE_POPULAR was dropped, full stop, which could leave
    // Home's "Popular" section empty even while the restaurant dashboard's
    // Top Items list (no threshold at all — see getDashboardAnalytics)
    // was showing 5 genuine best-sellers. That mismatch read as "Popular
    // is broken" to restaurant owners checking their own site.
    //
    // The threshold is still worth having — one or two stray orders
    // shouldn't be labelled "popular" — but it should never make Home
    // *less* informative than the dashboard the owner is comparing it
    // against. So: rank by the threshold first, and only backfill with
    // sub-threshold items if that's not enough to reach a useful floor
    // (min(5, limit) — same "top 5" shape as the dashboard). A brand-new
    // restaurant with zero order history still correctly shows nothing.
    const floor = Math.min(5, limit);
    const strong: NonNullable<ReturnType<typeof toRecord>>[] = [];
    const rest: NonNullable<ReturnType<typeof toRecord>>[] = [];
    for (const r of ranked) {
      const record = toRecord(r);
      if (!record) continue;
      (r.orderCount >= MIN_ORDERS_TO_BE_POPULAR ? strong : rest).push(record);
    }

    const result = strong.slice(0, limit);
    for (const record of rest) {
      if (result.length >= floor) break;
      result.push(record);
    }
    return result.slice(0, limit);
  }

  // ---- Admin: list + detail (JwtAuthGuard — see OrdersController) ----

  private async requireMembership(restaurantId: string, userId: string) {
    return this.authorization.requireRestaurantAccess(restaurantId, userId);
  }

  private serializeOrderSummary(order: OrderDocument, customer?: CustomerDocument | null) {
    return {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber ?? null,
      orderType: order.orderType,
      items: order.items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
        imageUrl: i.imageUrl ?? null,
        // Null on a solo order; on a group order this is who at the
        // table asked for this line, so the kitchen ticket stays
        // actionable even though it's one combined order.
        addedByName: i.addedByName ?? null,
      })),
      // Present only on a group order — the admin UI uses this to badge
      // the row and to group the item list by member.
      groupCode: order.groupCode ?? null,
      customerName: order.customerName ?? null,
      subtotal: order.subtotal,
      total: order.total,
      status: order.status,
      createdAt: order.createdAt,
      // Surfacing the real, already-associated customer (Part 7) — not a
      // new "Customer Memory" feature, just showing the field that now
      // exists on the order itself. `null` when the order predates
      // customer auth or the customer record is somehow missing.
      customer: customer
        ? {
            id: customer._id.toString(),
            customerCode: customer.customerCode,
            mobileNumber: customer.mobileNumber ?? null,
            email: customer.email ?? null,
            name: customer.name ?? null,
          }
        : null,
    };
  }

  // No RBAC role split beyond membership — every restaurant member
  // (admin or staff) can view orders today. Same reasoning now extends
  // to changing status: any member of the restaurant (front-of-house or
  // kitchen) can move an order forward, not just an "admin" role — there
  // is no finer-grained staff role in this project yet to split on.
  async listOrders(restaurantId: string, userId: string, pagination: PaginationResult) {
    await this.requireMembership(restaurantId, userId);
    const orders = await this.orderModel.find({ restaurantId }).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit);
    const customerIds = [...new Set(orders.map((o) => o.customerId?.toString()).filter(Boolean))] as string[];
    const customers = customerIds.length ? await this.customerModel.find({ _id: { $in: customerIds } }) : [];
    const customerById = new Map(customers.map((c) => [c._id.toString(), c]));
    return orders.map((o) => this.serializeOrderSummary(o, o.customerId ? customerById.get(o.customerId.toString()) : null));
  }

  async getOrder(restaurantId: string, orderId: string, userId: string) {
    await this.requireMembership(restaurantId, userId);
    this.assertValidId(orderId, 'Order');
    // Scoped by {_id, restaurantId} together — a real order id
    // belonging to a different restaurant 404s exactly like a
    // nonexistent one, same isolation mechanism as every other
    // restaurant-scoped lookup in this project.
    const order = await this.orderModel.findOne({ _id: orderId, restaurantId });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    const customer = order.customerId ? await this.customerModel.findById(order.customerId) : null;
    return this.serializeOrderSummary(order, customer);
  }

  // Part 2: dynamic order status, persisted to MongoDB. `status` is
  // validated against STATUS_TRANSITIONS above — a COMPLETED/CANCELLED
  // order can't be changed further, and a status can't jump somewhere
  // the lifecycle doesn't allow (e.g. NEW straight to COMPLETED).
  async updateStatus(restaurantId: string, orderId: string, userId: string, nextStatus: OrderStatus) {
    await this.requireMembership(restaurantId, userId);
    this.assertValidId(orderId, 'Order');

    if (!Object.values(OrderStatus).includes(nextStatus)) {
      throw new BadRequestException('Invalid order status.');
    }

    const order = await this.orderModel.findOne({ _id: orderId, restaurantId });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    if (order.status === nextStatus) {
      // No-op update (e.g. double-click) — return as-is rather than
      // erroring, since the end state the caller wanted is already true.
      const customer = order.customerId ? await this.customerModel.findById(order.customerId) : null;
      return this.serializeOrderSummary(order, customer);
    }

    const allowed = STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(`Cannot move an order from ${order.status} to ${nextStatus}.`);
    }

    order.status = nextStatus;
    await order.save();

    const customer = order.customerId ? await this.customerModel.findById(order.customerId) : null;
    return this.serializeOrderSummary(order, customer);
  }

  // ---- Admin: order notification + pending queue summary ----
  // The authenticated restaurant context is resolved server-side through
  // requireMembership(). The browser may provide a cursor, but it never
  // supplies the restaurant scope used by the Mongo queries.
  async getOrderNotificationSummary(restaurantId: string, userId: string, since?: string) {
    await this.requireMembership(restaurantId, userId);
    this.assertValidId(restaurantId, 'Restaurant');

    const now = new Date();
    let cursor = new Date(0);
    if (since !== undefined) {
      const parsed = new Date(since);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid notification cursor.');
      }
      cursor = parsed;
    }

    const restaurantObjectId = new Types.ObjectId(restaurantId);
    const actionableStatuses = [
      OrderStatus.NEW,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
    ];

    const [pendingCount, newOrders] = await Promise.all([
      this.orderModel.countDocuments({
        restaurantId: restaurantObjectId,
        status: { $in: actionableStatuses },
      }),
      this.orderModel
        .find({ restaurantId: restaurantObjectId, createdAt: { $gt: cursor, $lte: now } })
        .sort({ createdAt: 1 })
        .limit(100)
        .select({ _id: 1, orderNumber: 1, total: 1, items: 1, status: 1, createdAt: 1 })
        .lean(),
    ]);

    return {
      pendingCount,
      newOrders: newOrders.map((order) => ({
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        total: order.total,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        status: order.status,
        createdAt: order.createdAt,
      })),
      serverTime: now.toISOString(),
    };
  }

  // ---- Admin: dashboard analytics ----
  // The selected period is the single source of truth for all metrics that
  // are inherently date-scoped. Current queue totals, all-time AOV,
  // completed total, top items and recent orders retain their existing
  // meanings because they were never date-scoped metrics.
  async getDashboardAnalytics(restaurantId: string, userId: string, period: 'week' | 'month' = 'week') {
    await this.requireMembership(restaurantId, userId);
    if (period !== 'week' && period !== 'month') {
      throw new BadRequestException('Period must be week or month.');
    }

    const restaurantObjectId = new Types.ObjectId(restaurantId);
    const notCancelled = { restaurantId: restaurantObjectId, status: { $ne: OrderStatus.CANCELLED } };
    const now = new Date();
    // No restaurant timezone is currently stored in the data model. The
    // application timezone is therefore centralized here: explicit APP_TIMEZONE
    // wins, then the Node process TZ, with Asia/Kolkata as MnU's current local
    // application default. This keeps calendar boundaries consistent for the
    // dashboard until restaurants gain an explicit timezone field.
    const timezone = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Kolkata';
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    }).formatToParts(now);
    const part = (type: string) => localParts.find((p) => p.type === type)?.value ?? '';
    const localYear = Number(part('year'));
    const localMonth = Number(part('month'));
    const localDay = Number(part('day'));
    const localWeekday = part('weekday');

    // Convert a local calendar date at 00:00 in the application timezone to
    // its actual UTC instant without adding a timezone dependency.
    const localMidnightToUtc = (year: number, month: number, day: number) => {
      const guess = new Date(Date.UTC(year, month - 1, day));
      const offsetParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
      }).formatToParts(guess);
      const value = (type: string) => Number(offsetParts.find((p) => p.type === type)?.value ?? 0);
      const asLocalWallClockUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'), value('second'));
      return new Date(guess.getTime() - (asLocalWallClockUtc - guess.getTime()));
    };

    const currentLocalMidnight = localMidnightToUtc(localYear, localMonth, localDay);
    let periodStart = currentLocalMidnight;
    if (period === 'week') {
      const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const daysSinceMonday = (weekdayIndex[localWeekday] ?? 1) === 0 ? 6 : (weekdayIndex[localWeekday] ?? 1) - 1;
      const mondayCalendar = new Date(Date.UTC(localYear, localMonth - 1, localDay - daysSinceMonday));
      periodStart = localMidnightToUtc(mondayCalendar.getUTCFullYear(), mondayCalendar.getUTCMonth() + 1, mondayCalendar.getUTCDate());
    } else {
      periodStart = localMidnightToUtc(localYear, localMonth, 1);
    }

    const periodMatch = { ...notCancelled, createdAt: { $gte: periodStart, $lte: now } };

    const [
      [periodAgg],
      [allTimeAgg],
      activeOrders,
      completedOrders,
      topItemsRaw,
      recentOrdersDocs,
      trendRaw,
    ] = await Promise.all([
      this.orderModel.aggregate([
        { $match: periodMatch },
        { $group: { _id: null, sales: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      this.orderModel.aggregate([
        { $match: notCancelled },
        { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      this.orderModel.countDocuments({
        restaurantId: restaurantObjectId,
        status: { $in: [OrderStatus.NEW, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
      }),
      this.orderModel.countDocuments({ restaurantId: restaurantObjectId, status: OrderStatus.COMPLETED }),
      this.orderModel.aggregate([
        { $match: notCancelled },
        { $unwind: '$items' },
        { $group: { _id: '$items.name', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
        { $sort: { quantity: -1 } },
        { $limit: 5 },
      ]),
      this.orderModel.find({ restaurantId: restaurantObjectId }).sort({ createdAt: -1 }).limit(5),
      this.orderModel.aggregate([
        { $match: periodMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } },
            sales: { $sum: '$total' },
            orders: { $sum: 1 },
          },
        },
      ]),
    ]);

    const trendByDay = new Map(trendRaw.map((d: { _id: string; sales: number; orders: number }) => [d._id, d]));
    const trend: { date: string; sales: number; orders: number }[] = [];

    // Keep the chart daily for both modes. The bounds come from MongoDB's
    // timezone-aware calendar boundary, while the frontend receives only
    // the already-filtered/bucketed data.
    const cursor = new Date(periodStart);
    while (cursor <= now) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(cursor);
      const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      const key = `${value('year')}-${value('month')}-${value('day')}`;
      const found = trendByDay.get(key);
      trend.push({ date: key, sales: found?.sales ?? 0, orders: found?.orders ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const periodRevenue = periodAgg?.sales ?? 0;
    const periodCount = periodAgg?.count ?? 0;
    const allTimeRevenue = allTimeAgg?.revenue ?? 0;
    const allTimeCount = allTimeAgg?.count ?? 0;

    return {
      period,
      periodSales: periodRevenue,
      periodOrders: periodCount,
      averageOrderValue: allTimeCount > 0 ? Math.round((allTimeRevenue / allTimeCount) * 100) / 100 : 0,
      activeOrders,
      completedOrders,
      topItems: topItemsRaw.map((r: { _id: string; quantity: number; revenue: number }) => ({
        name: r._id,
        quantity: r.quantity,
        revenue: r.revenue,
      })),
      recentOrders: recentOrdersDocs.map((o) => this.serializeOrderSummary(o)),
      trend,
      trendRangeStart: trend[0]?.date ?? null,
      trendRangeEnd: trend[trend.length - 1]?.date ?? null,
      hasPeriodData: periodCount > 0,
    };
  }

  // ---- Customer: own order history/details ----
  // Customer identity for history comes from the restaurant-scoped customer
  // session convenience token. Checkout itself does not require that token.
  // RestaurantId is also part of every query, so a customer can see their own orders only
  // for the restaurant whose context they requested.
  async listPublicOrdersForRestaurant(restaurantId: string, pagination: PaginationResult) {
    this.assertValidId(restaurantId, 'Restaurant');
    const restaurant = await this.restaurantModel.findById(restaurantId).select('name').lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    // Public ordering has no customer identity, so there is no trustworthy
    // per-customer history to return. The endpoint intentionally returns an
    // empty history rather than inventing an identity or exposing another
    // diner's orders.
    return { restaurant: { id: restaurantId, name: restaurant.name }, customer: null, orders: [] };
  }

  async getPublicOrderForRestaurant(restaurantId: string, orderId: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    this.assertValidId(orderId, 'Order');
    const order = await this.orderModel.findOne({ _id: orderId, restaurantId });
    if (!order) throw new NotFoundException('Order not found.');
    const restaurant = await this.restaurantModel.findById(restaurantId).select('name').lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      restaurant: { id: restaurantId, name: restaurant.name },
      tableNumber: order.tableNumber ?? null,
      orderType: order.orderType,
      items: order.items.map((item) => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
      subtotal: order.subtotal,
      total: order.total,
      status: order.status,
      createdAt: order.createdAt,
      customer: null,
      groupCode: order.groupCode ?? null,
    };
  }

  // Restaurant isolation comes from the same {restaurantId, customerId}
  // filter every other restaurant-scoped query in this service already
  // uses — a customer's orders at a different restaurant are never part
  // of this result set.
  async listCustomerOrdersForRestaurant(restaurantId: string, customerId: string, userId: string, pagination: PaginationResult) {
    await this.requireMembership(restaurantId, userId);
    this.assertValidId(customerId, 'Customer');
    const orders = await this.orderModel.find({ restaurantId, customerId }).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit);
    // SECURITY: the customer profile (name/mobile/email) is only looked
    // up — and only ever returned — once we already know this customer
    // has at least one order *at this restaurant*. Looking them up by
    // customerId alone first (Customer is a global collection, not
    // restaurant-scoped — see customer.schema.ts) would let this
    // restaurant's admin read another restaurant's customer's PII simply
    // by guessing/enumerating a valid customerId, even with zero shared
    // order history to show for it. Same "same-shape-as-404" isolation
    // principle used everywhere else in this project: a customer who
    // has never ordered here looks identical to one that doesn't exist.
    const customer = orders.length > 0 ? await this.customerModel.findById(customerId) : null;
    return {
      customer: customer
        ? {
            id: customer._id.toString(),
            customerCode: customer.customerCode,
            name: customer.name ?? null,
            mobileNumber: customer.mobileNumber ?? null,
            email: customer.email ?? null,
          }
        : null,
      orders: orders.map((o) => this.serializeOrderSummary(o)),
    };
  }

  // ---- Admin: restaurant-scoped customer list (this task) ----
  //
  // "Customers" isn't its own collection scoped per restaurant (see
  // customer.schema.ts — a Customer is global, the same person can order
  // from many restaurants). So "this restaurant's customers" is derived
  // from Orders, the same way listCustomerOrdersForRestaurant already
  // derives "this customer's orders at this restaurant" — aggregate the
  // distinct customerIds that actually have an Order row for this
  // restaurant, then join Customer for display fields. This is why it's
  // a method on OrdersService rather than a new CustomersService: it's
  // fundamentally an Orders query, not a Customers query, and putting it
  // here reuses requireMembership/customerModel that already live in
  // this class instead of adding a cross-module dependency for one
  // method.
  //
  // Deliberately does NOT fetch every Customer document and filter
  // client-side — the $group below only ever sees this restaurant's own
  // Order rows (matched first), so a customer who has never ordered here
  // is never loaded, never transferred, and never visible to this
  // restaurant's admin at all.
  async listCustomersForRestaurant(restaurantId: string, userId: string, pagination: PaginationResult) {
    await this.requireMembership(restaurantId, userId);
    const restaurantObjectId = new Types.ObjectId(restaurantId);

    const agg = await this.orderModel.aggregate([
      { $match: { restaurantId: restaurantObjectId, customerId: { $ne: null } } },
      {
        $group: {
          _id: '$customerId',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: '$total' },
          lastOrderAt: { $max: '$createdAt' },
        },
      },
      { $sort: { lastOrderAt: -1 } },
      { $skip: pagination.skip },
      { $limit: pagination.limit },
    ]);

    const customerIds = agg.map((a: { _id: Types.ObjectId }) => a._id);
    const customers = customerIds.length ? await this.customerModel.find({ _id: { $in: customerIds } }) : [];
    const customerById = new Map(customers.map((c) => [c._id.toString(), c]));

    return agg.map((a: { _id: Types.ObjectId; orderCount: number; totalSpent: number; lastOrderAt: Date }) => {
      const customer = customerById.get(a._id.toString());
      return {
        id: a._id.toString(),
        // A customer row can, in principle, be missing (deleted account,
        // data inconsistency) even though an Order still references it —
        // rather than silently dropping that customer from the list (an
        // admin's order history would then have no way to look it up at
        // all), it's included with null display fields so the row is
        // still reachable, same "don't hide, degrade gracefully"
        // reasoning used for a missing image or missing description
        // elsewhere in this project.
        customerCode: customer?.customerCode ?? null,
        name: customer?.name ?? null,
        mobileNumber: customer?.mobileNumber ?? null,
        email: customer?.email ?? null,
        orderCount: a.orderCount,
        totalSpent: a.totalSpent,
        lastOrderAt: a.lastOrderAt,
      };
    });
  }
}
