import { BadRequestException } from '@nestjs/common';

export interface PaginationInput {
  page?: string;
  limit?: string;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(input: PaginationInput, defaultLimit = 50, maxLimit = 100): PaginationResult {
  const parse = (value: string | undefined, name: string, fallback: number) => {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value)) throw new BadRequestException(`${name} must be a positive integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new BadRequestException(`${name} must be a positive integer.`);
    return parsed;
  };

  const page = parse(input.page, 'Page', 1);
  const limit = parse(input.limit, 'Limit', defaultLimit);
  if (limit > maxLimit) throw new BadRequestException(`Limit must not exceed ${maxLimit}.`);
  return { page, limit, skip: (page - 1) * limit };
}
