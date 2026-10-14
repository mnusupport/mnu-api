// Pure helpers (no Nest/Mongoose imports) so they can be unit-tested directly.

export const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PREFIX = '/restaurants/:restaurantId/';
const ID_PARAMS = ['itemId', 'categoryId', 'tableId', 'orderId', 'customerId', 'memberId', 'userId'];

const VERBS: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

export interface DerivedAudit {
  resourceType: string;
  action: string;
  resourceId?: string;
}

/**
 * Derives a readable action from a route TEMPLATE, e.g.
 *   PATCH /restaurants/:restaurantId/menu-items/:itemId/availability
 *     -> { resourceType: 'menu-items', action: 'menu-items.update:availability', resourceId: <itemId> }
 * Returns null for routes that are not restaurant-scoped.
 */
export function deriveAudit(
  method: string,
  routePath: string | undefined,
  params: Record<string, string | undefined>,
  responseBody?: unknown,
): DerivedAudit | null {
  if (!routePath) return null;
  const idx = routePath.indexOf(PREFIX);
  if (idx === -1) return null;
  const rest = routePath.slice(idx + PREFIX.length).split('/').filter(Boolean);
  if (rest.length === 0) return null;

  const resourceType = rest[0];
  const trailing = rest.slice(1).filter((segment) => !segment.startsWith(':'));
  const verb = VERBS[method.toUpperCase()] ?? method.toLowerCase();
  const action = `${resourceType}.${verb}${trailing.length ? `:${trailing.join('/')}` : ''}`;

  let resourceId: string | undefined;
  for (const key of ID_PARAMS) {
    if (typeof params[key] === 'string') resourceId = params[key];
  }
  if (!resourceId && responseBody && typeof responseBody === 'object') {
    const id = (responseBody as { id?: unknown }).id;
    if (typeof id === 'string') resourceId = id;
  }
  return { resourceType, action, resourceId };
}
