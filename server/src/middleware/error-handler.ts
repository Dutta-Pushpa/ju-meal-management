import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorResponse } from '@ju/shared';
import { isAppError } from '../utils/errors.js';
import { ValidationError } from '../utils/validation.js';
import type { Logger } from '../utils/logger.js';

/** PostgreSQL error codes we can translate into a meaningful response. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

/** Errors raised by the JSON body parser before any handler runs. */
interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  if (!(error instanceof Error)) {
    return false;
  }

  const { type } = error as BodyParserError;
  return typeof type === 'string' && type.startsWith('entity.');
}

function isPgError(error: unknown): error is PgError {
  return error instanceof Error && typeof (error as PgError).code === 'string';
}

/**
 * Translate a validation failure into the field-level detail list the API
 * contract specifies. The field and the issue code are forwarded; the internal
 * message is dropped so wording meant for developers never reaches a client.
 */
function fromValidationError(error: ValidationError): ApiErrorResponse {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The request failed validation.',
      details: error.issues.map((issue) => ({
        field: issue.field,
        issue: issue.issue,
      })),
    },
  };
}

/**
 * The single place an error becomes an HTTP response.
 *
 * Rules this enforces:
 *   - A recognised application error keeps its code, message, and status.
 *   - A validation or database error is translated into a safe client message.
 *   - Anything else is a bug: it is logged in full and reported as a generic
 *     INTERNAL_ERROR. Stack traces, SQL, and database text never reach a client.
 */
export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      // The response is already streaming. Express must destroy the socket;
      // there is no way to replace the body now.
      next(err);
      return;
    }

    const logContext = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
    };

    if (isAppError(err)) {
      if (err.status >= 500) {
        logger.error({ ...logContext, err }, 'request failed');
      } else {
        logger.warn({ ...logContext, code: err.code, status: err.status }, 'request rejected');
      }

      const body: ApiErrorResponse = {
        error: {
          code: err.code,
          message: err.expose ? err.message : 'An unexpected error occurred.',
          ...(err.details ? { details: err.details } : {}),
        },
      };
      res.status(err.status).json(body);
      return;
    }

    if (err instanceof ValidationError) {
      logger.warn({ ...logContext, issues: err.issues.length }, 'request failed validation');
      res.status(400).json(fromValidationError(err));
      return;
    }

    // A malformed or oversized body never reaches a controller, so it has to be
    // translated here. Without this it falls through as an unexpected error and
    // a client's typo returns 500 instead of 400.
    if (isBodyParserError(err)) {
      const tooLarge = err.type === 'entity.too.large';

      logger.warn({ ...logContext, type: err.type }, 'request body rejected by the parser');

      res.status(tooLarge ? 413 : 400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: tooLarge ? 'Request body is too large.' : 'Request body is not valid JSON.',
        },
      } satisfies ApiErrorResponse);
      return;
    }

    if (isPgError(err)) {
      const constraint = err.constraint ?? 'unknown';

      switch (err.code) {

case PG_UNIQUE_VIOLATION: {
  // A primary-key collision is a database/application problem,
  // not proof that the user entered a duplicate value.
  if (constraint.endsWith('_pkey')) {
    logger.error(
      { ...logContext, constraint },
      'Primary-key collision. Check the corresponding ID sequence.',
    );

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    } satisfies ApiErrorResponse);
    return;
  }

  // Handle the actual duplicate-email constraint specifically.
  if (constraint === 'users_email_unique') {
    logger.warn(
      { ...logContext, constraint },
      'Duplicate user email',
    );

    res.status(409).json({
      error: {
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with that email address already exists.',
      },
    } satisfies ApiErrorResponse);
    return;
  }

  // Handle the actual food-location name constraint specifically.
  if (constraint === 'food_locations_name_unique') {
    logger.warn(
      { ...logContext, constraint },
      'Duplicate food location name',
    );

    res.status(409).json({
      error: {
        code: 'LOCATION_ALREADY_EXISTS',
        message: 'A location with that name already exists.',
      },
    } satisfies ApiErrorResponse);
    return;
  }

  // Do not incorrectly label unrelated unique violations as email errors.
  logger.warn(
    { ...logContext, constraint },
    'Unique constraint violated',
  );

res.status(409).json({
  error: {
    code: 'DUPLICATE_VALUE',
    message: 'A record with these unique values already exists.',
  },
});

return;
}
        case PG_FOREIGN_KEY_VIOLATION: {
          logger.warn({ ...logContext, constraint }, 'foreign key violation');
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'A referenced record does not exist.',
            },
          } satisfies ApiErrorResponse);
          return;
        }
        case PG_CHECK_VIOLATION: {
          logger.warn({ ...logContext, constraint }, 'check constraint violated');
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'The value violates a database rule.',
            },
          } satisfies ApiErrorResponse);
          return;
        }
        default:
          break;
      }
    }

    logger.error({ ...logContext, err }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    } satisfies ApiErrorResponse);
  };
}
