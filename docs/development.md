# Development

Setup, testing, and CI.

> **সংক্ষিপ্ত:** প্রজেক্ট চালানোর নিয়ম, টেস্ট এবং CI সম্পর্কে লেখা আছে।

## Prerequisites

- Node.js 22 LTS and npm 10+
- Docker with Docker Compose
- Java 17+ — JMeter load tests only

## Setup

```bash
docker compose up -d db      # start PostgreSQL
npm install
cp .env.example .env
npm run db:migrate           # create the schema
npm run db:seed              # load fictional demo data
npm run dev:server           # API on http://localhost:4000
```

`GET /health` reports database connectivity.

### The test database

Integration tests need their own database. They never run against development
or production data: both the helper and the global setup refuse to connect
unless the database name ends in `_test`.

```bash
docker compose exec db createdb -U ju_meal ju_meal_test
```

Then run the tests with that database:

```bash
DATABASE_URL=postgresql://ju_meal:ju_meal_dev_password@localhost:5432/ju_meal_test npm test
```

The test database is migrated automatically before the suite starts, so a new
checkout needs nothing more than the database existing. Put the value in `.env`
so it is picked up automatically.

Tests that need a genuinely empty database create a throwaway one and drop it
afterwards, so they never disturb the shared test database.

### A shared database with Neon

