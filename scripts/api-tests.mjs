// Runs the Postman collection against a running API with Newman.
//
// A script rather than a raw `newman run` line in package.json because the
// credentials have to come from the environment without depending on shell
// quoting: `$VAR` on bash and `%VAR%` on Windows do not mix in an npm script.
// Everything Newman needs is passed here as an option instead.
//
// Usage:
//   npm run test:api
//
// The API must already be running and its database migrated and seeded; the CI
// job does that before calling this. See docs/development.md.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import newman from 'newman';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COLLECTION = path.join(root, 'postman', 'JU-Meal-Management.postman_collection.json');
const ENVIRONMENT = path.join(root, 'postman', 'JU-Meal.local.postman_environment.json');
const REPORT_DIR = path.join(root, 'newman-report');
const REPORT_FILE = path.join(REPORT_DIR, 'report.json');

/**
 * Environment values for the run.
 *
 * Passwords default to the documented demo accounts that `db/seed.ts` creates.
 * They are development credentials, already present in the repository, so
 * defaulting to them keeps a local run to a single command. A deployment or CI
 * can override any of them without editing this file, and nothing here is a
 * real secret.
 */
const config = {
  baseUrl: process.env['API_BASE_URL'] ?? 'http://localhost:4000',

  adminEmail: process.env['ADMIN_EMAIL'] ?? 'admin@example.edu',
  adminPassword: process.env['ADMIN_PASSWORD'] ?? 'AdminPass123!',

  staffEmail: process.env['STAFF_EMAIL'] ?? 'staff@example.edu',
  staffPassword: process.env['STAFF_PASSWORD'] ?? 'StaffPass123!',

  teacherEmail: process.env['TEACHER_EMAIL'] ?? 'teacher@example.edu',
  teacherPassword: process.env['TEACHER_PASSWORD'] ?? 'TeacherPass123!',
};

mkdirSync(REPORT_DIR, { recursive: true });

const envVar = Object.entries(config).map(([key, value]) => ({ key, value }));

newman.run(
  {
    collection: COLLECTION,
    environment: ENVIRONMENT,
    envVar,
    reporters: ['cli', 'json'],
    reporter: { json: { export: REPORT_FILE } },
    // A request that hangs is a failure, not a reason to wait forever.
    timeoutRequest: 15_000,
  },
  (error, summary) => {
    if (error) {
      console.error(`Newman could not run the collection: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    const stats = summary.run.stats;
    const assertions = stats.assertions ?? { total: 0, failed: 0 };
    const requests = stats.requests ?? { total: 0, failed: 0 };

    console.log(
      `\nNewman: ${requests.total} requests, ` +
        `${assertions.total} assertions, ${assertions.failed} failed.`,
    );
    console.log(`Report written to ${path.relative(root, REPORT_FILE)}`);

    // Failures inside the run, a failed assertion, or a request error all fail
    // the command, so CI stops on the first bad run rather than reporting green.
    const failed =
      summary.run.failures.length > 0 || assertions.failed > 0 || (requests.failed ?? 0) > 0;

    process.exitCode = failed ? 1 : 0;
  },
);
