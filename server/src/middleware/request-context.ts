import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../utils/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request, echoed in the response and the logs. */
      requestId: string;
    }
  }
}

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attach a correlation id to every request.
 *
 * A client-supplied id is reused when present, so a trace started by a gateway
 * or a test stays intact. Anything received is length-limited first, since it is
 * untrusted input and is echoed back into a response header and the log.
 */
export function requestContext(logger: Logger) {
  const headerLimit = 128;

  return (req: Request, res: Response, next: NextFunction): void => {
    const supplied = req.header(REQUEST_ID_HEADER);
    const requestId =
      typeof supplied === 'string' && supplied.length > 0 && supplied.length <= headerLimit
        ? supplied
        : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const log = res.statusCode >= 500 ? logger.error.bind(logger) : logger.info.bind(logger);

      log(
        {
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        'request completed',
      );
    });

    next();
  };
}
