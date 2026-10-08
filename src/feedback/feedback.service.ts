import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { PaginationResult } from '../common/pagination';
import {
  Feedback,
  FeedbackDecisionHelp,
  FeedbackDocument,
  FeedbackFindingEase,
} from './feedback.schema';
import { AuthorizationService } from '../common/authorization.service';

const FINDING_EASE_VALUES = Object.values(FeedbackFindingEase);
const DECISION_HELP_VALUES = Object.values(FeedbackDecisionHelp);

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name) private readonly feedbackModel: Model<FeedbackDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  private assertValidId(id: string, label: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`Invalid ${label}.`);
  }

  private optionalText(raw: unknown, label: string): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string') throw new BadRequestException(`${label} must be text.`);
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) return null;
    if (value.length > 600) throw new BadRequestException(`${label} must not exceed 600 characters.`);
    return value;
  }

  async submitPublicFeedback(
    restaurantId: string,
    input: {
      orderId: string;
      rating: number;
      findingEase?: string;
      decisionHelp?: string;
      friction?: string;
      improvement?: string;
    },
  ) {
    this.assertValidId(restaurantId, 'restaurant id');
    if (!input || typeof input.orderId !== 'string' || !Types.ObjectId.isValid(input.orderId)) {
      throw new BadRequestException('A valid order is required.');
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new BadRequestException('Please choose a rating from 1 to 5.');
    }

    const findingEase = input.findingEase === undefined || input.findingEase === null || input.findingEase === ''
      ? null
      : input.findingEase;
    if (findingEase !== null && !FINDING_EASE_VALUES.includes(findingEase as FeedbackFindingEase)) {
      throw new BadRequestException('Invalid answer for finding menu items.');
    }

    const decisionHelp = input.decisionHelp === undefined || input.decisionHelp === null || input.decisionHelp === ''
      ? null
      : input.decisionHelp;
    if (decisionHelp !== null && !DECISION_HELP_VALUES.includes(decisionHelp as FeedbackDecisionHelp)) {
      throw new BadRequestException('Invalid answer for menu decision help.');
    }

    const friction = this.optionalText(input.friction, 'The confusing/frustrating answer');
    const improvement = this.optionalText(input.improvement, 'The improvement answer');

    const [order, restaurant] = await Promise.all([
      this.orderModel.findOne({ _id: input.orderId, restaurantId }).lean(),
      this.restaurantModel.findById(restaurantId).lean(),
    ]);
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    if (!order) throw new NotFoundException('Order not found for this restaurant.');

    const existing = await this.feedbackModel.findOne({ orderId: order._id }).lean();
    if (existing) throw new ConflictException('Feedback has already been submitted for this order.');

    try {
      const feedback = await this.feedbackModel.create({
        restaurantId: order.restaurantId,
        restaurantName: restaurant.name,
        orderId: order._id,
        orderNumber: order.orderNumber,
        rating: input.rating,
        findingEase: findingEase as FeedbackFindingEase | null,
        decisionHelp: decisionHelp as FeedbackDecisionHelp | null,
        friction,
        improvement,
      });

      return { id: feedback._id.toString(), submittedAt: feedback.createdAt };
    } catch (error) {
      // Unique index closes the race where two taps land at the same time.
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException('Feedback has already been submitted for this order.');
      }
      throw error;
    }
  }

  async listForSuperAdmin(
    userId: string,
    pagination: PaginationResult,
    restaurantId?: string,
    rating?: string,
  ) {
    await this.authorization.requireSuperAdmin(userId);

    const filter: Record<string, unknown> = {};
    if (restaurantId !== undefined) {
      this.assertValidId(restaurantId, 'restaurant id');
      filter.restaurantId = new Types.ObjectId(restaurantId);
    }
    let ratingNumber: number | undefined;
    if (rating !== undefined && rating !== '') {
      if (!/^\d+$/.test(rating)) throw new BadRequestException('Rating must be a number from 1 to 5.');
      ratingNumber = Number(rating);
      if (!Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
        throw new BadRequestException('Rating must be a number from 1 to 5.');
      }
      filter.rating = ratingNumber;
    }

    const [rows, total, summaryRows] = await Promise.all([
      this.feedbackModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
      this.feedbackModel.countDocuments(filter),
      this.feedbackModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            averageRating: { $avg: '$rating' },
            fiveStar: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
            fourStar: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            threeStar: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            twoStar: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            oneStar: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const summary = summaryRows[0] ?? {
      total: 0,
      averageRating: 0,
      fiveStar: 0,
      fourStar: 0,
      threeStar: 0,
      twoStar: 0,
      oneStar: 0,
    };

    return {
      items: rows.map((row) => ({
        id: row._id.toString(),
        restaurantId: row.restaurantId.toString(),
        restaurantName: row.restaurantName,
        orderId: row.orderId.toString(),
        orderNumber: row.orderNumber,
        rating: row.rating,
        findingEase: row.findingEase ?? null,
        decisionHelp: row.decisionHelp ?? null,
        friction: row.friction ?? null,
        improvement: row.improvement ?? null,
        createdAt: row.createdAt,
      })),
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      summary: {
        total: summary.total,
        averageRating: Number(Number(summary.averageRating ?? 0).toFixed(2)),
        distribution: {
          5: summary.fiveStar ?? 0,
          4: summary.fourStar ?? 0,
          3: summary.threeStar ?? 0,
          2: summary.twoStar ?? 0,
          1: summary.oneStar ?? 0,
        },
      },
    };
  }
}
