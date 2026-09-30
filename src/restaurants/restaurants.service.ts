import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthorizationService } from '../common/authorization.service';
import { RestaurantMember, RestaurantMemberDocument } from '../restaurant-members/schemas/restaurant-member.schema';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BACKGROUND_TYPES = new Set(['gradient', 'solid', 'image', 'mesh']);
const CARD_STYLES = new Set(['glass', 'solid', 'soft']);

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(RestaurantMember.name) private readonly memberModel: Model<RestaurantMemberDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  private async requireManager(restaurantId: string, userId: string) {
    return this.authorization.requireRestaurantAccess(restaurantId, userId, true);
  }

  private safeColor(value: unknown, label: string): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
      throw new BadRequestException(`${label} must be a valid hex colour.`);
    }
    return value.trim();
  }

  private safeEnum(value: unknown, allowed: Set<string>, label: string): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !allowed.has(value)) throw new BadRequestException(`${label} has an invalid value.`);
    return value;
  }

  private safeNumber(value: unknown, label: string, min: number, max: number): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${label} must be between ${min} and ${max}.`);
    return n;
  }

  private safeLogoUrl(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('Logo URL must be a valid HTTPS URL.');
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:') throw new Error('https required');
      return url.toString();
    } catch {
      throw new BadRequestException('Logo URL must be a valid HTTPS URL.');
    }
  }

  async getBranding(restaurantId: string, userId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    const restaurant = await this.restaurantModel.findById(restaurantId).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return {
      restaurantName: restaurant.name,
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
    };
  }

  async updateBranding(
    restaurantId: string,
    userId: string,
    body: Record<string, unknown>,
  ) {
    await this.requireManager(restaurantId, userId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Branding details are required.');
    }
    const allowedFields = new Set([
      'logoUrl', 'primaryColor', 'accentColor', 'backgroundType', 'backgroundColor',
      'gradientStart', 'gradientMiddle', 'gradientEnd', 'gradientAngle',
      'backgroundImageUrl', 'overlayColor', 'overlayOpacity', 'surfaceColor',
      'textColor', 'mutedTextColor', 'buttonColor', 'cardStyle', 'heroEyebrow', 'heroTagline',
    ]);
    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
    if (unknownFields.length) {
      throw new BadRequestException(`Unsupported branding field: ${unknownFields[0]}.`);
    }
    const update: Partial<Restaurant> = {};
    const logoUrl = this.safeLogoUrl(body.logoUrl);
    const primaryColor = this.safeColor(body.primaryColor, 'Primary color');
    const accentColor = this.safeColor(body.accentColor, 'Accent color');
    const backgroundType = this.safeEnum(body.backgroundType, BACKGROUND_TYPES, 'Background type');
    const backgroundColor = this.safeColor(body.backgroundColor, 'Background color');
    const gradientStart = this.safeColor(body.gradientStart, 'Gradient start');
    const gradientMiddle = this.safeColor(body.gradientMiddle, 'Gradient middle');
    const gradientEnd = this.safeColor(body.gradientEnd, 'Gradient end');
    const gradientAngle = this.safeNumber(body.gradientAngle, 'Gradient angle', 0, 360);
    const backgroundImageUrl = this.safeLogoUrl(body.backgroundImageUrl);
    const overlayColor = this.safeColor(body.overlayColor, 'Overlay color');
    const overlayOpacity = this.safeNumber(body.overlayOpacity, 'Overlay opacity', 0, 1);
    const surfaceColor = this.safeColor(body.surfaceColor, 'Surface color');
    const textColor = this.safeColor(body.textColor, 'Text color');
    const mutedTextColor = this.safeColor(body.mutedTextColor, 'Muted text color');
    const buttonColor = this.safeColor(body.buttonColor, 'Button color');
    const cardStyle = this.safeEnum(body.cardStyle, CARD_STYLES, 'Card style');
    const heroEyebrow = body.heroEyebrow === undefined || body.heroEyebrow === null ? body.heroEyebrow : typeof body.heroEyebrow === 'string' ? body.heroEyebrow.trim().slice(0, 48) || null : (() => { throw new BadRequestException('Hero eyebrow must be a string.'); })();
    const heroTagline = body.heroTagline === undefined || body.heroTagline === null ? body.heroTagline : typeof body.heroTagline === 'string' ? body.heroTagline.trim().slice(0, 120) || null : (() => { throw new BadRequestException('Hero tagline must be a string.'); })();
    if (logoUrl !== undefined) update.logoUrl = logoUrl;
    if (primaryColor !== undefined) update.primaryColor = primaryColor;
    if (accentColor !== undefined) update.accentColor = accentColor;
    if (backgroundType !== undefined) update.backgroundType = backgroundType as Restaurant['backgroundType'];
    if (backgroundColor !== undefined) update.backgroundColor = backgroundColor;
    if (gradientStart !== undefined) update.gradientStart = gradientStart;
    if (gradientMiddle !== undefined) update.gradientMiddle = gradientMiddle;
    if (gradientEnd !== undefined) update.gradientEnd = gradientEnd;
    if (gradientAngle !== undefined) update.gradientAngle = gradientAngle;
    if (backgroundImageUrl !== undefined) update.backgroundImageUrl = backgroundImageUrl;
    if (overlayColor !== undefined) update.overlayColor = overlayColor;
    if (overlayOpacity !== undefined) update.overlayOpacity = overlayOpacity;
    if (surfaceColor !== undefined) update.surfaceColor = surfaceColor;
    if (textColor !== undefined) update.textColor = textColor;
    if (mutedTextColor !== undefined) update.mutedTextColor = mutedTextColor;
    if (buttonColor !== undefined) update.buttonColor = buttonColor;
    if (cardStyle !== undefined) update.cardStyle = cardStyle as Restaurant['cardStyle'];
    if (heroEyebrow !== undefined) update.heroEyebrow = heroEyebrow;
    if (heroTagline !== undefined) update.heroTagline = heroTagline;

    const restaurant = await this.restaurantModel.findByIdAndUpdate(restaurantId, { $set: update }, { new: true }).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return {
      restaurantName: restaurant.name,
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
    };
  }
}
