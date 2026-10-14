import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

const MAX_OBJECT_DEPTH = 10;
const MAX_ARRAY_ITEMS = 200;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeValue(value: unknown, depth = 0): void {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new BadRequestException('Request payload is too deeply nested.');
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new BadRequestException('Request contains too many array items.');
    }
    for (const item of value) assertSafeValue(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key) || key.startsWith('$') || key.includes('.')) {
        throw new BadRequestException('Request contains an invalid field name.');
      }
      assertSafeValue(child, depth + 1);
    }
  }
}

@Injectable()
export class RequestSafetyPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type === 'body') {
      if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('A valid JSON request body is required.');
      }
      assertSafeValue(value);
    } else if (metadata.type === 'query' || metadata.type === 'param') {
      assertSafeValue(value);
    }

    // All route parameters ending in "Id" are Mongo ObjectIds in MnU.
    // Validate them before they reach Mongoose so malformed IDs become a
    // controlled 400 instead of a CastError/500.
    if (metadata.type === 'param' && metadata.data?.toLowerCase().endsWith('id') && typeof value === 'string') {
      if (!Types.ObjectId.isValid(value)) {
        throw new BadRequestException(`Invalid ${metadata.data}.`);
      }
    }

    return value;
  }
}
