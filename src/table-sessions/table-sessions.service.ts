import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { Table, TableDocument, TableStatus } from '../tables/schemas/table.schema';
import { TableSession, TableSessionDocument, TableSessionStatus } from './schemas/table-session.schema';

@Injectable()
export class TableSessionsService {
  constructor(
    @InjectModel(TableSession.name) private readonly sessionModel: Model<TableSessionDocument>,
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
  ) {}

  // ---- Validation ----

  private assertValidId(id: string, label: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`${label} not found.`);
    }
  }

  // This is the actual multi-tenant isolation check: the table must
  // exist AND belong to the restaurant in the URL, checked together in
  // one query — same pattern MenuService/TablesService already use for
  // the admin side. A tableId that's real but belongs to a different
  // restaurant just 404s, indistinguishable from a nonexistent id.
  private async findTableOrThrow(restaurantId: string, tableId: string) {
    this.assertValidId(restaurantId, 'Restaurant');
    this.assertValidId(tableId, 'Table');
    const table = await this.tableModel.findOne({ _id: tableId, restaurantId });
    if (!table) {
      throw new NotFoundException('Table not found.');
    }
    return table;
  }

  private async findRestaurantOrThrow(restaurantId: string) {
    const restaurant = await this.restaurantModel.findById(restaurantId);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
    }
    return restaurant;
  }

  // ---- Serialization ----

  private serializeSession(session: TableSessionDocument) {
    return {
      sessionId: session.sessionId,
      restaurantId: session.restaurantId.toString(),
      tableId: session.tableId.toString(),
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    };
  }

  private async buildResponse(session: TableSessionDocument, table: TableDocument, restaurant: RestaurantDocument) {
    return {
      session: this.serializeSession(session),
      table: {
        id: table._id.toString(),
        tableNumber: table.tableNumber,
        capacity: table.capacity,
      },
      restaurant: {
        id: restaurant._id.toString(),
        name: restaurant.name,
      },
    };
  }

  // ---- Operations ----

  // Idempotent by design: scanning the same table's QR twice (e.g. a
  // page refresh) should land the customer back in the same session,
  // not spawn a second one.
  async startSession(restaurantId: string, tableId: string) {
    const table = await this.findTableOrThrow(restaurantId, tableId);
    // Day 10: a table taken out of service (e.g. under repair, removed
    // from the floor) shouldn't let a customer start a fresh session by
    // scanning its QR, even though the row itself still exists. This
    // only gates *starting* a new session — getActiveSession/endSession
    // deliberately don't re-check status, so an existing session at a
    // table that became inactive mid-visit can still be viewed/ended.
    if (table.status === TableStatus.INACTIVE) {
      throw new BadRequestException('This table is currently inactive.');
    }
    const restaurant = await this.findRestaurantOrThrow(restaurantId);

    const existing = await this.sessionModel.findOne({ tableId, status: TableSessionStatus.ACTIVE });
    if (existing) {
      return this.buildResponse(existing, table, restaurant);
    }

    try {
      const session = await this.sessionModel.create({
        restaurantId,
        tableId,
        sessionId: randomUUID(),
        status: TableSessionStatus.ACTIVE,
        startedAt: new Date(),
        endedAt: null,
      });
      return this.buildResponse(session, table, restaurant);
    } catch (err: unknown) {
      // Two near-simultaneous scans of the same table both pass the
      // findOne-above check, then race to create — the partial unique
      // index on {tableId, status: ACTIVE} rejects the loser with Mongo
      // error code 11000. Rather than surface that as an error, fetch
      // and return the session the winner just created — the customer
      // just wants *a* session for their table, not to know they lost a
      // race they never knew was happening.
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000) {
        const winner = await this.sessionModel.findOne({ tableId, status: TableSessionStatus.ACTIVE });
        if (winner) {
          return this.buildResponse(winner, table, restaurant);
        }
      }
      throw err;
    }
  }

  async getActiveSession(restaurantId: string, tableId: string) {
    const table = await this.findTableOrThrow(restaurantId, tableId);
    const restaurant = await this.findRestaurantOrThrow(restaurantId);

    const session = await this.sessionModel.findOne({ tableId, status: TableSessionStatus.ACTIVE });
    if (!session) {
      throw new NotFoundException('No active session for this table.');
    }
    return this.buildResponse(session, table, restaurant);
  }

}
