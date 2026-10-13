import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UploadApiResponse } from 'cloudinary';
import { cloudinary } from '../common/cloudinary';
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

  private cleanText(value: unknown, label: string, maxLength: number, optional = true): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') {
      if (!optional) throw new BadRequestException(`${label} is required.`);
      return null;
    }
    if (typeof value !== 'string') throw new BadRequestException(`${label} must be text.`);
    const cleaned = value.trim();
    if (!cleaned && !optional) throw new BadRequestException(`${label} is required.`);
    if (cleaned.length > maxLength) throw new BadRequestException(`${label} must be ${maxLength} characters or fewer.`);
    return cleaned || null;
  }

  private serializeProfile(restaurant: any) {
    return {
      restaurantName: restaurant.name ?? '', legalBusinessName: restaurant.legalBusinessName ?? '',
      logoUrl: restaurant.logoUrl ?? null, contactPhone: restaurant.contactPhone ?? '',
      contactEmail: restaurant.contactEmail ?? '', addressLine: restaurant.addressLine ?? '',
      city: restaurant.city ?? '', state: restaurant.state ?? '', pinCode: restaurant.pinCode ?? '',
      country: restaurant.country ?? 'India', gstRegistrationStatus: restaurant.gstRegistrationStatus ?? 'NOT_REGISTERED',
      gstin: restaurant.gstin ?? '', registeredBusinessName: restaurant.registeredBusinessName ?? '', gstState: restaurant.gstState ?? '',
    };
  }

  async getProfile(restaurantId: string, userId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    const restaurant = await this.restaurantModel.findById(restaurantId).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return this.serializeProfile(restaurant);
  }

  async updateProfile(restaurantId: string, userId: string, body: Record<string, unknown>) {
    await this.requireManager(restaurantId, userId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Restaurant profile is required.');
    const allowed = new Set(['restaurantName','legalBusinessName','logoUrl','contactPhone','contactEmail','addressLine','city','state','pinCode','country','gstRegistrationStatus','gstin','registeredBusinessName','gstState']);
    const unknown = Object.keys(body).find((key) => !allowed.has(key));
    if (unknown) throw new BadRequestException(`Unsupported profile field: ${unknown}.`);
    const update: Record<string, unknown> = {};
    const logoUrl = this.safeLogoUrl(body.logoUrl);
    if (logoUrl !== undefined) update.logoUrl = logoUrl;
    const fields: Array<[string, string, number, boolean?]> = [
      ['restaurantName','Restaurant name',120,false], ['legalBusinessName','Legal business name',160], ['contactPhone','Contact phone',25],
      ['contactEmail','Contact email',254], ['addressLine','Address line',250], ['city','City',100], ['state','State',100], ['pinCode','PIN code',10], ['country','Country',80,false],
      ['registeredBusinessName','Registered business name',160], ['gstState','GST state',100],
    ];
    for (const [key, label, max, optional] of fields) {
      const val = this.cleanText(body[key], label, max, optional !== false);
      if (val !== undefined) update[key === 'restaurantName' ? 'name' : key] = val;
    }
    if (body.contactEmail !== undefined && body.contactEmail !== null && body.contactEmail !== '') {
      const email = String(body.contactEmail).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Enter a valid contact email.');
      update.contactEmail = email.toLowerCase();
    }
    if (body.contactPhone !== undefined && body.contactPhone !== null && body.contactPhone !== '') {
      const phone = String(body.contactPhone).trim();
      if (!/^[+()\d\s.-]{7,25}$/.test(phone)) throw new BadRequestException('Enter a valid contact phone number.');
      update.contactPhone = phone;
    }
    if (body.pinCode !== undefined && body.pinCode !== null && body.pinCode !== '') {
      const pin = String(body.pinCode).trim();
      if (!/^[1-9][0-9]{5}$/.test(pin)) throw new BadRequestException('Indian PIN code must contain six digits and cannot start with zero.');
      update.pinCode = pin;
    }
    if (body.gstRegistrationStatus !== undefined) {
      if (!['REGISTERED','NOT_REGISTERED'].includes(String(body.gstRegistrationStatus))) throw new BadRequestException('GST registration status is invalid.');
      update.gstRegistrationStatus = body.gstRegistrationStatus;
    }
    const current = await this.restaurantModel.findById(restaurantId).lean();
    if (!current) throw new NotFoundException('Restaurant not found.');
    const registered = (update.gstRegistrationStatus ?? current.gstRegistrationStatus ?? 'NOT_REGISTERED') === 'REGISTERED';
    if (body.gstin !== undefined || !registered) {
      const gstin = registered ? String(body.gstin ?? current.gstin ?? '').trim().toUpperCase() : '';
      if (registered && !/^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
        throw new BadRequestException('Enter a GSTIN in the expected 15-character format. This check does not verify official registration.');
      }
      update.gstin = gstin || null;
    }
    if (registered) {
      const registeredName = String(update.registeredBusinessName ?? current.registeredBusinessName ?? '').trim();
      const gstState = String(update.gstState ?? current.gstState ?? '').trim();
      if (!registeredName) throw new BadRequestException('Registered business name is required when GST registered.');
      if (!gstState) throw new BadRequestException('GST registration state is required when GST registered.');
      const gstin = String(update.gstin ?? current.gstin ?? '').trim().toUpperCase();
      const stateCodeByName: Record<string,string> = { 'jammu and kashmir':'01','himachal pradesh':'02','punjab':'03','chandigarh':'04','uttarakhand':'05','haryana':'06','delhi':'07','rajasthan':'08','uttar pradesh':'09','bihar':'10','sikkim':'11','arunachal pradesh':'12','nagaland':'13','manipur':'14','mizoram':'15','tripura':'16','meghalaya':'17','assam':'18','west bengal':'19','jharkhand':'20','odisha':'21','chhattisgarh':'22','madhya pradesh':'23','gujarat':'24','dadra and nagar haveli and daman and diu':'26','maharashtra':'27','karnataka':'29','goa':'30','lakshadweep':'31','kerala':'32','tamil nadu':'33','puducherry':'34','andaman and nicobar islands':'35','telangana':'36','andhra pradesh':'37','ladakh':'38' };
      const expected = stateCodeByName[gstState.toLowerCase()];
      if (expected && gstin.slice(0,2) !== expected) throw new BadRequestException('GSTIN state code does not match the selected GST registration state.');
    } else {
      update.gstin = null; update.registeredBusinessName = null; update.gstState = null;
    }
    const restaurant = await this.restaurantModel.findByIdAndUpdate(restaurantId, { $set: update }, { new: true, runValidators: true }).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return this.serializeProfile(restaurant);
  }

  async uploadRestaurantLogo(restaurantId: string, userId: string, file: Express.Multer.File | undefined) {
    await this.requireManager(restaurantId, userId);
    if (!file || !file.buffer) throw new BadRequestException('Choose a logo image to upload.');
    if (!new Set(['image/jpeg','image/png','image/webp']).has(file.mimetype)) throw new BadRequestException('Logo must be a JPEG, PNG, or WebP image.');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Logo must be smaller than 5 MB.');
    const current = await this.restaurantModel.findById(restaurantId).lean();
    if (!current) throw new NotFoundException('Restaurant not found.');
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: `mnu/restaurant-logos/${restaurantId}`, resource_type: 'image' }, (error, uploaded) => {
        if (error || !uploaded) reject(error ?? new Error('Upload failed')); else resolve(uploaded);
      });
      stream.end(file.buffer);
    }).catch(() => { throw new BadRequestException('Logo upload failed. Check image storage configuration and try again.'); });
    try {
      const restaurant = await this.restaurantModel.findByIdAndUpdate(restaurantId, { $set: { logoUrl: result.secure_url, logoPublicId: result.public_id } }, { new: true }).lean();
      if (!restaurant) throw new NotFoundException('Restaurant not found.');
      if (current.logoPublicId && current.logoPublicId !== result.public_id) await cloudinary.uploader.destroy(current.logoPublicId).catch(() => undefined);
      return { logoUrl: restaurant.logoUrl };
    } catch (error) {
      await cloudinary.uploader.destroy(result.public_id).catch(() => undefined);
      throw error;
    }
  }

  private serializeBillingSettings(restaurant: any) {
    return { currency: restaurant.billingCurrency ?? 'INR', invoicePrefix: restaurant.invoicePrefix ?? 'INV-',
      pricingTaxMode: restaurant.pricingTaxMode ?? 'EXCLUSIVE', taxConfigurationMode: restaurant.taxConfigurationMode ?? 'NONE',
      defaultTaxPercent: restaurant.defaultTaxPercent ?? null, discountEnabled: restaurant.discountEnabled ?? false,
      serviceChargeEnabled: restaurant.serviceChargeEnabled ?? false, serviceChargePercent: restaurant.serviceChargePercent ?? null,
      receiptFooter: restaurant.receiptFooter ?? '' };
  }

  async getBillingSettings(restaurantId: string, userId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    const restaurant = await this.restaurantModel.findById(restaurantId).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return this.serializeBillingSettings(restaurant);
  }

  async updateBillingSettings(restaurantId: string, userId: string, body: Record<string, unknown>) {
    await this.requireManager(restaurantId, userId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Billing settings are required.');
    const allowed = new Set(['currency','invoicePrefix','pricingTaxMode','taxConfigurationMode','defaultTaxPercent','discountEnabled','serviceChargeEnabled','serviceChargePercent','receiptFooter']);
    const unknown = Object.keys(body).find((key) => !allowed.has(key));
    if (unknown) throw new BadRequestException(`Unsupported billing setting: ${unknown}.`);
    const current = await this.restaurantModel.findById(restaurantId).lean();
    if (!current) throw new NotFoundException('Restaurant not found.');
    const update: Record<string, unknown> = {};
    if (body.currency !== undefined) {
      if (body.currency !== 'INR') throw new BadRequestException('Only INR is currently supported.');
      update.billingCurrency = 'INR';
    }
    if (body.invoicePrefix !== undefined) {
      if (typeof body.invoicePrefix !== 'string' || !/^[A-Za-z0-9-]{1,12}$/.test(body.invoicePrefix.trim())) throw new BadRequestException('Invoice prefix must be 1–12 letters, numbers, or hyphens.');
      update.invoicePrefix = body.invoicePrefix.trim().toUpperCase();
    }
    if (body.pricingTaxMode !== undefined) {
      if (!['INCLUSIVE','EXCLUSIVE'].includes(String(body.pricingTaxMode))) throw new BadRequestException('Pricing tax mode is invalid.');
      update.pricingTaxMode = body.pricingTaxMode;
    }
    if (body.taxConfigurationMode !== undefined) {
      if (!['NONE','GST_CONFIGURED'].includes(String(body.taxConfigurationMode))) throw new BadRequestException('Tax configuration mode is invalid.');
      if (body.taxConfigurationMode === 'GST_CONFIGURED' && (current.gstRegistrationStatus ?? 'NOT_REGISTERED') !== 'REGISTERED') throw new BadRequestException('Complete registered GST profile details before configuring GST settings.');
      update.taxConfigurationMode = body.taxConfigurationMode;
    }
    const taxMode = String(update.taxConfigurationMode ?? current.taxConfigurationMode ?? 'NONE');
    if (body.defaultTaxPercent !== undefined) {
      if (body.defaultTaxPercent === null || body.defaultTaxPercent === '') update.defaultTaxPercent = null;
      else { const n = Number(body.defaultTaxPercent); if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException('Tax percentage must be between 0 and 100.'); update.defaultTaxPercent = n; }
    }
    const taxPercent = update.defaultTaxPercent !== undefined ? update.defaultTaxPercent : current.defaultTaxPercent;
    if (taxMode === 'GST_CONFIGURED' && (taxPercent === null || taxPercent === undefined)) throw new BadRequestException('Set a configured default tax percentage, or turn tax configuration off. This is a preference only, not an automatic tax calculation.');
    for (const [key, dbKey] of [['discountEnabled','discountEnabled'],['serviceChargeEnabled','serviceChargeEnabled']] as const) {
      if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') throw new BadRequestException(`${key} must be true or false.`); update[dbKey] = body[key]; }
    }
    if (body.serviceChargePercent !== undefined) {
      if (body.serviceChargePercent === null || body.serviceChargePercent === '') update.serviceChargePercent = null;
      else { const n = Number(body.serviceChargePercent); if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException('Service charge percentage must be between 0 and 100.'); update.serviceChargePercent = n; }
    }
    const serviceEnabled = Boolean(update.serviceChargeEnabled ?? current.serviceChargeEnabled);
    const servicePercent = update.serviceChargePercent !== undefined ? update.serviceChargePercent : current.serviceChargePercent;
    if (serviceEnabled && (servicePercent === null || servicePercent === undefined)) throw new BadRequestException('Set a service charge percentage or disable service charge.');
    if (body.receiptFooter !== undefined) update.receiptFooter = this.cleanText(body.receiptFooter, 'Receipt footer', 500, true);
    const restaurant = await this.restaurantModel.findByIdAndUpdate(restaurantId, { $set: update }, { new: true, runValidators: true }).lean();
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    return this.serializeBillingSettings(restaurant);
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
