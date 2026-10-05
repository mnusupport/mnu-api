import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { Table } from '../../tables/schemas/table.schema';

// A customer's presence at one table, from scan to leaving. Deliberately
// minimal for this stage — no cart/order/customer-identity fields yet;
// those are separate, later tasks. This is purely "who is sitting at
// this table right now," nothing more.
export enum TableSessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

@Schema({ timestamps: false })
export class TableSession {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Table.name, required: true })
  tableId: Types.ObjectId;

  // A separate, opaque public identifier from Mongo's own _id — this is
  // what would eventually round-trip through a QR code / customer's
  // browser, so it's deliberately not the same value as the internal
  // document id.
  @Prop({ type: String, required: true })
  sessionId: string;

  @Prop({ type: String, enum: TableSessionStatus, default: TableSessionStatus.ACTIVE })
  status: TableSessionStatus;

  @Prop({ type: Date, required: true })
  startedAt: Date;

  // Explicit `type: Date` (not inferred) even though this field is
  // nullable — same reasoning as MenuItem.description: a TS union type
  // (`Date | null`) reflects ambiguously and @nestjs/mongoose throws
  // CannotDetermineTypeError at boot without an explicit type. See
  // menu-item.schema.ts and docs/PROGRESS.md for the original incident.
  @Prop({ type: Date, default: null })
  endedAt: Date | null;
}

export type TableSessionDocument = HydratedDocument<TableSession>;
export const TableSessionSchema = SchemaFactory.createForClass(TableSession);

// Restaurant-scoped queries (not used by any endpoint yet, but consistent
// with every other schema in this project).
TableSessionSchema.index({ restaurantId: 1 });
// The public-facing lookup key.
TableSessionSchema.index({ sessionId: 1 }, { unique: true });
// At most one ACTIVE session per table at a time — a partial unique
// index (only enforced among ACTIVE documents) so a table can freely
// accumulate many ENDED sessions over time without conflict.
TableSessionSchema.index(
  { tableId: 1 },
  { unique: true, partialFilterExpression: { status: TableSessionStatus.ACTIVE } },
);
