import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { UploadApiResponse } from "cloudinary";
import { cloudinary } from "../common/cloudinary";
import { AuthorizationService } from "../common/authorization.service";
import {
  RestaurantMember,
  RestaurantMemberDocument,
} from "../restaurant-members/schemas/restaurant-member.schema";
import {
  Restaurant,
  RestaurantDocument,
} from "../restaurants/schemas/restaurant.schema";
import { Category, CategoryDocument } from "./schemas/category.schema";
import { MenuItem, MenuItemDocument } from "./schemas/menu-item.schema";

// Only these roles can create/edit/delete categories and items.
// RESTAURANT_STAFF can still view the menu and toggle availability
// (e.g. 86'ing a dish that's run out) without full edit rights.
// Same rule as the pre-migration Prisma version — this ported over
// unchanged, only the storage layer moved.

// ---- Menu item images ----
//
// This task: moved off local disk (see menu-item.schema.ts's comment on
// `imageUrl` for what this replaced) onto Cloudinary — see
// common/cloudinary.ts for why that provider specifically. Validation
// rules (allowed types, size cap) are unchanged from the local-disk
// version; only where the bytes end up changed.
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — a phone photo, not a raw file
// Every menu item image lives under this one Cloudinary folder,
// namespaced by restaurant — keeps one restaurant's photos visibly
// separate from another's in the Cloudinary media library itself, not
// just in MongoDB.
const CLOUDINARY_FOLDER = "mnu/menu-items";

interface CategoryInput {
  name: string;
  sortOrder?: number;
}

