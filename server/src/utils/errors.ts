import type { ErrorCode, FieldIssue } from '@ju/shared';

/**
 * The only error type that reaches the client on purpose.
 *
 * Anything thrown that is not an `AppError` is treated as a bug and reported as
 * a generic INTERNAL_ERROR, with the real details written to the log instead of
 * the response.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: FieldIssue[] | undefined;
  readonly data: Record<string, unknown> | undefined;
  /** Set when the error is caused by a fault on our side rather than the request. */
  readonly expose: boolean;

  constructor(options: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: FieldIssue[];
    data?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.data = options.data;
    this.expose = options.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: FieldIssue[]) =>
  new AppError({ code: 'VALIDATION_ERROR', message, status: 400, ...(details ? { details } : {}) });

export const unauthorized = (message = 'Authentication required.') =>
  new AppError({ code: 'UNAUTHORIZED', message, status: 401 });

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError({ code: 'FORBIDDEN', message, status: 403 });

export const notFound = (message = 'Resource not found.') =>
  new AppError({ code: 'NOT_FOUND', message, status: 404 });

export const conflict = (code: ErrorCode, message: string, data?: Record<string, unknown>) =>
  new AppError({ code, message, status: 409, ...(data ? { data } : {}) });

export const unprocessable = (code: ErrorCode, message: string) =>
  new AppError({ code, message, status: 422 });

export const internal = (message = 'An unexpected error occurred.', cause?: unknown) =>
  new AppError({ code: 'INTERNAL_ERROR', message, status: 500, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
