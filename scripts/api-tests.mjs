// Runs the Postman collections, one phase at a time.
//
// Each phase is a separate collection under postman/collections, and each one
// is self-contained: it signs in, creates the fixtures it needs, exercises one
// phase of the API, and signs out. That makes it possible to run a single
// phase and see whether that phase works, without the noise of the others.
//
// Usage:
//   npm run test:api              run every phase in order
//   npm run test:api -- phase5    run one phase
//
// The API must already be running and its database migrated and seeded; the CI
// job does that before calling this. See docs/development.md.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import newman from 'newman';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COLLECTION_DIR = path.join(root, 'postman', 'collections');
const ENVIRONMENT = path.join(root, 'postman', 'JU-Meal.local.postman_environment.json');
const REPORT_DIR = path.join(root, 'newman-report');

/**
 * The phases, in the order they build on each other.
 *
 * The identifier is what a phase is selected by on the command line.
 */
const PHASES = [
  {
    id: 'phase3',
    label: 'Phase 3 - Authentication and authorisation',
    file: 'phase-3-authentication.postman_collection.json',
  },
  {
    id: 'phase4',
    label: 'Phase 4 - Food locations',
    file: 'phase-4-locations.postman_collection.json',
  },
  {
    id: 'phase5',
    label: 'Phase 5 - Menus, budgets, and teacher ordering',
    file: 'phase-5-menu-budget-orders.postman_collection.json',
  },
  {
    id: 'phase6',
    label: 'Phase 6 - Staff operations and reporting',
    file: 'phase-6-staff-operations.postman_collection.json',
  },
];

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

  adminEmail: process.env['ADMIN_EMAIL'] ?? 'admin@juniv.edu',
  adminPassword: process.env['ADMIN_PASSWORD'] ?? 'AdminPass123!',

  staffEmail: process.env['STAFF_EMAIL'] ?? 'staff@juniv.edu',
  staffPassword: process.env['STAFF_PASSWORD'] ?? 'StaffPass123!',

  teacherEmail: process.env['TEACHER_EMAIL'] ?? 'teacher@juniv.edu',
  teacherPassword: process.env['TEACHER_PASSWORD'] ?? 'TeacherPass123!',
};

const requested = process.argv[2];
const selected = requested ? PHASES.filter((phase) => phase.id === requested) : PHASES;

if (requested && selected.length === 0) {
  console.error(
    `Unknown phase "${requested}".\n` +
      `Use one of: ${PHASES.map((phase) => phase.id).join(', ')}.`,
  );
  process.exitCode = 1;
} else {
  mkdirSync(REPORT_DIR, { recursive: true });

  const envVar = Object.entries(config).map(([key, value]) => ({ key, value }));

  /** Run one phase and resolve with its result. */
  function runPhase(phase) {
    return new Promise((resolve) => {
      newman.run(
        {
          collection: path.join(COLLECTION_DIR, phase.file),
          environment: ENVIRONMENT,
          envVar,
          reporters: ['cli', 'json'],
          // One report per phase, so a failure can be read in isolation and
          // CI can upload them all.
          reporter: { json: { export: path.join(REPORT_DIR, `${phase.id}.json`) } },
          // A request that hangs is a failure, not a reason to wait forever.
          timeoutRequest: 15_000,
        },
        (error, summary) => {
          if (error) {
            resolve({ phase, error: error.message });
            return;
          }

          const stats = summary.run.stats;
          const assertions = stats.assertions ?? { total: 0, failed: 0 };
          const requests = stats.requests ?? { total: 0, failed: 0 };

          // A rate-limited run fails every request at once, which looks like a
          // hundred broken assertions rather than one exhausted budget. Name the
          // cause, so the reader is not sent hunting through the report.
          const rateLimited = summary.run.executions.filter(
            (execution) => execution.response?.code === 429,
          );

          // Failures inside the run, a failed assertion, or a request error all
          // fail the phase, so CI stops on the first bad run rather than
          // reporting green.
          const failed =
            summary.run.failures.length > 0 || assertions.failed > 0 || (requests.failed ?? 0) > 0;

          resolve({
            phase,
            requests: requests.total,
            assertions: assertions.total,
            failedAssertions: assertions.failed,
            rateLimited: rateLimited.length,
            failed,
          });
        },
      );
    });
  }

  const results = [];

  for (const phase of selected) {
    console.log(`\n${'='.repeat(72)}\n${phase.label}\n${'='.repeat(72)}`);
    results.push(await runPhase(phase));
  }

  console.log(`\n${'='.repeat(72)}\nSummary\n${'='.repeat(72)}`);

  for (const result of results) {
    if (result.error) {
      console.log(`  ${result.phase.id.padEnd(8)} ERROR    ${result.error}`);
      continue;
    }

    const status = result.failed ? 'FAILED' : 'passed';
    const failedNote = result.failedAssertions > 0 ? `, ${result.failedAssertions} failed` : '';
    const detail = `${result.requests} requests, ${result.assertions} assertions${failedNote}`;

    console.log(`  ${result.phase.id.padEnd(8)} ${status.padEnd(8)} ${detail}`);

    if (result.rateLimited > 0) {
      console.error(
        `\n${result.rateLimited} request(s) in ${result.phase.id} were rate limited (HTTP 429). ` +
          'The collection is a test client, not a real user. Start the API with a ' +
          'raised limit, for example RATE_LIMIT_MAX_REQUESTS=5000 ' +
          'RATE_LIMIT_WINDOW_MINUTES=1, and run the suite again.',
      );
    }
  }

  if (results.some((result) => result.failed || result.error)) {
    process.exitCode = 1;
  }
}