interface MenuItemInput {
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  isAvailable?: boolean;
  sortOrder?: number;
}

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(RestaurantMember.name)
    private readonly restaurantMemberModel: Model<RestaurantMemberDocument>,
    @InjectModel(Restaurant.name)
    private readonly restaurantModel: Model<RestaurantDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  // ---- Access checks ----

  // A malformed id (bad ObjectId string) would otherwise reach Mongoose
  // and throw a raw CastError instead of a clean 404/403 — same guard
  // AuthService.me() already uses for userId.
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

  private async findCategoryOrThrow(restaurantId: string, categoryId: string) {
    this.assertValidId(categoryId, "Category");
    const category = await this.categoryModel.findOne({
      _id: categoryId,
      restaurantId,
    });
    if (!category) {
      throw new NotFoundException("Category not found.");
    }
    return category;
  }

  private async findMenuItemOrThrow(restaurantId: string, itemId: string) {
    this.assertValidId(itemId, "Menu item");
    const item = await this.menuItemModel.findOne({
      _id: itemId,
      restaurantId,
    });
    if (!item) {
      throw new NotFoundException("Menu item not found.");
    }
    return item;
  }

  private serializeItem(item: MenuItemDocument) {
    return {
      id: item._id.toString(),
      categoryId: item.categoryId.toString(),
      name: item.name,
      description: item.description ?? null,
      price: item.price,
      isAvailable: item.isAvailable,
      sortOrder: item.sortOrder,
      isFeatured: item.isFeatured ?? false,
      imageUrl: item.imageUrl ?? null,
    };
  }

  // ---- Reads (any restaurant member) ----

  async getMenu(restaurantId: string, userId: string) {
    await this.requireMembership(restaurantId, userId);

    const [categories, items] = await Promise.all([
      this.categoryModel.find({ restaurantId }).sort({ sortOrder: 1 }).lean(),
      this.menuItemModel.find({ restaurantId }).sort({ sortOrder: 1 }).lean(),
    ]);

    return categories.map((category) => ({
      id: category._id.toString(),
      name: category.name,
      sortOrder: category.sortOrder,
      items: items
        .filter(
          (item) => item.categoryId.toString() === category._id.toString(),
        )
        .map((item) => ({
          id: item._id.toString(),
          categoryId: item.categoryId.toString(),
          name: item.name,
          description: item.description ?? null,
          price: item.price,
          isAvailable: item.isAvailable,
          sortOrder: item.sortOrder,
          isFeatured: item.isFeatured ?? false,
          imageUrl: item.imageUrl ?? null,
        })),
    }));
  }

  // ---- Categories (managers only) ----

  async createCategory(
    restaurantId: string,
    userId: string,
    input: CategoryInput,
  ) {
    await this.requireManager(restaurantId, userId);
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new BadRequestException("Category name is required.");
    }
    if (input.sortOrder !== undefined && (!Number.isFinite(input.sortOrder) || input.sortOrder < 0)) {
      throw new BadRequestException("Sort order must be a non-negative number.");
    }

    const category = await this.categoryModel.create({
      restaurantId,
      name: input.name.trim(),
      sortOrder: input.sortOrder ?? 0,
    });

    return {
      id: category._id.toString(),
      name: category.name,
      sortOrder: category.sortOrder,
    };
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    userId: string,
    input: Partial<CategoryInput>,
  ) {
    await this.requireManager(restaurantId, userId);
    const category = await this.findCategoryOrThrow(restaurantId, categoryId);
    if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) {
      throw new BadRequestException("Category name is required.");
    }
    if (input.sortOrder !== undefined && (!Number.isFinite(input.sortOrder) || input.sortOrder < 0)) {
      throw new BadRequestException("Sort order must be a non-negative number.");
    }

    if (input.name !== undefined) category.name = input.name.trim();
    if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
    await category.save();

    return {
      id: category._id.toString(),
      name: category.name,
      sortOrder: category.sortOrder,
    };
  }

  async deleteCategory(
    restaurantId: string,
    categoryId: string,
    userId: string,
  ) {
    await this.requireManager(restaurantId, userId);
    await this.findCategoryOrThrow(restaurantId, categoryId);

    // Unlike Prisma's relationMode="prisma" cascade emulation, Mongoose
    // does nothing automatically here — delete the category's items
    // ourselves before removing the category.
    await this.menuItemModel.deleteMany({ categoryId });
    await this.categoryModel.deleteOne({ _id: categoryId });
    return { success: true };
  }

  // ---- Menu items ----

  async createMenuItem(
    restaurantId: string,
    userId: string,
    input: MenuItemInput,
  ) {
    await this.requireManager(restaurantId, userId);
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new BadRequestException("Item name is required.");
    }
    if (
      typeof input.price !== "number" ||
      Number.isNaN(input.price) ||
      input.price < 0
    ) {
      throw new BadRequestException("Price must be a non-negative number.");
    }
    await this.findCategoryOrThrow(restaurantId, input.categoryId);
    if (input.description !== undefined && typeof input.description !== 'string') {
      throw new BadRequestException("Description must be text.");
    }
    if (input.isAvailable !== undefined && typeof input.isAvailable !== 'boolean') {
      throw new BadRequestException("Availability must be a boolean.");
    }
    if (input.sortOrder !== undefined && (!Number.isFinite(input.sortOrder) || input.sortOrder < 0)) {
      throw new BadRequestException("Sort order must be a non-negative number.");
    }

    const item = await this.menuItemModel.create({
      restaurantId,
      categoryId: input.categoryId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      price: input.price,
      isAvailable: input.isAvailable ?? true,
      sortOrder: input.sortOrder ?? 0,
    });

    return this.serializeItem(item);
  }

  async updateMenuItem(
    restaurantId: string,
    itemId: string,
    userId: string,
    input: Partial<MenuItemInput>,
  ) {
    await this.requireManager(restaurantId, userId);
    const item = await this.findMenuItemOrThrow(restaurantId, itemId);

    if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) {
      throw new BadRequestException("Item name is required.");
    }
    if (
      input.price !== undefined &&
      (typeof input.price !== "number" ||
        Number.isNaN(input.price) ||
        input.price < 0)
    ) {
      throw new BadRequestException("Price must be a non-negative number.");
    }
    if (input.categoryId !== undefined) {
      if (typeof input.categoryId !== 'string') throw new BadRequestException("Category is required.");
      await this.findCategoryOrThrow(restaurantId, input.categoryId);
      item.categoryId = new Types.ObjectId(input.categoryId);
    }
    if (input.description !== undefined && typeof input.description !== 'string') {
      throw new BadRequestException("Description must be text.");
    }
    if (input.isAvailable !== undefined && typeof input.isAvailable !== 'boolean') {
      throw new BadRequestException("Availability must be a boolean.");
    }
    if (input.sortOrder !== undefined && (!Number.isFinite(input.sortOrder) || input.sortOrder < 0)) {
      throw new BadRequestException("Sort order must be a non-negative number.");
    }
    if (input.name !== undefined) item.name = input.name.trim();
    if (input.description !== undefined) item.description = input.description.trim() || null;
    if (input.price !== undefined) item.price = input.price;
    if (input.isAvailable !== undefined) item.isAvailable = input.isAvailable;
    if (input.sortOrder !== undefined) item.sortOrder = input.sortOrder;

    await item.save();
    return this.serializeItem(item);
  }

  async setAvailability(
    restaurantId: string,
    itemId: string,
    userId: string,
    isAvailable: boolean,
  ) {
    // Deliberately just requireMembership, not requireManager: staff can
    // toggle a dish off the menu without full edit rights.
    await this.requireMembership(restaurantId, userId);
    if (typeof isAvailable !== 'boolean') throw new BadRequestException("Availability must be a boolean.");
    const item = await this.findMenuItemOrThrow(restaurantId, itemId);
    item.isAvailable = isAvailable;
    await item.save();
    return this.serializeItem(item);
  }

  // Day 22 — admin-controlled Featured flag. Unlike setAvailability
  // above this is requireManager, not requireMembership: 86'ing a dish
  // that's run out is an operational call any staff member makes mid
  // service, but deciding what the restaurant *promotes* on its
  // customer home screen is an editorial/marketing decision, which
  // matches how every other content edit (create/update/delete item) is
  // already gated in this service.
  //
  // `findMenuItemOrThrow` scopes by {_id, restaurantId} together, so one
  // restaurant can never feature another restaurant's dish — same
  // isolation every other menu write already relies on.
  async setFeatured(
    restaurantId: string,
    itemId: string,
    userId: string,
    isFeatured: boolean,
  ) {
    await this.requireManager(restaurantId, userId);
    if (typeof isFeatured !== 'boolean') throw new BadRequestException("Featured must be a boolean.");
    const item = await this.findMenuItemOrThrow(restaurantId, itemId);
    item.isFeatured = isFeatured;
    await item.save();
    return this.serializeItem(item);
  }

  async deleteMenuItem(restaurantId: string, itemId: string, userId: string) {
    await this.requireManager(restaurantId, userId);
    await this.findMenuItemOrThrow(restaurantId, itemId);
    await this.menuItemModel.deleteOne({ _id: itemId });
    return { success: true };
  }

  // ---- Menu item image ----

  // Best-effort cleanup helper. Upload replacement flows call this only
  // after the new asset has been persisted; removal calls use it after
  // the database reference is cleared, so a provider failure cannot
  // leave the application pointing at a missing image.
  private async destroyImageIfAny(publicId: string | null | undefined) {
    if (!publicId) return;
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch {
      // Already gone, or the API call itself failed — fine either way,
      // we're about to overwrite/clear the reference regardless.
    }
  }

  async uploadItemImage(
    restaurantId: string,
    itemId: string,
    userId: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.requireManager(restaurantId, userId);
    const item = await this.findMenuItemOrThrow(restaurantId, itemId);

    if (!file) {
      throw new BadRequestException("No image file was uploaded.");
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        "Unsupported image type. Please upload a JPEG, PNG, or WebP file.",
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        "Image is too large. Please upload a file under 5MB.",
      );
    }

    const previousPublicId = item.imagePublicId ?? null;

    // Upload the replacement first. This ordering is deliberate: if
    // Cloudinary is unavailable, the restaurant keeps its existing image
    // instead of ending up with a broken reference.
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `${CLOUDINARY_FOLDER}/${restaurantId}`,
          resource_type: "image",
        },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(error ?? new Error("Cloudinary upload failed."));
            return;
          }
          resolve(uploadResult);
        },
      );
      stream.end(file.buffer);
    }).catch(() => {
      // Do not expose raw provider errors to the customer or application
      // logs. The old image reference remains untouched.
      throw new BadRequestException("Image upload failed. Please try again.");
    });

    try {
      item.imageUrl = result.secure_url;
      item.imagePublicId = result.public_id;
      await item.save();
    } catch (error) {
      // The database still points at the old asset, so clean up the newly
      // uploaded replacement to avoid an orphaned Cloudinary file.
      try {
        await cloudinary.uploader.destroy(result.public_id);
      } catch {
        // Best effort only; preserving the database reference is safer.
      }
      throw error;
    }

    // Delete the old asset only after the new URL is safely persisted.
    if (previousPublicId && previousPublicId !== result.public_id) {
      try {
        await cloudinary.uploader.destroy(previousPublicId);
      } catch {
        // A stale remote asset is less harmful than breaking the successful
        // menu update; the stored URL is already the new one.
      }
    }

    return this.serializeItem(item);
  }
  async removeItemImage(restaurantId: string, itemId: string, userId: string) {
    await this.requireManager(restaurantId, userId);
    const item = await this.findMenuItemOrThrow(restaurantId, itemId);

    const previousPublicId = item.imagePublicId ?? null;
    item.imageUrl = null;
    item.imagePublicId = null;
    await item.save();
    if (previousPublicId) await this.destroyImageIfAny(previousPublicId);
    return this.serializeItem(item);
  }

  // Read-only, unauthenticated: resolves a menu item's current image URL
  // so `GET /public/restaurants/:id/menu-items/:itemId/image` (see
  // PublicMenuController) can redirect straight to it. Added because
  // that path had only ever supported POST (upload) and DELETE
  // (remove) — pasting or requesting it directly (e.g. to sanity-check
  // an upload) 404'd even when the upload itself had succeeded. Safe to
  // expose without auth: the value it returns is a Cloudinary
  // `secure_url` that is already public once an image is uploaded, so
  // this reveals nothing an authenticated admin request wouldn't.
  async getItemImageUrl(restaurantId: string, itemId: string): Promise<string> {
    const item = await this.findMenuItemOrThrow(restaurantId, itemId);
    if (!item.imageUrl) {
      throw new NotFoundException("This item has no image.");
    }
    // Defensive: `imageUrl` should always be an absolute Cloudinary
    // `https://` URL (see uploadItemImage — it's set to
    // `result.secure_url` and nothing else ever writes this field). If
    // it somehow isn't (stale data from before Cloudinary was wired up,
    // or a bad manual edit), redirecting to it here would either be
    // useless or — if it ever pointed back at this very endpoint —
    // loop forever. Fail loudly instead of redirecting blindly.
    if (!/^https?:\/\//i.test(item.imageUrl)) {
      throw new NotFoundException(
        "This item's stored image reference is invalid (not a real image URL). Re-upload its photo from the admin menu screen.",
      );
    }
    return item.imageUrl;
  }

  // ---- Public read (Day 9 — no auth, no membership check) ----

  // Deliberately a separate method rather than reusing getMenu(): the
  // access rule is different (no membership required at all — this is
  // what an anonymous customer's browser calls) and the shape returned
  // is intentionally smaller (no isAvailable/sortOrder/categoryId on
  // items, no unavailable items at all, no empty categories) — this is
  // public-facing data, not the admin management payload with fields
  // trimmed off client-side.
  //
  // Day 14 addition: `createdAt` is now included per item. This isn't a
  // new field — `MenuItem` has always had it via `{ timestamps: true }`
  // — it just wasn't exposed here before because nothing on the
  // customer side needed it. The new customer Home page's "New
  // Arrivals" section needs a real, non-fabricated recency signal, and
  // this is already-real, already-stored data; exposing it is a
  // one-line addition, not a new backend system.
  async getPublicMenu(restaurantId: string) {
    this.assertValidId(restaurantId, "Restaurant");
    const restaurant = await this.restaurantModel.findById(restaurantId);
    if (!restaurant) {
      throw new NotFoundException("Restaurant not found.");
    }

    const [categories, items] = await Promise.all([
      this.categoryModel.find({ restaurantId }).sort({ sortOrder: 1 }).lean(),
      // Only isAvailable items — an 86'd dish shouldn't show to
      // customers, even though it's still visible to staff/admins in
      // the manage view (getMenu() above returns it either way).
      this.menuItemModel
        .find({ restaurantId, isAvailable: true })
        .sort({ sortOrder: 1 })
        .lean(),
    ]);

    return {
      restaurantName: restaurant.name,
      // Day 22 — restaurant branding for the customer header/loading
      // screen. All nullable; the customer UI has a defined fallback for
      // each (initial-letter avatar + MnU default palette), so a
      // restaurant that has set none of this still renders completely.
      // Only these three fields are exposed — nothing else on the
      // Restaurant document is public.
      branding: {
        logoUrl: restaurant.logoUrl ?? null,
        primaryColor: restaurant.primaryColor ?? null,
        accentColor: restaurant.accentColor ?? null,
        backgroundType: restaurant.backgroundType ?? null,
        backgroundColor: restaurant.backgroundColor ?? null,
        gradientStart: restaurant.gradientStart ?? null,
        gradientMiddle: restaurant.gradientMiddle ?? null,
        gradientEnd: restaurant.gradientEnd ?? null,
        gradientAngle: restaurant.gradientAngle ?? null,
        backgroundImageUrl: restaurant.backgroundImageUrl ?? null,
        overlayColor: restaurant.overlayColor ?? null,
        overlayOpacity: restaurant.overlayOpacity ?? null,
        surfaceColor: restaurant.surfaceColor ?? null,
        textColor: restaurant.textColor ?? null,
        mutedTextColor: restaurant.mutedTextColor ?? null,
        buttonColor: restaurant.buttonColor ?? null,
        cardStyle: restaurant.cardStyle ?? null,
        heroEyebrow: restaurant.heroEyebrow ?? null,
        heroTagline: restaurant.heroTagline ?? null,
      },
      categories: categories
        .map((category) => ({
          id: category._id.toString(),
          name: category.name,
          items: items
            .filter(
              (item) => item.categoryId.toString() === category._id.toString(),
            )
            .map((item) => ({
              id: item._id.toString(),
              name: item.name,
              description: item.description ?? null,
              price: item.price,
              createdAt: item.createdAt,
              // Day 22 — admin-controlled. Drives both the Home
              // "Featured" section and the in-category highlight, from
              // this one field on this one record: the item is never
              // duplicated or moved out of its category.
              isFeatured: item.isFeatured ?? false,
              imageUrl: item.imageUrl ?? null,
            })),
        }))
        // Drop categories that end up with nothing visible in them,
        // rather than showing an empty heading with no items under it.
        .filter((category) => category.items.length > 0),
    };
  }
}
