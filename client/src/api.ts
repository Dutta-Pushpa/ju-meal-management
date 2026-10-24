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
    throw new ApiError('Could not connect to the API. Make sure the backend is running on port 4000.', 0, 'NETWORK_ERROR');
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T; error?: { message?: string; code?: string; details?: ApiError['details'] };
  };
  if (!response.ok) {
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

export function hasPermission(role: string, permissions: string[], permission: string): boolean {
  return role === 'ADMIN' || (role === 'STAFF' && permissions.includes(permission));
}
