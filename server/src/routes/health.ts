import type { Request, Response } from 'express';
import type { ApiSuccessResponse } from '@ju/shared';
import type { AppConfig } from '../config/env.js';
import type { Queryable } from '../db/pool.js';

/**
 * Liveness and readiness in one endpoint.
 *
 * Returns 200 when the API can serve traffic and the database is reachable, and
 * 503 when it cannot, so a load balancer or container orchestrator can act on
 * the status code without parsing the body.
 *
 * Nothing sensitive is exposed: no connection string, no credentials, no
 * database error text. When the database is down the reason is reported as a
 * fixed string and the real error goes to the log.
 */
export function healthHandler(deps: { db: Queryable | null; config: AppConfig }) {
  return async (_req: Request, res: Response): Promise<void> => {
    const startedAt = process.hrtime.bigint();

    let database: 'up' | 'down';
    let databaseError: string | undefined;

    if (deps.db === null) {
      database = 'down';
      databaseError = 'Database pool is not configured.';
    } else {
      try {
        await deps.db.query('SELECT 1');
        database = 'up';
      } catch {
        database = 'down';
        databaseError = 'Database is not reachable.';
      }
    }

    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const healthy = database === 'up';

    const body: ApiSuccessResponse<{
      status: 'ok' | 'degraded';
      environment: string;
      database: 'up' | 'down';
      databaseLatencyMs: number;
      databaseError?: string;
      uptimeSeconds: number;
      timestamp: string;
    }> = {
      data: {
        status: healthy ? 'ok' : 'degraded',
        environment: deps.config.NODE_ENV,
        database,
        databaseLatencyMs: Math.round(latencyMs * 100) / 100,
        ...(databaseError !== undefined ? { databaseError } : {}),
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    };

    res.status(healthy ? 200 : 503).json(body);
  };
}
