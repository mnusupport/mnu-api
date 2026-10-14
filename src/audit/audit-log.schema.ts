import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// Day 40 — audit trail for privileged (Super Admin) mutations.
// Deliberately stores NO request bodies, headers, tokens, passwords or
// customer data: only who did what, to which resource, where, and when.
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' })
export class AuditLog {
  @Prop({ type: Types.ObjectId, required: true })
  actorUserId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  actorEmail!: string;

  @Prop({ type: String, required: true })
  actorRole!: string;

  // e.g. "menu-items.update:availability", "tables.delete", "orders.update:status"
  @Prop({ type: String, required: true })
  action!: string;

  @Prop({ type: String, required: true })
  method!: string;

  // Route template (e.g. /restaurants/:restaurantId/tables/:tableId) — never the raw URL.
  @Prop({ type: String, required: true })
  route!: string;

  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  resourceType!: string;

  @Prop({ type: String, required: false })
  resourceId?: string;

  @Prop({ type: Number, required: true })
  statusCode!: number;

  createdAt!: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ restaurantId: 1, createdAt: -1 });
AuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
