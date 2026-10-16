import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from './config/env.js';
import type { Database } from './db/pool.js';
import { errorHandler } from './middleware/error-handler.js';
import { routeNotFound } from './middleware/not-found.js';
import { requestContext } from './middleware/request-context.js';
import { createApiRouter } from './routes/index.js';
import { healthHandler } from './routes/health.js';
import type { Logger } from './utils/logger.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  /**
   * `null` only in tests that deliberately exercise an unconfigured database.
   * Typed as Database rather than Queryable because serving any authenticated
   * endpoint needs connection pooling and shutdown.
   */
  db: Database | null;
}

/**
 * Build the Express application.
 *
 * Dependencies are injected rather than imported from singletons so a test can
 * construct a real app with a known configuration and a stub database, with no
 * module mocking and no mutation of global state.
 */
export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const app = express();

  // Behind a reverse proxy in production, so rate limiting and client IPs come
  // from X-Forwarded-For rather than from the proxy's own address.
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only and never renders HTML, so a restrictive
      // default-src is safe here. The CSP that matters for the React app is set
      // by whatever serves that app.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      // Configuration validation already splits and trims this list, so the
      // value arriving here is a clean array of origins.
      origin: config.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  // A small body limit is enough for this API. Anything larger is a mistake or
  // an attack, and rejecting early is cheaper than parsing it.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(requestContext(logger));

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MINUTES * 60_000,
      limit: config.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // /health is polled by orchestrators and must not consume the budget of
      // real users.
      skip: (req) => req.path === '/health',
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      },
    }),
  );

  // Health lives at the root, outside the versioned API, so that orchestrators
  // and load balancers can probe it without depending on the API version.
  app.get('/health', healthHandler({ ...deps, db: deps.db }));

  // Self-registration is a convenience for local development and for the Postman
  // collection. In production every account must be created by an administrator,
  // so an open endpoint would let anyone mint a TEACHER account.
  const allowSelfRegistration = config.NODE_ENV !== 'production';

  // Without a database there are no endpoints to serve. Health still answers and
  // reports the reason, and every other path falls through to the 404 handler.
  if (deps.db !== null) {
    app.use('/api', createApiRouter({ db: deps.db, config, allowSelfRegistration }));
  }

  app.use(routeNotFound());
  app.use(errorHandler(logger));

  return app;
}
