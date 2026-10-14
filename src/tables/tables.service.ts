import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthorizationService } from '../common/authorization.service';
import { RestaurantMember, RestaurantMemberDocument } from '../restaurant-members/schemas/restaurant-member.schema';
import { Table, TableDocument, TableStatus } from './schemas/table.schema';

// Only these roles can create/edit/delete tables. RESTAURANT_STAFF can
// view only — unlike MenuService's staff exception for availability
// toggling, there's no staff-appropriate table action at this stage, so
// staff gets a plain read-only view here.

interface TableInput {
  tableNumber: string;
  capacity: number;
  status?: TableStatus;
}

@Injectable()
export class TablesService implements OnModuleInit {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(RestaurantMember.name)
    private readonly restaurantMemberModel: Model<RestaurantMemberDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  // Reconciles the *actual* indexes in MongoDB with what's declared on
  // the Table schema right now, every time the API boots.
  //
  // Why this matters: `mongoose.autoIndex` (on by default outside
  // production) only ever ADDS indexes that are missing — it never
  // drops or rebuilds one that no longer matches the schema. This
  // collection went through more than one shape across days of
  // iterative development against the same live database, so it's
  // entirely possible an earlier, differently-scoped unique index on
  // `tableNumber` (or an index built before `restaurantId` was part of
  // the compound key) is still sitting in MongoDB even though the
  // schema here has always looked correct in code review. A stale
  // index like that is exactly what would make MongoDB reject a brand
  // new, genuinely-unique table number with "E11000 duplicate key" —
  // which `createTable`/`updateTable` below then (correctly, but
  // misleadingly) translate into "A table with that number already
  // exists."
  //
  // `syncIndexes()` drops any index not defined on the schema and
  // (re)builds the ones that are, so the two can never drift again.
  // This is safe to run on every boot — it's a no-op once indexes are
  // already in sync.
  async onModuleInit() {
    try {
      await this.tableModel.syncIndexes();
    } catch (err) {
      // Don't crash the app over index maintenance — worst case the
      // stale-index symptom above persists until this is retried.
      this.logger.error('Failed to sync Table indexes', err instanceof Error ? err.stack : err);
    }
  }

  // ---- Access checks (identical pattern to MenuService) ----

  private assertValidId(id: string, label: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`${label} not found.`);
    }
  }

  private async requireMembership(restaurantId: string, userId: string) {
    return this.authorization.requireRestaurantAccess(restaurantId, userId);
  }

  private async requireManager(restaurantId: string, userId: string) {
    return this.authorization.requireRestaurantAccess(restaurantId, userId, true);
  }

  private async findTableOrThrow(restaurantId: string, tableId: string) {
    this.assertValidId(tableId, 'Table');
    // Scoping the query by restaurantId (not just _id) is what actually
    // prevents cross-restaurant access — a valid table id belonging to a
    // different restaurant simply won't match and 404s, same as
    // MenuService's findCategoryOrThrow/findMenuItemOrThrow.
    const table = await this.tableModel.findOne({ _id: tableId, restaurantId });
    if (!table) {
      throw new NotFoundException('Table not found.');
    }
    return table;
  }

  private validateInput(input: Partial<TableInput>) {
    if (input.tableNumber !== undefined && !input.tableNumber.trim()) {
      throw new BadRequestException('Table number is required.');
    }
    if (
      input.capacity !== undefined &&
      (typeof input.capacity !== 'number' || Number.isNaN(input.capacity) || input.capacity < 1)
    ) {
      throw new BadRequestException('Capacity must be a positive number.');
    }
    if (input.status !== undefined && !Object.values(TableStatus).includes(input.status)) {
      throw new BadRequestException('Invalid table status.');
    }
  }

  private serialize(table: TableDocument) {
    return {
      id: table._id.toString(),
      restaurantId: table.restaurantId.toString(),
      tableNumber: table.tableNumber,
      capacity: table.capacity,
      status: table.status,
    };
  }

  // ---- Reads (any restaurant member — admin or staff) ----

  async listTables(restaurantId: string, userId: string) {
    await this.requireMembership(restaurantId, userId);
    const tables = await this.tableModel.find({ restaurantId }).sort({ tableNumber: 1 });
    return tables.map((t) => this.serialize(t));
  }

  async getTable(restaurantId: string, tableId: string, userId: string) {
    await this.requireMembership(restaurantId, userId);
    const table = await this.findTableOrThrow(restaurantId, tableId);
    return this.serialize(table);
  }

  // ---- Writes (admin/super-admin only) ----

  async createTable(restaurantId: string, userId: string, input: TableInput) {
    await this.requireManager(restaurantId, userId);
    this.validateInput(input);

    try {
      const table = await this.tableModel.create({
        restaurantId,
        tableNumber: input.tableNumber.trim(),
        capacity: input.capacity,
        status: input.status ?? TableStatus.AVAILABLE,
      });
      return this.serialize(table);
    } catch (err: unknown) {
      // Duplicate (restaurantId, tableNumber) — Mongo error code 11000.
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000) {
        throw new BadRequestException('A table with that number already exists.');
      }
      throw err;
    }
  }

  async updateTable(restaurantId: string, tableId: string, userId: string, input: Partial<TableInput>) {
    await this.requireManager(restaurantId, userId);
    const table = await this.findTableOrThrow(restaurantId, tableId);
    this.validateInput(input);

    if (input.tableNumber !== undefined) table.tableNumber = input.tableNumber.trim();
    if (input.capacity !== undefined) table.capacity = input.capacity;
    if (input.status !== undefined) table.status = input.status;

    try {
      await table.save();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000) {
        throw new BadRequestException('A table with that number already exists.');
      }
      throw err;
    }
    return this.serialize(table);
  }

  async deleteTable(restaurantId: string, tableId: string, userId: string) {
    await this.requireManager(restaurantId, userId);
    await this.findTableOrThrow(restaurantId, tableId);
    await this.tableModel.deleteOne({ _id: tableId });
    return { success: true };
  }
}
