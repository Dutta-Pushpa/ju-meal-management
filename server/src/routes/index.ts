import { Router } from 'express';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import { createAuthRouter } from './auth.routes.js';

/**
 * The API router. Everything versioned and authenticated is mounted here,
 * grouped by resource.
 *
 * `/health` is deliberately not mounted here. It sits at the root so that
 * orchestrators and load balancers can probe it without depending on the API
 * version.
 */
export function createApiRouter(deps: {
  db: Database;
  config: AppConfig;
  /** Open self-registration is allowed only outside production. */
  allowSelfRegistration: boolean;
}): Router {
  const router = Router();

  router.use('/auth', createAuthRouter(deps));

  return router;
}
