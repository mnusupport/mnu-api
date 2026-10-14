import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { Category } from './category.schema';

// A single dish/drink on a restaurant's menu, belonging to one category.
// `restaurantId` is denormalized onto the item (not just reachable via
// category) so restaurant-scoped queries and access checks don't need to
// resolve the category first — same rationale as the Prisma version.
//
// Unlike Prisma's `relationMode = "prisma"`, Mongoose has no built-in
// cascade emulation: deleting a Category does NOT delete its items on its
// own. MenuService.deleteCategory() deletes the category's items itself
// before removing the category (see that method for the explicit
// deleteMany() call).
// collection: 'MenuItem' — see user.schema.ts for why this is pinned.
@Schema({ timestamps: true, collection: 'MenuItem' })
export class MenuItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Category.name, required: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  // `@Prop({ type: String, ... })` here is required, not stylistic:
  // without an explicit `type`, @nestjs/mongoose falls back to
  // reflected TS metadata for the property's type, and a union type
  // like `string | null` reflects as ambiguous — @nestjs/mongoose
  // throws CannotDetermineTypeError at module-load time (i.e. the API
  // fails to boot at all, before ever reaching Mongo) rather than at
  // runtime on a specific request. Caught only by actually starting the
  // process; `tsc --noEmit` has no way to catch this since it's a
  // decorator-runtime/reflection issue, not a type error.
  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ required: true })
  price: number;

  @Prop({ default: true })
  isAvailable: boolean;

  @Prop({ default: 0 })
  sortOrder: number;

  // ---- Featured (Day 22) ----
  //
  // Admin-controlled editorial highlight. Day 14 and Day 21 both wanted
  // a "Featured" section and, finding no such field, stood in the first
  // item of each category by `sortOrder` — a reasonable placeholder but
  // not actual curation. This is that field, so "featured" now means
  // what an admin explicitly chose.
  //
  // Deliberately a flag on the item itself rather than a separate
  // `FeaturedItem` collection: Day 22's brief is explicit that the
  // featured item must keep the *same menu-item identity* (it still
  // appears in its own category, highlighted, and is never duplicated).
  // A boolean here means there is exactly one record per dish and no
  // possible drift between "the dish" and "the featured copy of the
  // dish".
  @Prop({ default: false })
  isFeatured: boolean;

  // This task: full HTTPS URL from Cloudinary (e.g.
  // `https://res.cloudinary.com/<cloud>/image/upload/.../menu-items/<id>.jpg`),
  // not a local path — see menu.service.ts's upload/remove methods and
  // common/cloudinary.ts. Previously (Day 16 and earlier) this stored a
  // path under this API's own `/uploads/` static route; any pre-existing
  // value in that old shape is handled defensively by the frontend's
  // `resolveImageUrl` (falls back to prefixing the API origin for
  // anything that isn't already an absolute URL), but nothing in this
  // sandbox's unreachable Atlas cluster is assumed to actually contain
  // one.
  @Prop({ type: String, default: null })
  imageUrl: string | null;

  // Cloudinary's `public_id` for the currently-stored image — needed to
  // delete/replace the exact right remote asset (Cloudinary has no
  // concept of "the file at this URL", deletion is by id). Purely an
  // internal implementation detail: never serialized to any API
  // response (see MenuService.serializeItem) since nothing in the
  // frontend needs it.
  @Prop({ type: String, default: null })
  imagePublicId: string | null;

  // Populated automatically by `{ timestamps: true }` above — declared
  // here, undecorated, purely so TypeScript knows these exist on a
  // hydrated/lean document. Same reasoning as `Order.createdAt` (see
  // that schema's comment): Day 14's public menu response now exposes
  // `createdAt` per item (for "New Arrivals"), which needed this typed
  // rather than accessed via a cast.
  createdAt: Date;
  updatedAt: Date;
}

export type MenuItemDocument = HydratedDocument<MenuItem>;
export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);

MenuItemSchema.index({ restaurantId: 1 });
MenuItemSchema.index({ categoryId: 1 });
