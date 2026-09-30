import * as jwt from 'jsonwebtoken';

// Payload is deliberately just the user id — role and restaurant are
// contextual per request (a user can belong to multiple restaurants with
// different roles), so baking one into the token would misrepresent that.
export interface TokenPayload {
  user_id: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set in .env');
  }
  return secret;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, getSecret()) as TokenPayload;
}

// ---- Customer sessions --------------------------------------------------
// A customer session is only a convenience for repeat ordering/history; it
// is not phone verification. New sessions are restaurant-scoped so a token
// created for Restaurant A cannot be reused against Restaurant B.
export interface CustomerTokenPayload {
  customer_id: string;
  restaurant_id: string;
  type: 'customer';
}

export function signCustomerToken(customerId: string, restaurantId: string): string {
  const payload: CustomerTokenPayload = { customer_id: customerId, restaurant_id: restaurantId, type: 'customer' };
  return jwt.sign(payload, getSecret(), { expiresIn: '30d' });
}

export function verifyCustomerToken(token: string): CustomerTokenPayload {
  const decoded = jwt.verify(token, getSecret()) as Partial<CustomerTokenPayload>;
  if (decoded.type !== 'customer' || typeof decoded.customer_id !== 'string' || typeof decoded.restaurant_id !== 'string') {
    throw new Error('Not a customer token.');
  }
  return decoded as CustomerTokenPayload;
}
