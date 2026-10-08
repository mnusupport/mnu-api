// Canonical customer phone/name rules for restaurant-scoped customer recognition.
//
// The phone logic below is the SAME canonicalization the project used before
// customer authentication was removed (Part 1.2 / 1.3): Indian numbers resolve
// to `+91XXXXXXXXXX`, other country codes are never rewritten, and legacy
// stored representations are matched through `legacyMobileCandidates`.
// It is intentionally the only phone-normalization implementation in the API.
//
// This file has no framework imports so it stays trivially testable.

const MOBILE_PATTERN = /^\+?[0-9]{7,15}$/;
const INDIAN_MOBILE_PATTERN = /^[0-9]{10}$/;
const CUSTOMER_NAME_MIN_LENGTH = 2;
const CUSTOMER_NAME_MAX_LENGTH = 80;
// Same rule as Order.customerName (Part 1.6) and the Customer schema validator.
const CUSTOMER_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

/** A user-input problem with a message that is safe to show to the customer. */
export class ContactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactValidationError';
  }
}

export function normalizeMobile(value: string): string {
  // `919876543210`, `+919876543210` and `9876543210` must resolve to the same
  // restaurant-scoped customer.
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (INDIAN_MOBILE_PATTERN.test(compact)) return `+91${compact}`;
  if (/^91[0-9]{10}$/.test(compact)) return `+${compact}`;
  return compact;
}

export function validateMobile(rawPhone: unknown): string {
  const compact = (typeof rawPhone === 'string' ? rawPhone : '').trim().replace(/[\s().-]/g, '');
  if (!MOBILE_PATTERN.test(compact)) {
    throw new ContactValidationError('Please enter a valid phone number.');
  }
  return normalizeMobile(compact);
}

export function validateCustomerName(rawName: unknown): string {
  const name = (typeof rawName === 'string' ? rawName : '').trim().replace(/\s+/g, ' ');
  if (
    name.length < CUSTOMER_NAME_MIN_LENGTH ||
    name.length > CUSTOMER_NAME_MAX_LENGTH ||
    !CUSTOMER_NAME_PATTERN.test(name)
  ) {
    throw new ContactValidationError(
      `Please enter a valid name (${CUSTOMER_NAME_MIN_LENGTH}-${CUSTOMER_NAME_MAX_LENGTH} characters).`,
    );
  }
  return name;
}

// Resolve records written before Indian numbers were stored canonically.
// Every lookup that uses this is additionally scoped by restaurantId.
export function legacyMobileCandidates(normalized: string): string[] {
  if (/^\+91[0-9]{10}$/.test(normalized)) {
    const national = normalized.slice(3);
    const countryAndNational = normalized.slice(1);
    return [...new Set([normalized, national, countryAndNational])];
  }
  return [normalized];
}

// `+919876543210` -> `98XXXXXX10`. Used for everything shown to the browser and
// for diagnostics; the raw number never leaves the server after lookup.
export function maskMobile(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  const national = /^91[0-9]{10}$/.test(digits) ? digits.slice(2) : digits;
  if (national.length <= 4) return 'X'.repeat(national.length);
  return `${national.slice(0, 2)}${'X'.repeat(national.length - 4)}${national.slice(-2)}`;
}
