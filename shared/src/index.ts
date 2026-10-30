/**
 * Types and constants shared by the server and the future client.
 *
 * Anything that both sides must agree on belongs here: error codes, role and
 * status values, and the shape of the standard response envelope. If the client
 * and the server ever disagree about one of these, it is a bug in this file.
 */

export const ROLES = ['TEACHER', 'STAFF', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'CONFIRMED',
  'COLLECTED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ITEM_STATUSES = ['PENDING', 'COLLECTED', 'DELIVERED'] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export const LEDGER_ENTRY_TYPES = ['allocation', 'debit', 'refund', 'adjustment'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/**
 * Permissions are independent of role. A STAFF account can be granted collection
 * work without being able to allocate budgets or edit menus.
 */
export const PERMISSIONS = [
  'locations:manage',
  'menu_items:manage',
  'budgets:view',
  'budgets:allocate',
  'budgets:adjust',
  'orders:cancel',
  'orders:manage_status',
  'users:create',
  'users:manage',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Stable machine-readable error codes. Clients branch on `code`, never on the
 * human-readable `message`, which may be reworded at any time.
 *
 * Keep this in sync with the table in docs/api.md.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_ALREADY_EXISTS',
  'LOCATION_ALREADY_EXISTS',
  'LOCATION_HAS_ACTIVE_ORDERS',
  'DUPLICATE_ALLOCATION',
  'BUDGET_PERIOD_ALREADY_EXISTS',
  'ORDERING_DISABLED',
  'ORDERING_CLOSED',
  'ITEM_UNAVAILABLE',
  'MIXED_LOCATIONS',
  'BUDGET_INSUFFICIENT',
  'PRICE_CHANGED',
  'INVALID_STATUS_TRANSITION',
  'CUTOFF_PASSED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldIssue {
  field: string;
  issue: string;
  message?: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: FieldIssue[];
  data?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface ApiSuccessResponse<T> {
  data: T;
}

export interface PaginatedMeta {
  total: number;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

/** Money is always integer paisa. One taka is 100 paisa. */
export interface Money {
  /** Authoritative value. Use this for arithmetic. */
  amountPaisa: number;
  /** Display only, for example `৳150.00`. Never compute from this. */
  amountFormatted: string;
}
