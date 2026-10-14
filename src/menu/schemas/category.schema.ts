import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';

// A named grouping of menu items for one restaurant (e.g. "Starters",
// "Mains"). `sortOrder` controls display order within the restaurant.
// Ported from the Prisma `Category` model (mnu_v1) to Mongoose, matching
// this codebase's post-migration conventions.
// collection: 'Category' — see user.schema.ts for why this is pinned.
@Schema({ timestamps: true, collection: 'Category' })
export class Category {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Restaurant.name, required: true })
  restaurantId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ default: 0 })
  sortOrder: number;
}

export type CategoryDocument = HydratedDocument<Category>;
export const CategorySchema = SchemaFactory.createForClass(Category);

// Every menu read is scoped to a restaurant — same access pattern as
// RestaurantMember's restaurantId index.
CategorySchema.index({ restaurantId: 1 });
