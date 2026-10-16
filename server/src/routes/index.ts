import { Router } from 'express';

/**
 * The API router. Everything versioned and authenticated is mounted here,
 * grouped by resource as endpoints are added in later phases.
 *
 * `/health` is deliberately not mounted here. It sits at the root so that
 * orchestrators and load balancers can probe it without depending on the API
 * version.
 */
export function createApiRouter(): Router {
  const router = Router();

  return router;
}
