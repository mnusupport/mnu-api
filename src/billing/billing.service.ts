import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthorizationService } from '../common/authorization.service';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { BillPaymentMethod, RestaurantBill, RestaurantBillDocument, RestaurantInvoiceCounter, RestaurantInvoiceCounterDocument } from './schemas/bill.schema';
import { calculateBillTotals, roundMoney, splitIntraStateTax } from './billing.calculations';

const validMethod = (method: unknown): method is BillPaymentMethod => ['CASH', 'UPI', 'CARD', 'OTHER'].includes(String(method));
const isDuplicateKey = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Compact bill state attached to order responses so the order board/detail can print and show payment without extra navigation. */
export interface BillSummary {
  id: string;
  invoiceNumber: string;
  invoiceKind: 'TAX_INVOICE' | 'RECEIPT';
  total: number;
  paymentStatus: 'UNPAID' | 'PAID';
  paymentMethod: BillPaymentMethod | null;
  voided: boolean;
}
export interface BillOnReadyResult { bill?: BillSummary; billError?: string }

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(RestaurantBill.name) private readonly billModel: Model<RestaurantBillDocument>,
    @InjectModel(RestaurantInvoiceCounter.name) private readonly counterModel: Model<RestaurantInvoiceCounterDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  // Any member of the restaurant (admin or counter/floor staff) may issue, reprint and record payment for a
  // bill. Staff are the people who hand the order over and take the money; restricting this to admins meant the
  // person who marks an order Ready could not print its bill. Every payment stores the recording user's id.
  private async authorize(restaurantId: string, userId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
  }

  toSummary(bill: { _id: unknown; invoiceNumber: string; invoiceKind: 'TAX_INVOICE' | 'RECEIPT'; total: number; paymentStatus: 'UNPAID' | 'PAID'; payment?: { method: BillPaymentMethod } | null; voidedAt?: Date | null }): BillSummary {
    return {
      id: String(bill._id), invoiceNumber: bill.invoiceNumber, invoiceKind: bill.invoiceKind, total: bill.total,
      paymentStatus: bill.paymentStatus, paymentMethod: bill.payment?.method ?? null, voided: Boolean(bill.voidedAt),
    };
  }

  /** Bill summaries for many orders in one query (restaurant-scoped). */
  async summariesForOrders(restaurantId: string, orderIds: Array<Types.ObjectId | string>): Promise<Map<string, BillSummary>> {
    const map = new Map<string, BillSummary>();
    if (!orderIds.length || !Types.ObjectId.isValid(restaurantId)) return map;
    const bills = await this.billModel
      .find({ restaurantId, orderId: { $in: orderIds } })
      .select({ orderId: 1, invoiceNumber: 1, invoiceKind: 1, total: 1, paymentStatus: 1, 'payment.method': 1, voidedAt: 1 })
      .lean();
    for (const bill of bills) map.set(String(bill.orderId), this.toSummary(bill));
    return map;
  }

  async getForOrder(restaurantId: string, orderId: string, userId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException('Order not found.');
    const bill = await this.billModel.findOne({ restaurantId, orderId }).lean();
    return bill ?? null;
  }

  async getBill(restaurantId: string, billId: string, userId: string) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    if (!Types.ObjectId.isValid(restaurantId) || !Types.ObjectId.isValid(billId)) throw new NotFoundException('Bill not found.');
    const bill = await this.billModel.findOne({ _id: billId, restaurantId }).lean();
    if (!bill) throw new NotFoundException('Bill not found.');
    return bill;
  }

  /** Explicit "generate / retry" request. Idempotent: an order only ever has one bill. */
  async generate(restaurantId: string, orderId: string, userId: string) {
    await this.authorize(restaurantId, userId);
    return this.issueBill(restaurantId, orderId, userId);
  }

  /**
   * Called by the order workflow when an order becomes READY (caller has already authorised the user for this
   * restaurant). Must never make the status change fail: if the bill cannot be produced (for example billing
   * settings are incomplete) the kitchen flow continues and the reason is returned for the UI to show.
   */
  async ensureBillOnReady(restaurantId: string, orderId: string, userId: string): Promise<BillOnReadyResult> {
    try {
      const bill = await this.issueBill(restaurantId, orderId, userId);
      return { bill: this.toSummary(bill) };
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const message = typeof response === 'string' ? response : (response as { message?: string | string[] }).message;
        return { billError: Array.isArray(message) ? message.join(' ') : message ?? 'The bill could not be generated.' };
      }
      this.logger.error(`Automatic bill generation failed for order ${orderId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      return { billError: 'The bill could not be generated automatically. Use "Generate bill" to retry.' };
    }
  }

  /** Orders cannot be cancelled once a payment has been recorded (there is no refund / credit-note flow yet). */
  async assertOrderCancellable(restaurantId: string, orderId: string) {
    const paid = await this.billModel.exists({ restaurantId, orderId, paymentStatus: 'PAID' });
    if (paid) throw new ConflictException('A payment has already been recorded for this order, so it cannot be cancelled. Refunds and credit notes are not supported yet.');
  }

  /** Voids (never deletes) the unpaid bill of a cancelled order; the invoice number stays in the sequence. */
  async voidForCancelledOrder(restaurantId: string, orderId: string, userId: string): Promise<{ voided: boolean; paidBillExists: boolean }> {
    const result = await this.billModel.updateOne(
      { restaurantId, orderId, paymentStatus: 'UNPAID', voidedAt: null },
      { $set: { voidedAt: new Date(), voidReason: 'ORDER_CANCELLED', voidedBy: new Types.ObjectId(userId) } },
    );
    if (result.modifiedCount > 0) return { voided: true, paidBillExists: false };
    const paidBillExists = Boolean(await this.billModel.exists({ restaurantId, orderId, paymentStatus: 'PAID' }));
    if (paidBillExists) this.logger.warn(`Order ${orderId} was cancelled while its bill was being paid; a PAID bill exists on a cancelled order and needs manual review.`);
    return { voided: false, paidBillExists };
  }

  private async nextSequence(restaurantId: Types.ObjectId): Promise<number> {
    const [counter, last] = await Promise.all([
      this.counterModel.findOne({ restaurantId }).lean(),
      this.billModel.findOne({ restaurantId, invoiceSequence: { $gt: 0 } }).sort({ invoiceSequence: -1 }).select({ invoiceSequence: 1 }).lean(),
    ]);
    return Math.max(counter?.sequence ?? 0, last?.invoiceSequence ?? 0) + 1;
  }

  private async issueBill(restaurantId: string, orderId: string, userId: string) {
    if (!Types.ObjectId.isValid(restaurantId) || !Types.ObjectId.isValid(orderId) || !Types.ObjectId.isValid(userId)) throw new NotFoundException('Order not found.');
    const existing = await this.billModel.findOne({ restaurantId, orderId }).lean();
    if (existing) return existing;
    const [restaurant, order] = await Promise.all([
      this.restaurantModel.findById(restaurantId).lean(),
      this.orderModel.findOne({ _id: orderId, restaurantId }).lean(),
    ]);
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === OrderStatus.CANCELLED) throw new BadRequestException('A cancelled order cannot be billed.');
    if (order.status !== OrderStatus.READY && order.status !== OrderStatus.COMPLETED) {
      throw new ConflictException('A bill is generated when the order is marked Ready.');
    }

    const gstRegistered = restaurant.gstRegistrationStatus === 'REGISTERED';
    const configuredTax = restaurant.taxConfigurationMode === 'GST_CONFIGURED';
    if (configuredTax && (!gstRegistered || !restaurant.gstin || !restaurant.registeredBusinessName?.trim() || typeof restaurant.defaultTaxPercent !== 'number' || restaurant.defaultTaxPercent <= 0)) {
      throw new BadRequestException('Billing settings are incomplete: verify GST registration, registered business name, GSTIN, and a positive configured tax percentage before issuing a tax invoice.');
    }
    if (configuredTax && (!restaurant.addressLine?.trim() || !restaurant.city?.trim() || !restaurant.state?.trim() || !restaurant.pinCode?.trim())) {
      throw new BadRequestException('Restaurant address is incomplete. Complete the address in Restaurant Profile before issuing a tax invoice.');
    }
    if (gstRegistered && !restaurant.gstin) throw new BadRequestException('The restaurant is marked GST-registered but GSTIN is missing. Complete Restaurant Profile before billing.');
    if (!restaurant.name?.trim()) throw new BadRequestException('Restaurant display name is missing. Complete Restaurant Profile before billing.');

    const subtotal = roundMoney(order.items.reduce((sum, item) => sum + roundMoney(item.price * item.quantity), 0));
    if (Math.abs(subtotal - roundMoney(order.subtotal)) > 0.01) {
      this.logger.warn(`Order ${orderId}: stored subtotal ${order.subtotal} differs from its line items (${subtotal}); the bill uses the line items.`);
    }
    let totals: ReturnType<typeof calculateBillTotals>;
    try {
      totals = calculateBillTotals({
        subtotal, taxConfigured: configuredTax,
        taxRatePercent: configuredTax ? Number(restaurant.defaultTaxPercent) : 0,
        taxMode: restaurant.pricingTaxMode ?? 'EXCLUSIVE',
        serviceChargeEnabled: Boolean(restaurant.serviceChargeEnabled),
        serviceChargePercent: restaurant.serviceChargePercent,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Billing settings contain invalid calculation values.');
    }
    const { discountAmount, serviceChargeAmount, taxableAmount, taxRatePercent, taxAmount, total } = totals;

    const prefix = (restaurant.invoicePrefix || 'INV-').trim();
    const invoiceKind = configuredTax ? 'TAX_INVOICE' : 'RECEIPT';
    const restaurantSnapshot = {
      displayName: restaurant.name,
      legalBusinessName: restaurant.legalBusinessName ?? null,
      logoUrl: restaurant.logoUrl ?? null,
      contactPhone: restaurant.contactPhone ?? null,
      contactEmail: restaurant.contactEmail ?? null,
      addressLine: restaurant.addressLine ?? null,
      city: restaurant.city ?? null,
      state: restaurant.state ?? null,
      pinCode: restaurant.pinCode ?? null,
      country: restaurant.country ?? 'India',
      gstRegistrationStatus: restaurant.gstRegistrationStatus ?? 'NOT_REGISTERED',
      gstin: restaurant.gstin ?? null,
      registeredBusinessName: restaurant.registeredBusinessName ?? null,
      gstState: restaurant.gstState ?? null,
      receiptFooter: restaurant.receiptFooter ?? null,
    };
    const orderSnapshot = {
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableNumber: order.tableNumber ?? null,
      customerName: order.customerName ?? null,
      groupCode: order.groupCode ?? null,
      createdAt: order.createdAt,
    };
    const items = order.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: roundMoney(item.price), lineTotal: roundMoney(item.price * item.quantity) }));
    const taxBreakdown = configuredTax && taxAmount > 0
      ? { configuredRatePercent: taxRatePercent, mode: restaurant.pricingTaxMode, amount: taxAmount, ...splitIntraStateTax(taxAmount, taxRatePercent) }
      : {};
    const issuedAt = new Date();

    // The invoice number is chosen as (highest saved number + 1) and used in the INSERT itself. The unique
    // (restaurant, order) and (restaurant, invoiceNumber) indexes arbitrate races: the loser either finds the
    // winner's bill for this order and returns it, or retries with the next free number. A number is therefore
    // only consumed by a bill that was really saved — retries and concurrent requests cannot skip numbers.
    for (let attempt = 0; attempt < 12; attempt++) {
      const sequence = await this.nextSequence(new Types.ObjectId(restaurantId));
      const invoiceNumber = `${prefix}${String(sequence).padStart(6, '0')}`;
      try {
        const created = await this.billModel.create({
          restaurantId, orderId, orderNumber: order.orderNumber, invoiceNumber, invoiceSequence: sequence, issuedAt, invoiceKind,
          restaurantSnapshot, orderSnapshot, items, subtotal: totals.subtotal, discountAmount, serviceChargeAmount,
          taxableAmount, taxRatePercent, taxAmount, taxBreakdown, total,
          paymentStatus: 'UNPAID', payment: null, generatedBy: new Types.ObjectId(userId), currency: restaurant.billingCurrency || 'INR',
        });
        // Keep the legacy counter in step (monotonic $max, so ordering of concurrent writers does not matter).
        await this.counterModel.updateOne({ restaurantId: new Types.ObjectId(restaurantId) }, { $max: { sequence } }, { upsert: true }).catch((error) => {
          if (!isDuplicateKey(error)) this.logger.warn(`Invoice counter update failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        });
        // Close the race with cancellation: the cancel flow sets the order CANCELLED *then* voids its bill. If we
        // inserted after that void ran, nobody would void this bill — so re-check the order now and void it ourselves.
        const fresh = await this.orderModel.findOne({ _id: orderId, restaurantId }).select({ status: 1 }).lean();
        if (fresh?.status === OrderStatus.CANCELLED) {
          await this.billModel.updateOne(
            { _id: created._id, paymentStatus: 'UNPAID', voidedAt: null },
            { $set: { voidedAt: new Date(), voidReason: 'ORDER_CANCELLED', voidedBy: new Types.ObjectId(userId) } },
          );
          return (await this.billModel.findById(created._id).lean()) ?? created.toObject();
        }
        return created.toObject();
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const winner = await this.billModel.findOne({ restaurantId, orderId }).lean();
        if (winner) return winner;
        await sleep(5 + Math.floor(Math.random() * 20));
      }
    }
    throw new ConflictException('Could not allocate an invoice number. Please retry; no duplicate bill was created.');
  }

  async recordPayment(restaurantId: string, billId: string, userId: string, methodRaw: unknown) {
    await this.authorize(restaurantId, userId);
    if (!Types.ObjectId.isValid(billId) || !Types.ObjectId.isValid(restaurantId) || !Types.ObjectId.isValid(userId)) throw new NotFoundException('Bill not found.');
    if (!validMethod(methodRaw)) throw new BadRequestException('Select Cash, UPI, Card, or Other.');
    const method: BillPaymentMethod = methodRaw;
    const current = await this.billModel.findOne({ _id: billId, restaurantId }).lean();
    if (!current) throw new NotFoundException('Bill not found.');
    // A retry of the same confirmation (double tap, refresh, flaky network) is success, not an error.
    const alreadyPaid = (bill: { paymentStatus: string; payment?: { method: string } | null }) => {
      if (bill.paymentStatus !== 'PAID') return null;
      if (bill.payment?.method === method) return true;
      throw new ConflictException(`This bill has already been paid by ${bill.payment?.method ?? 'another method'}.`);
    };
    if (alreadyPaid(current)) return current;
    if (current.voidedAt) throw new ConflictException('This bill is void because its order was cancelled. Payment cannot be recorded.');
    const order = await this.orderModel.findOne({ _id: current.orderId, restaurantId }).select({ status: 1 }).lean();
    if (!order || order.status === OrderStatus.CANCELLED) throw new ConflictException('This order was cancelled. Payment cannot be recorded.');

    const bill = await this.billModel.findOneAndUpdate(
      { _id: billId, restaurantId, paymentStatus: 'UNPAID', payment: null, voidedAt: null },
      { $set: { paymentStatus: 'PAID', payment: { method, amount: current.total, recordedAt: new Date(), recordedBy: new Types.ObjectId(userId) } } },
      { new: true, runValidators: true },
    );
    if (bill) return bill.toObject();
    const latest = await this.billModel.findOne({ _id: billId, restaurantId }).lean();
    if (!latest) throw new NotFoundException('Bill not found.');
    if (alreadyPaid(latest)) return latest;
    throw new ConflictException('Payment could not be recorded. Refresh the bill and try again.');
  }

  async list(restaurantId: string, userId: string, query: { search?: string; status?: string; method?: string; from?: string; to?: string; page?: string; limit?: string }) {
    await this.authorization.requireRestaurantAccess(restaurantId, userId);
    if (!Types.ObjectId.isValid(restaurantId)) throw new NotFoundException('Restaurant not found.');
    const page = Math.max(1, Math.min(100000, Number.parseInt(query.page ?? '1', 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit ?? '20', 10) || 20));
    const filter: Record<string, unknown> = { restaurantId };
    if (query.status === 'PAID') filter.paymentStatus = 'PAID';
    else if (query.status === 'UNPAID') { filter.paymentStatus = 'UNPAID'; filter.voidedAt = null; }
    else if (query.status === 'VOID') filter.voidedAt = { $ne: null };
    if (query.method && ['CASH', 'UPI', 'CARD', 'OTHER'].includes(query.method)) filter['payment.method'] = query.method;
    const date: Record<string, Date> = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) date.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) {
      const end = new Date(query.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) end.setHours(23, 59, 59, 999);
      date.$lte = end;
    }
    if (Object.keys(date).length) filter.issuedAt = date;
    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ invoiceNumber: { $regex: escaped, $options: 'i' } }, { orderNumber: { $regex: escaped, $options: 'i' } }];
    }
    const [items, total] = await Promise.all([
      this.billModel.find(filter).sort({ issuedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.billModel.countDocuments(filter),
    ]);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }
}