[Neon](https://neon.tech) is hosted PostgreSQL. A team can point every checkout
at the same database, so nobody has to seed or migrate on their own.

**One-time setup, by whoever creates the project:**

1. Create a Neon project. It gives two connection strings for every branch:
   - the **pooled** string — its host contains `-pooler`;
   - the **direct** string — no `-pooler`, and the one for migrations.
2. Put them in `.env`:

   ```bash
   DATABASE_URL="postgresql://...@ep-xxx-pooler.aws.neon.tech/neondb?sslmode=require"
   DATABASE_ADMIN_URL="postgresql://...@ep-xxx.aws.neon.tech/neondb?sslmode=require"
   DB_SSL=true
   ```

3. Create the schema and demo data once:

   ```bash
   npm run db:migrate    # uses DATABASE_ADMIN_URL, the direct connection
   npm run db:seed
   ```

4. Share both strings with teammates out of band — a password manager or a
   private GitHub environment secret. Never commit them; they are credentials.

**How it fits the project.** The API reads `DATABASE_URL` through a pool, so the
pooled string is right at runtime. Migrations take a session-level advisory lock
and run multi-statement transactions, so they use `DATABASE_ADMIN_URL`, the
direct string — a transaction pooler would drop the lock between statements.
`db/migrate` and `db/seed` both prefer the direct string.

**Keep tests local.** The test suite refuses any database whose name does not end
in `_test`, and some tests create and drop throwaway databases. Run tests against
local Docker PostgreSQL or CI, not the shared Neon database. If you want tests on
Neon, branch the project, create a `ju_meal_test` database there, and point
`DATABASE_URL` at that database's **direct** (non-pooled) string for the run.

Creating a database is slow on a hosted provider, so raise the Vitest timeouts
for a Neon run rather than editing the config defaults:

```powershell
$env:DATABASE_URL = "postgresql://...@ep-xxx.aws.neon.tech/ju_meal_test?sslmode=require"
$env:VITEST_TEST_TIMEOUT = 120000
$env:VITEST_RETRY = 1
npm test
Remove-Item Env:DATABASE_URL, Env:VITEST_TEST_TIMEOUT, Env:VITEST_RETRY
```

`VITEST_RETRY` absorbs a connection a hosted provider drops mid-test;
`VITEST_HOOK_TIMEOUT` is available too. An interrupted run can leave
`jugm_scratch_*` databases behind; drop them by hand.

**Branches.** Neon can copy a database instantly. A teammate can branch to get an
isolated copy for a risky change, then delete the branch. Each branch has its own
connection strings.

On the free tier Neon suspends an idle database and resumes it on the next
connection, so the first query after a quiet spell is slightly slower.

## Commands

| Command                     | Description                          |
| --------------------------- | ------------------------------------ |
| `npm run dev:server`        | Start the API in watch mode          |
| `npm run dev:client`        | Start the frontend                   |
| `npm run db:migrate`        | Apply pending migrations             |
| `npm run db:migrate:status` | Show applied and pending migrations  |
| `npm run db:seed`           | Reset and reload fictional demo data |
| `npm test`                  | Unit and integration tests           |
| `npm run test:watch`        | Same, in watch mode                  |
| `npm run test:coverage`     | Same, with a coverage report         |
| `npm run test:api`          | Postman collection via Newman        |
| `npm run test:load`         | JMeter load test                     |
| `npm run lint`              | Lint the workspace                   |
| `npm run typecheck`         | Type-check in strict mode            |
| `npm run format`            | Format the codebase                  |

## Testing layers

| Layer       | Tool               | Runs against                                                                      |
| ----------- | ------------------ | --------------------------------------------------------------------------------- |
| Unit        | Vitest             | Pure functions: money, status transitions, cutoff logic, aggregation. No database |
| Integration | Vitest + Supertest | Full HTTP request down to a real PostgreSQL instance                              |
| API         | Postman + Newman   | End-to-end regression including negative and authorisation cases                  |
| Load        | JMeter             | Throughput and latency under concurrent activity                                  |
| E2E         | Deferred           | Browser-level teacher and staff journeys                                          |

Integration tests use a **real database**, never a mock. The rules under test are
transaction and constraint behaviour, which a fake cannot verify.

Each test file runs inside a transaction that is rolled back afterwards. Tests
that verify real concurrency use separate connections, since row locking is not
observable inside a single transaction. The suite refuses to run against a
database whose name does not end in `_test`.

## What is covered

| Area          | Cases                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | Login success and failure, bcrypt storage and cost upgrade on login, 72-byte input rejection, duplicate email, production registration permissions, rate limiting, no user enumeration |
| Authorisation | Missing, malformed, and expired tokens; `tokenVersion` revocation; teacher refused on staff endpoints; staff refused without the required permission                                  |
| Ordering      | Server-calculated totals, client total ignored, atomic order + items + ledger debit, insufficient balance with no partial writes, invalid quantity, unavailable item, mixed locations, disabled dates, cutoff, idempotency |
| Cutoff        | One second before, exactly at, and after the cutoff, plus the `Asia/Dhaka` boundary and disabled dates                                                                                |
| Idempotency   | Repeated `idempotencyKey` creates no duplicate order or debit                                                                                                                         |
| Concurrency   | Simultaneous orders cannot exceed a balance                                                                                                                                           |
| Snapshots     | A later menu price change does not alter a historical order                                                                                                                           |
| Cancellation  | Before-cutoff cancel with refund, refusal after cutoff, cross-teacher refusal, staff override is audited, cancelled order retained                                                    |
| Staff ops     | Date-based order filters, grouping by location, item quantity sums, location and daily totals, valid and invalid status transitions                                                   |
| Budget        | Ledger-derived balances, duplicate allocation rejected, adjustments require a reason, configurable rollover of positive prior-period balances                                          |
| Settings      | Settings permission, value validation, persisted cutoff and audit record                                                                                                                  |
| Data          | Migrations apply to an empty database, re-runs are a no-op, edited migrations are detected, seed is repeatable, locations are soft deleted                                            |

## Postman collection

`postman/JU-Meal-Management.postman.collection.json`, with folders mirroring the
API: auth, locations, menus, teacher budget, orders, staff operations,
administration, and a negative-cases folder.

Environment files hold only the base URL and placeholders. **No real token or
password is committed**; CI injects credentials from repository secrets.

Login captures its token into an environment variable so later requests
authenticate themselves:

```javascript
pm.test('login returns an access token', function () {
  pm.response.to.have.status(200);
  const body = pm.response.json();
  pm.expect(body.data.accessToken).to.be.a('string').and.not.empty;
  pm.environment.set('accessToken', body.data.accessToken);
});
```

The negative folder covers the cases that matter: missing token, malformed
token, expired token, teacher hitting a staff endpoint, staff without a
permission they do not hold, and one teacher reading another's order.

```bash
npm run test:api     # same command locally and in CI
```

## CI

`.github/workflows/ci.yml` runs on every push to `main` and `development` and on
every pull request. It starts a PostgreSQL 16 service, installs with `npm ci`,
and then:

| Job                        | What it does                                                | Active when                               |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Capture phase inputs       | Scans the tree for later-phase artifacts                    | Always                                    |
| Format, lint, type-check   | `format:check`, `lint`, `typecheck`                         | Always                                    |
| Unit and integration tests | `npm run test:coverage` against a real PostgreSQL service   | Always — coverage uploaded as an artifact |
| API collection (Newman)    | Boots the API, waits for `/health`, runs `npm run test:api` | `postman/**/*.json` exists (Phase 7)      |
| Frontend build             | `npm run build --workspace client`                          | `client/vite.config.*` exists (Phase 10)  |

Any failing step fails the pipeline. The tests migrate their own database before
running, and tests that need a genuinely empty database create and drop one.

Jobs for later phases skip themselves until their files exist, so neither this
document nor the workflow needs editing as the project grows. A separate
`.github/workflows/load.yml` runs the JMeter plan nightly or on demand, once
`tests/load/*.jmx` exists (Phase 9).

Packaging and deployment — the container image published to GHCR, and the
deployment checklist for Phase 11 — are documented in
[deployment.md](deployment.md).

## Load testing

JMeter plan at `tests/load/meal-ordering.jmx`, with three thread groups:

| Group | Simulates                             | Threads | Ramp-up |
| ----- | ------------------------------------- | ------- | ------- |
| TG1   | Teachers browsing menus               | 25      | 60 s    |
| TG2   | Teachers checking out near the cutoff | 50      | 30 s    |
| TG3   | Staff refreshing the daily dashboard  | 5       | 10 s    |

```bash
docker compose up -d db && npm run db:migrate && npm run db:seed && npm run dev:server
npm run test:load
```

Generates `.jtl` output and an HTML report in `tests/load/results/`. Delete the
report directory before re-running; JMeter will not overwrite a non-empty one.

**Correctness matters more than latency.** After a run, verify that ledger debits
equal the sum of confirmed order totals, that no teacher's balance went negative,
that duplicate keys created no duplicates, and that the same-account contention
run produced no overspend. A fast run with any financial inconsistency is a
failure.

## Roadmap

| Phase | Scope                                      | Status      |
| ----- | ------------------------------------------ | ----------- |
| 1     | Scaffold, TypeScript, lint, Docker Compose | Verified    |
| 2     | Schema, migration runner, seed             | Verified    |
| 3     | Authentication and authorisation           | Verified    |
| 4     | MVC skeleton and locations CRUD            | Verified    |
| 5     | Menus, budgets, teacher ordering           | In progress |
| 6     | Staff operations and reporting             | In progress |
| 7     | Postman collection and Newman              | Planned     |
| 8     | CI integration                             | In progress |
| 9     | Load testing                               | Planned     |
| 10    | Frontend                                   | Not started |
| 11    | Deployment                                 | Not started |

A phase is `Verified` only once it is implemented **and** its tests pass.
`In progress` means the work is present but not yet proven green in CI. The
CI workflows (`ci.yml`, `cd.yml`, `load.yml`) are in place; Phase 8 becomes
`Verified` once they run green on GitHub, and the CD deploy job stays a
documented placeholder until Phase 11.
