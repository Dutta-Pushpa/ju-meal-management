import { Router } from 'express';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import { createAuthRouter } from './auth.routes.js';
import { createLocationRouter } from './location.routes.js';
import { createMenuAdminRouter } from './menu-admin.routes.js';
import { createBudgetAdminRouter } from './budget-admin.routes.js';
import { createTeacherBudgetRouter } from './teacher-budget.routes.js';
import { createOrderRouter } from './order.routes.js';
import { createStaffOrderRouter } from './staff-order.routes.js';
import { createStaffReportRouter } from './staff-report.routes.js';
import { createSettingsRouter } from './settings.routes.js';
import { createUserAdminRouter } from './user-admin.routes.js';

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
  router.use(
    '/locations',
    createLocationRouter({
      db: deps.db,
      jwtSecret: deps.config.JWT_SECRET,
      timezone: deps.config.APP_TIMEZONE,
    }),
  );
  router.use(
    '/staff/menu-items',
    createMenuAdminRouter({ db: deps.db, jwtSecret: deps.config.JWT_SECRET }),
  );
  router.use(
    '/staff',
    createBudgetAdminRouter({ db: deps.db, jwtSecret: deps.config.JWT_SECRET }),
  );
  router.use(
    '/staff',
    createStaffOrderRouter({ db: deps.db, config: deps.config }),
  );
  router.use(
    '/staff',
    createStaffReportRouter({ db: deps.db, jwtSecret: deps.config.JWT_SECRET }),
  );
  router.use('/staff', createSettingsRouter({ db: deps.db, jwtSecret: deps.config.JWT_SECRET }));
  router.use('/staff', createUserAdminRouter({ db: deps.db, jwtSecret: deps.config.JWT_SECRET }));
  router.use(
    '/teacher',
    createTeacherBudgetRouter({ db: deps.db, jwtSecret: deps.config.JWT_SECRET }),
  );
  router.use('/orders', createOrderRouter({ db: deps.db, config: deps.config }));

  return router;
}
