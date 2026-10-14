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

// Admin sessions are intentionally persistent across normal browser returns.
// The token is still server-validated on every protected request and expires
// after 30 days; logout removes it from the browser.
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, getSecret()) as TokenPayload;
}
