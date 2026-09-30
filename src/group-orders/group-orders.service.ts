import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/order.schema';
import { MenuItem, MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { Table, TableDocument } from '../tables/schemas/table.schema';
import {
  TableSession,
  TableSessionDocument,
  TableSessionStatus,
} from '../table-sessions/schemas/table-session.schema';
import { GroupOrder, GroupOrderDocument, GroupOrderStatus } from './schemas/group-order.schema';

// Ambiguous characters (0/O, 1/I/L) removed — this code gets read aloud
// across a table, which is exactly the failure mode a join screen can't
// recover from gracefully.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

@Injectable()
export class GroupOrdersService {
  constructor(
    @InjectModel(GroupOrder.name) private readonly groupOrderModel: Model<GroupOrderDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(TableSession.name) private readonly sessionModel: Model<TableSessionDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  private assertValidId(id: string, label: string) {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${label} not found.`);
    }
  }

  // Resolves and validates the full restaurant → table → active session
  // chain server-side. Mirrors OrdersService.createOrder's own checks
  // (Day 12) rather than inventing a looser rule for groups: a client
  // asserting "I'm at table X" is never enough, and no active session
  // means no group, same as no active session means no order.
  private async resolveTableContext(restaurantId: string, tableId: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    this.assertValidId(tableId, 'Table');

    const restaurant = await this.restaurantModel.findById(restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant not found.');

    const table = await this.tableModel.findOne({ _id: tableId, restaurantId });
    if (!table) throw new NotFoundException('Table not found.');

    const session = await this.sessionModel.findOne({
      tableId,
      restaurantId,
      status: TableSessionStatus.ACTIVE,
    });
    if (!session) {
      throw new BadRequestException('No active session for this table. Please scan the table QR code again.');
    }

    return { restaurant, table, session };
  }

  private generateCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  // Retries on the unique-index collision rather than trusting a single
  // draw — 31^5 is a large space, but "unlikely" isn't "impossible" and
  // a duplicate code would otherwise surface as a raw Mongo error.
  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = this.generateCode();
      const existing = await this.groupOrderModel.exists({ groupCode: code });
      if (!existing) return code;
    }
    throw new BadRequestException('Could not create a group right now. Please try again.');
  }

  private displayNameFor(customer: CustomerDocument): string {
    if (customer.name?.trim()) return customer.name.trim();
    // Masked fallbacks — a lobby is visible to everyone at the table, so
    // it shows enough to recognize yourself without printing a full
    // phone number or email address for strangers to read.
    if (customer.mobileNumber) return `••••${customer.mobileNumber.slice(-4)}`;
    if (customer.email) return customer.email.split('@')[0];
    return customer.customerCode;
  }

  // Recomputes every member's line totals from *live* MenuItem prices on
  // each read. A pre-order lobby deliberately shows current prices; the
  // binding snapshot is taken later, at order creation (Order.items).
  // Items whose menu item no longer exists (deleted mid-session) are
  // dropped from the view rather than rendered as a broken row.
  private async serialize(group: GroupOrderDocument, viewerCustomerId: string) {
    const allItemIds = group.members.flatMap((m) => m.items.map((i) => i.menuItemId));
    const menuItems = allItemIds.length
      ? await this.menuItemModel.find({ _id: { $in: allItemIds }, restaurantId: group.restaurantId })
      : [];
    const byId = new Map(menuItems.map((m) => [m._id.toString(), m]));

    let groupTotal = 0;
    const members = group.members.map((member) => {
      const items = member.items
        .map((item) => {
          const menuItem = byId.get(item.menuItemId.toString());
          if (!menuItem) return null;
          const lineTotal = menuItem.price * item.quantity;
          return {
            menuItemId: menuItem._id.toString(),
            name: menuItem.name,
            price: menuItem.price,
            quantity: item.quantity,
            lineTotal,
          };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null);

      const memberTotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
      groupTotal += memberTotal;

      return {
        customerId: member.customerId.toString(),
        displayName: member.displayName,
        joinedAt: member.joinedAt,
        isYou: member.customerId.toString() === viewerCustomerId,
        items,
        memberTotal,
      };
    });

    return {
      groupCode: group.groupCode,
      status: group.status,
      placedOrderNumber: group.placedOrderNumber ?? null,
      restaurantId: group.restaurantId.toString(),
      tableId: group.tableId.toString(),
      tableNumber: group.tableNumber,
      createdByCustomerId: group.createdByCustomerId.toString(),
      isCreator: group.createdByCustomerId.toString() === viewerCustomerId,
      members,
      groupTotal,
      createdAt: group.createdAt,
    };
  }

  // Always looks up by groupCode AND restaurantId together (Part 10): a
  // valid code belonging to another restaurant resolves to nothing here,
  // indistinguishable from a typo — the same "shape-as-404" principle
  // used by every other restaurant-scoped lookup in this project.
  private async findGroupOrThrow(restaurantId: string, groupCode: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    const normalized = (groupCode ?? '').trim().toUpperCase();
    if (!normalized) throw new NotFoundException('Group not found.');

    const group = await this.groupOrderModel.findOne({ groupCode: normalized, restaurantId });
    if (!group) throw new NotFoundException('That group code is not valid for this restaurant.');
    return group;
  }

  // Rejects a group whose table session has since ended — the group row
  // still exists, but it's no longer joinable/usable. This is what makes
  // "expired group" a real state on the Join screen rather than a
  // hypothetical one.
  private async assertSessionStillActive(group: GroupOrderDocument) {
    const session = await this.sessionModel.findOne({
      _id: group.tableSessionId,
      status: TableSessionStatus.ACTIVE,
    });
    if (!session) {
      throw new BadRequestException('This group has ended. Please scan the table QR code to start a new one.');
    }
  }

  async createGroup(restaurantId: string, tableId: string, customerId: string) {
    this.assertValidId(customerId, 'Customer');
    const { table, session } = await this.resolveTableContext(restaurantId, tableId);

    const customer = await this.customerModel.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found.');

    // One open group per table session. If someone at this table already
    // started one, return *that* group instead of creating a rival — two
    // competing groups at the same physical table is a confusing state
    // with no good resolution, and the likeliest cause is two people
    // tapping "Create" at once.
    const existing = await this.groupOrderModel.findOne({
      tableSessionId: session._id,
      status: GroupOrderStatus.OPEN,
    });
    if (existing) {
      await this.ensureMember(existing, customer);
      return this.serialize(existing, customerId);
    }

    const groupCode = await this.generateUniqueCode();
    const group = await this.groupOrderModel.create({
      restaurantId,
      tableId,
      tableNumber: table.tableNumber,
      tableSessionId: session._id,
      groupCode,
      createdByCustomerId: customerId,
      status: GroupOrderStatus.OPEN,
      members: [
        {
          customerId: new Types.ObjectId(customerId),
          displayName: this.displayNameFor(customer),
          joinedAt: new Date(),
          items: [],
        },
      ],
    });

    return this.serialize(group, customerId);
  }

  private async ensureMember(group: GroupOrderDocument, customer: CustomerDocument) {
    const already = group.members.some((m) => m.customerId.toString() === customer._id.toString());
    if (already) return;
    group.members.push({
      customerId: customer._id,
      displayName: this.displayNameFor(customer),
      joinedAt: new Date(),
      items: [],
    });
    await group.save();
  }

  async joinGroup(restaurantId: string, groupCode: string, customerId: string) {
    this.assertValidId(customerId, 'Customer');
    const group = await this.findGroupOrThrow(restaurantId, groupCode);

    if (group.status !== GroupOrderStatus.OPEN) {
      throw new BadRequestException('This group is no longer open.');
    }
    await this.assertSessionStillActive(group);

    const customer = await this.customerModel.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found.');

    await this.ensureMember(group, customer);
    return this.serialize(group, customerId);
  }

  async getGroup(restaurantId: string, groupCode: string, customerId: string) {
    this.assertValidId(customerId, 'Customer');
    const group = await this.findGroupOrThrow(restaurantId, groupCode);

    // Only members can read a lobby. Without this, anyone holding a code
    // could watch a table's order build up without ever joining it.
    const isMember = group.members.some((m) => m.customerId.toString() === customerId);
    if (!isMember) {
      throw new NotFoundException('That group code is not valid for this restaurant.');
    }

    return this.serialize(group, customerId);
  }

  // Replaces *only the calling customer's own* contribution — a member
  // can never edit another member's items. Wholesale replace (not
  // add/remove deltas) is deliberate: the client's personal cart is
  // already the source of truth, so this is a sync, and a replace makes
  // the two converge without needing conflict resolution.
  async syncMyItems(
    restaurantId: string,
    groupCode: string,
    customerId: string,
    rawItems: { itemId: string; quantity: number }[],
  ) {
    this.assertValidId(customerId, 'Customer');
    const group = await this.findGroupOrThrow(restaurantId, groupCode);

    if (group.status !== GroupOrderStatus.OPEN) {
      throw new BadRequestException('This group is no longer open.');
    }
    await this.assertSessionStillActive(group);

    const member = group.members.find((m) => m.customerId.toString() === customerId);
    if (!member) {
      throw new NotFoundException('That group code is not valid for this restaurant.');
    }

    const items = Array.isArray(rawItems) ? rawItems : [];
    if (items.length > 100) {
      throw new BadRequestException('Too many cart lines.');
    }
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.itemId !== 'string') throw new BadRequestException('Invalid item.');
      this.assertValidId(item.itemId, 'Menu item');
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new BadRequestException('Invalid quantity.');
      }
    }

    // Same restaurant-scoped existence check createOrder uses: an item
    // id that's real but belongs to another restaurant simply won't come
    // back, and the count mismatch catches it.
    const distinctIds = [...new Set(items.map((i) => i.itemId))];
    if (distinctIds.length) {
      const found = await this.menuItemModel.find({ _id: { $in: distinctIds }, restaurantId });
      if (found.length !== distinctIds.length) {
        throw new BadRequestException('One or more items are not available from this restaurant.');
      }
    }

    member.items = items.map((i) => ({
      menuItemId: new Types.ObjectId(i.itemId),
      quantity: i.quantity,
    }));
    group.markModified('members');
    await group.save();

    return this.serialize(group, customerId);
  }

  // ---- Place the group's single combined order ----
  //
  // This is what makes a group order *one* order. Before this existed,
  // each member checked out their own cart through the normal
  // Cart → Review flow and the restaurant received N separate orders for
  // one table — the bug this fixes.
  //
  // Everything here mirrors OrdersService.createOrder (same validation,
  // same server-side pricing, same snapshotting) rather than calling it,
  // because the shape differs in one important way: line items carry
  // per-member attribution so the floor staff can still tell who ordered
  // what inside the combined ticket.
  async placeGroupOrder(restaurantId: string, groupCode: string, customerId: string) {
    this.assertValidId(customerId, 'Customer');
    const group = await this.findGroupOrThrow(restaurantId, groupCode);

    // Idempotency: if someone already submitted this group, return that
    // same order instead of creating a second one. Two members tapping
    // "Place Group Order" at the same moment is the expected case, not
    // an edge case, so this must not throw.
    if (group.placedOrderId) {
      const existing = await this.orderModel.findById(group.placedOrderId);
      if (existing) return this.serializeOrder(existing, group);
    }

    if (group.status !== GroupOrderStatus.OPEN) {
      throw new BadRequestException('This group order has already been placed.');
    }

    const isMember = group.members.some((m) => m.customerId.toString() === customerId);
    if (!isMember) {
      throw new NotFoundException('That group code is not valid for this restaurant.');
    }

    // The table session must still be live — same rule as a solo order.
    await this.assertSessionStillActive(group);

    const restaurant = await this.restaurantModel.findById(group.restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant not found.');

    // Flatten every member's shared items into one list, keeping who
    // added each. Deliberately NOT merged by menu item: two people each
    // ordering a coffee is two attributable lines, not "coffee x2" with
    // the attribution lost. Same person + same item IS merged, since
    // that's genuinely one line.
    const flattened: { menuItemId: string; quantity: number; customerId: string; name: string | null }[] = [];
    for (const member of group.members) {
      const byItem = new Map<string, number>();
      for (const item of member.items) {
        const key = item.menuItemId.toString();
        byItem.set(key, (byItem.get(key) ?? 0) + item.quantity);
      }
      for (const [menuItemId, quantity] of byItem) {
        flattened.push({
          menuItemId,
          quantity,
          customerId: member.customerId.toString(),
          name: member.displayName,
        });
      }
    }

    if (flattened.length === 0) {
      throw new BadRequestException('Nobody in the group has added any items yet.');
    }

    // Prices come from MongoDB, never from anything a client sent — the
    // group document stores only item ids and quantities precisely so
    // there is no client-supplied price to accidentally trust.
    const distinctIds = [...new Set(flattened.map((f) => f.menuItemId))];
    const menuItems = await this.menuItemModel.find({ _id: { $in: distinctIds }, restaurantId });
    if (menuItems.length !== distinctIds.length) {
      throw new BadRequestException('One or more items are no longer available from this restaurant.');
    }
    const byId = new Map(menuItems.map((m) => [m._id.toString(), m]));

    const items = flattened.map((f) => {
      const menuItem = byId.get(f.menuItemId)!;
      if (!menuItem.isAvailable) {
        throw new BadRequestException(`"${menuItem.name}" is no longer available.`);
      }
      return {
        menuItemId: menuItem._id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: f.quantity,
        lineTotal: menuItem.price * f.quantity,
        addedByCustomerId: new Types.ObjectId(f.customerId),
        addedByName: f.name,
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const total = subtotal;

    const _id = new Types.ObjectId();
    const orderNumber = `ORD-${_id.toString().slice(-6).toUpperCase()}`;

    const order = await this.orderModel.create({
      _id,
      restaurantId: group.restaurantId,
      tableId: group.tableId,
      tableNumber: group.tableNumber,
      tableSessionId: group.tableSessionId,
      orderNumber,
      items,
      subtotal,
      total,
      status: OrderStatus.NEW,
      // Whoever submitted it, on the group's behalf.
      customerId: new Types.ObjectId(customerId),
      groupOrderId: group._id,
      groupCode: group.groupCode,
    });

    group.placedOrderId = order._id;
    group.placedOrderNumber = order.orderNumber;
    group.status = GroupOrderStatus.ORDERED;
    await group.save();

    return this.serializeOrder(order, group);
  }

  // Matches the confirmation payload OrdersService.createOrder returns,
  // so the customer confirmation screen can render a group order and a
  // solo order with the same component.
  private serializeOrder(order: OrderDocument, group: GroupOrderDocument) {
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: order.subtotal,
      total: order.total,
      items: order.items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
        addedByName: i.addedByName ?? null,
      })),
      table: { tableNumber: order.tableNumber },
      groupCode: group.groupCode,
      memberCount: group.members.length,
      createdAt: order.createdAt,
    };
  }
}
