import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request, Response } from 'express';
import { Model, Types } from 'mongoose';
import { Observable, tap } from 'rxjs';
import { PlatformRole } from '../common/enums/platform-role.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AUDITED_METHODS, deriveAudit } from './audit.util';
import { AuditLog, AuditLogDocument } from './audit-log.schema';

type AuditedRequest = Request & { userId?: string };

/**
 * Records an audit entry for every SUCCESSFUL restaurant-scoped mutation
 * performed by a Super Admin. Runs after the route guards, so `request.userId`
 * is only set for an authenticated staff/admin JWT. One interceptor instead of
 * touching every service keeps the business logic shared between Restaurant
 * Admin and Super Admin (no duplicated services).
 *
 * Restaurant Admin mutations are not recorded here: the requirement is an
 * audit trail of the high-privilege role. Never records bodies or headers.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<AuditedRequest>();
    if (!AUDITED_METHODS.has(request.method)) return next.handle();

    return next.handle().pipe(
      tap((body) => {
        // Fire-and-forget: an audit-store hiccup must never turn a completed
        // mutation into an error response, but it MUST be loud in the logs.
        void this.record(request, http.getResponse<Response>().statusCode, body).catch((error) =>
          this.logger.error(`AUDIT WRITE FAILED (${error instanceof Error ? error.name : 'unknown'})`),
        );
      }),
    );
  }

  private async record(request: AuditedRequest, statusCode: number, body: unknown) {
    const userId = request.userId;
    const rawRestaurantId = request.params?.restaurantId;
    const restaurantId = typeof rawRestaurantId === 'string' ? rawRestaurantId : undefined;
    if (!userId || !Types.ObjectId.isValid(userId) || !restaurantId || !Types.ObjectId.isValid(restaurantId)) return;

    const derived = deriveAudit(request.method, request.route?.path, request.params as Record<string, string>, body);
    if (!derived) return;

    const actor = await this.userModel.findById(userId).select({ email: 1, platformRole: 1 }).lean();
    if (!actor || actor.platformRole !== PlatformRole.SUPER_ADMIN) return;

    await this.auditModel.create({
      actorUserId: new Types.ObjectId(userId),
      actorEmail: actor.email,
      actorRole: PlatformRole.SUPER_ADMIN,
      action: derived.action,
      method: request.method,
      route: request.route.path,
      restaurantId: new Types.ObjectId(restaurantId),
      resourceType: derived.resourceType,
      resourceId: derived.resourceId,
      statusCode,
    });
  }
}
