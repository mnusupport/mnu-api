import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { Order, OrderDocument, OrderStatus, OrderType } from '../orders/schemas/order.schema';
import { MenuItem, MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { Table, TableDocument } from '../tables/schemas/table.schema';
import { TableSession, TableSessionDocument, TableSessionStatus } from '../table-sessions/schemas/table-session.schema';
import { GroupOrder, GroupOrderDocument, GroupOrderStatus } from './schemas/group-order.schema';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

@Injectable()
export class GroupOrdersService {
  constructor(
    @InjectModel(GroupOrder.name) private readonly groupOrderModel: Model<GroupOrderDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(TableSession.name) private readonly sessionModel: Model<TableSessionDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  private assertValidId(id: string, label: string) {
    if (!id || !Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} not found.`);
  }

  private assertParticipantId(participantId: string) {
    if (typeof participantId !== 'string' || participantId.trim().length < 8 || participantId.trim().length > 128) {
      throw new BadRequestException('Invalid group participant.');
    }
  }

  private async resolveTableContext(restaurantId: string, tableId: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    this.assertValidId(tableId, 'Table');
    const restaurant = await this.restaurantModel.findById(restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    const table = await this.tableModel.findOne({ _id: tableId, restaurantId });
    if (!table) throw new NotFoundException('Table not found.');
    const session = await this.sessionModel.findOne({ tableId, restaurantId, status: TableSessionStatus.ACTIVE });
    if (!session) throw new BadRequestException('No active session for this table. Please scan the table QR code again.');
    return { restaurant, table, session };
  }

  private generateCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = this.generateCode();
      if (!(await this.groupOrderModel.exists({ groupCode: code }))) return code;
    }
    throw new BadRequestException('Could not create a group right now. Please try again.');
  }

  private async serialize(group: GroupOrderDocument, participantId?: string) {
    const allItemIds = group.members.flatMap((m) => m.items.map((i) => i.menuItemId));
    const menuItems = allItemIds.length
      ? await this.menuItemModel.find({ _id: { $in: allItemIds }, restaurantId: group.restaurantId })
      : [];
    const byId = new Map(menuItems.map((m) => [m._id.toString(), m]));
    let groupTotal = 0;

    const members = group.members.map((member) => {
      const items = member.items.map((item) => {
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
      }).filter((i): i is NonNullable<typeof i> => i !== null);
      const memberTotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
      groupTotal += memberTotal;
      return {
        participantId: member.participantId,
        displayName: member.displayName,
        phoneMasked: member.phoneMasked ?? null,
        joinedAt: member.joinedAt,
        isYou: participantId ? member.participantId === participantId : false,
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
      createdByParticipantId: group.createdByParticipantId,
      isCreator: participantId ? group.createdByParticipantId === participantId : false,
      members,
      groupTotal,
      createdAt: group.createdAt,
    };
  }

  private async findGroupOrThrow(restaurantId: string, groupCode: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    const normalized = (groupCode ?? '').trim().toUpperCase();
    if (!normalized) throw new NotFoundException('Group not found.');
    const group = await this.groupOrderModel.findOne({ groupCode: normalized, restaurantId });
    if (!group) throw new NotFoundException('That group code is not valid for this restaurant.');
    return group;
  }

  private async assertSessionStillActive(group: GroupOrderDocument) {
    const session = await this.sessionModel.findOne({ _id: group.tableSessionId, status: TableSessionStatus.ACTIVE });
    if (!session) throw new BadRequestException('This group has ended. Please scan the table QR code to start a new one.');
  }

  private normalizeParticipantName(raw: unknown): string {
    if (typeof raw !== 'string') throw new BadRequestException('Please enter your name.');
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u.test(name)) {
      throw new BadRequestException('Name must be between 2 and 80 characters and use valid name characters.');
    }
    return name;
  }

  private async ensureParticipant(group: GroupOrderDocument, participantId: string, rawDisplayName?: string, phoneMasked?: string | null) {
    this.assertParticipantId(participantId);
    const displayName = rawDisplayName === undefined ? undefined : this.normalizeParticipantName(rawDisplayName);
    const normalizedPhone = phoneMasked && /^\+?[0-9X* ()-]{6,24}$/.test(phoneMasked.trim()) ? phoneMasked.trim() : null;
    const existing = group.members.find((m) => m.participantId === participantId);
    if (existing) {
      let changed = false;
      if (displayName && existing.displayName !== displayName) { existing.displayName = displayName; changed = true; }
      if (normalizedPhone && existing.phoneMasked !== normalizedPhone) { existing.phoneMasked = normalizedPhone; changed = true; }
      if (changed) { group.markModified('members'); await group.save(); }
      return existing;
    }
    const member = { participantId, displayName: displayName ?? `Guest ${group.members.length + 1}`, phoneMasked: normalizedPhone, joinedAt: new Date(), items: [] };
    group.members.push(member);
    await group.save();
    return group.members[group.members.length - 1];
  }

  async createGroup(restaurantId: string, tableId: string, participantId: string, displayName?: string, phoneMasked?: string | null) {
    this.assertParticipantId(participantId);
    const { table, session } = await this.resolveTableContext(restaurantId, tableId);
    const existing = await this.groupOrderModel.findOne({ tableSessionId: session._id, status: GroupOrderStatus.OPEN });
    if (existing) {
      await this.ensureParticipant(existing, participantId, displayName, phoneMasked);
      return this.serialize(existing, participantId);
    }
    const group = await this.groupOrderModel.create({
      restaurantId,
      tableId,
      tableNumber: table.tableNumber,
      tableSessionId: session._id,
      groupCode: await this.generateUniqueCode(),
      createdByParticipantId: participantId,
      status: GroupOrderStatus.OPEN,
      members: [{ participantId, displayName: displayName ? this.normalizeParticipantName(displayName) : 'Guest 1', phoneMasked: phoneMasked ?? null, joinedAt: new Date(), items: [] }],
    });
    return this.serialize(group, participantId);
  }

  async joinGroup(restaurantId: string, groupCode: string, participantId: string, displayName?: string, phoneMasked?: string | null) {
    this.assertParticipantId(participantId);
    const group = await this.findGroupOrThrow(restaurantId, groupCode);
    if (group.status !== GroupOrderStatus.OPEN) throw new BadRequestException('This group is no longer open.');
    await this.assertSessionStillActive(group);
    await this.ensureParticipant(group, participantId, displayName, phoneMasked);
    return this.serialize(group, participantId);
  }

  async getGroup(restaurantId: string, groupCode: string, participantId?: string) {
    const group = await this.findGroupOrThrow(restaurantId, groupCode);
    await this.assertSessionStillActive(group);
    return this.serialize(group, participantId);
  }

  async syncMyItems(restaurantId: string, groupCode: string, participantId: string, rawItems: { itemId: string; quantity: number }[]) {
    this.assertParticipantId(participantId);
    const group = await this.findGroupOrThrow(restaurantId, groupCode);
    if (group.status !== GroupOrderStatus.OPEN) throw new BadRequestException('This group is no longer open.');
    await this.assertSessionStillActive(group);
    const member = await this.ensureParticipant(group, participantId);
    const items = Array.isArray(rawItems) ? rawItems : [];
    if (items.length > 100) throw new BadRequestException('Too many cart lines.');
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.itemId !== 'string') throw new BadRequestException('Invalid item.');
      this.assertValidId(item.itemId, 'Menu item');
      if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new BadRequestException('Invalid quantity.');
    }
    const distinctIds = [...new Set(items.map((i) => i.itemId))];
    if (distinctIds.length) {
      const found = await this.menuItemModel.find({ _id: { $in: distinctIds }, restaurantId });
      if (found.length !== distinctIds.length) throw new BadRequestException('One or more items are not available from this restaurant.');
    }
    member.items = items.map((i) => ({ menuItemId: new Types.ObjectId(i.itemId), quantity: i.quantity }));
    group.markModified('members');
    await group.save();
    return this.serialize(group, participantId);
  }

  async placeGroupOrder(restaurantId: string, groupCode: string, participantId: string) {
    this.assertParticipantId(participantId);
    const group = await this.findGroupOrThrow(restaurantId, groupCode);
    if (group.placedOrderId) {
      const existing = await this.orderModel.findById(group.placedOrderId);
      if (existing) return this.serializeOrder(existing, group);
    }
    if (group.status !== GroupOrderStatus.OPEN) throw new BadRequestException('This group order has already been placed.');
    const isMember = group.members.some((m) => m.participantId === participantId);
    if (!isMember) throw new NotFoundException('Join this group before placing its order.');
    await this.assertSessionStillActive(group);

    const restaurant = await this.restaurantModel.findById(group.restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant not found.');

    const flattened: { menuItemId: string; quantity: number; name: string }[] = [];
    for (const member of group.members) {
      const byItem = new Map<string, number>();
      for (const item of member.items) byItem.set(item.menuItemId.toString(), (byItem.get(item.menuItemId.toString()) ?? 0) + item.quantity);
      for (const [menuItemId, quantity] of byItem) flattened.push({ menuItemId, quantity, name: member.displayName ?? (member.participantId ? `Guest ${member.participantId.slice(-4)}` : 'Guest') });
    }
    if (!flattened.length) throw new BadRequestException('Nobody in the group has added any items yet.');

    const distinctIds = [...new Set(flattened.map((f) => f.menuItemId))];
    const menuItems = await this.menuItemModel.find({ _id: { $in: distinctIds }, restaurantId });
    if (menuItems.length !== distinctIds.length) throw new BadRequestException('One or more items are no longer available from this restaurant.');
    const byId = new Map(menuItems.map((m) => [m._id.toString(), m]));
    const items = flattened.map((f) => {
      const menuItem = byId.get(f.menuItemId)!;
      if (!menuItem.isAvailable) throw new BadRequestException(`"${menuItem.name}" is no longer available.`);
      return {
        menuItemId: menuItem._id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: f.quantity,
        lineTotal: menuItem.price * f.quantity,
        imageUrl: menuItem.imageUrl ?? null,
        addedByName: f.name,
      };
    });
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const _id = new Types.ObjectId();
    const order = await this.orderModel.create({
      _id,
      restaurantId: group.restaurantId,
      tableId: group.tableId,
      tableNumber: group.tableNumber,
      tableSessionId: group.tableSessionId,
      orderType: OrderType.DINE_IN,
      orderNumber: `ORD-${_id.toString().slice(-6).toUpperCase()}`,
      items,
      subtotal,
      total: subtotal,
      status: OrderStatus.NEW,
      groupOrderId: group._id,
      groupCode: group.groupCode,
      groupMembers: group.members.map((member) => ({
        participantId: member.participantId ?? '',
        name: member.displayName ?? 'Guest',
        phoneMasked: member.phoneMasked ?? null,
      })),
    });
    group.placedOrderId = order._id;
    group.placedOrderNumber = order.orderNumber;
    group.status = GroupOrderStatus.ORDERED;
    await group.save();
    return this.serializeOrder(order, group);
  }

  private serializeOrder(order: OrderDocument, group: GroupOrderDocument) {
    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: order.subtotal,
      total: order.total,
      items: order.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity, lineTotal: i.lineTotal, addedByName: i.addedByName ?? null })),
      orderType: order.orderType,
      table: order.tableNumber ? { tableNumber: order.tableNumber } : null,
      groupCode: group.groupCode,
      memberCount: group.members.length,
      createdAt: order.createdAt,
    };
  }
}
