import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';

// A physical table at one restaurant. Deliberately minimal for this
// stage — no QR token/session fields yet; that's a separate, later task.
export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  INACTIVE = 'INACTIVE',
}

// This is a brand-new collection with no prior Prisma-era data to stay
// compatible with (unlike User/Restaurant/RestaurantMember/Category/
// MenuItem — see those schemas' comments), so there's no need to pin an
// explicit `collection:` name here. Mongoose's default ('tables',
// lowercased + pluralized from the class name) is fine.
@Schema({ timestamps: true })
export class Table {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  // Every @Prop below has an explicit `type:` even where it looks
  // redundant (e.g. `type: String` for a plain string) — this is
  // deliberate, not stylistic. See menu-item.schema.ts's `description`
  // field for why: without it, @nestjs/mongoose falls back to reflected
  // TS metadata, and any future edit that turns a field into a union
  // type (e.g. allowing null) would silently reintroduce that same
  // module-load crash. Explicit `type:` everywhere avoids relying on
  // reflection at all.
  @Prop({ type: String, required: true, trim: true })
  tableNumber: string;

  @Prop({ type: Number, required: true, min: 1 })
  capacity: number;

  @Prop({ type: String, enum: TableStatus, default: TableStatus.AVAILABLE })
  status: TableStatus;
}

export type TableDocument = HydratedDocument<Table>;
export const TableSchema = SchemaFactory.createForClass(Table);

// Every table read/list is scoped to a restaurant — same access pattern
// as Category/MenuItem's restaurantId index.
TableSchema.index({ restaurantId: 1 });
// A restaurant shouldn't have two tables with the same number/name.
TableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });
