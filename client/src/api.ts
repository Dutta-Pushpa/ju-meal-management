const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Array<{ field: string; issue: string; message?: string }>;
  constructor(message: string, status: number, code = 'API_ERROR', details?: ApiError['details']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; token?: string | null };

/** Invoked whenever the API answers 401 so the app can drop the dead session. */
let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  onUnauthorized = handler;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, body, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      ...rest,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      'Could not connect to the API. Make sure the backend is running on port 4000.',
      0,
      'NETWORK_ERROR',
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; code?: string; details?: ApiError['details'] };
  };
  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(
      payload.error?.message || `Request failed (${response.status}).`,
      response.status,
      payload.error?.code,
      payload.error?.details,
    );
  }
  return payload.data as T;
}

export function asMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function todayInDhaka(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values['year']}-${values['month']}-${values['day']}`;
}

export function money(amountPaisa: number): string {
  return `৳${(amountPaisa / 100).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Current Dhaka business month as 'YYYY-MM' (used by month inputs). */
export function currentDhakaMonth(): string {
  return todayInDhaka().slice(0, 7);
}

/**
 * Role-only access control. Configurable per-user permissions were removed:
 * what an account may do is decided entirely by its role.
 *
 *   ADMIN  — everything, including user management and policy settings.
 *   STAFF  — day-to-day operations: locations, menus, orders and budgets.
 *   TEACHER — their own meals and budget only.
 */
const STAFF_CAPABILITIES: string[] = [
  'locations:manage',
  'menu_items:manage',
  'budgets:view',
  'budgets:allocate',
  'budgets:adjust',
  'orders:cancel',
  'orders:manage_status',
];

export function hasPermission(role: string, _permissions: string[], permission: string): boolean {
  if (role === 'ADMIN') return true;
  if (role === 'STAFF') return STAFF_CAPABILITIES.includes(permission);
  return false;
}
