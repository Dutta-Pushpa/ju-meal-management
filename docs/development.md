# Development

Setup, testing, the API contract, and CI.

> **সংক্ষিপ্ত:** প্রজেক্ট চালানোর নিয়ম, টেস্ট, API এবং CI সম্পর্কে লেখা আছে।

## Prerequisites

- Node.js 22 LTS and npm 10+
- Docker with Docker Compose

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

Integration tests need their own database. Both the suite and the global setup
refuse to connect unless the database name ends in `_test`, because the suite
migrates the schema and truncates every table for real.

The test connection string is resolved in this order:

1. `TEST_DATABASE_URL`, when it is set. It must already name a `_test`
   database.
2. Otherwise it is derived from `DATABASE_ADMIN_URL`, or from `DATABASE_URL`
   when there is no admin URL: the host loses `-pooler` so the connection is
   direct, and the database name becomes `ju_meal_test` unless it already ends
   in `_test`.

`npm test` resolves that string, creates the database if it does not exist,
applies the migrations, and runs the suite. There is no separate setup step.

```bash
npm test
```

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

The test database is derived from the same host with the name `ju_meal_test`, so
the suite never touches the development data. Set `TEST_DATABASE_URL` in `.env`
when the test database lives somewhere else, for example on a separate Neon
branch. It must be the **direct** (non-pooled) string, because the migrations
take a session-level advisory lock.

Two schemas, one source of truth: the migrations in `db/migrations` are applied
to each database separately, and each keeps its own `schema_migrations` table
with a checksum per file. Editing an applied migration is refused, so the two
databases cannot drift apart silently.

The timeouts are raised automatically when the test database is not on
localhost, because a hosted provider is slower to create a scratch database and
may drop a connection mid-test. Override them when needed:

```powershell
$env:VITEST_TEST_TIMEOUT = 300000
$env:VITEST_HOOK_TIMEOUT = 300000
$env:VITEST_RETRY = 2
npm test
```

**Branches.** Neon can copy a database instantly. A teammate can branch to get an
isolated copy for a risky change, then delete the branch. Each branch has its own
connection strings. On the free tier Neon suspends an idle database and resumes
it on the next connection, so the first query after a quiet spell is slightly
slower.

## Commands

| Command                     | Description                           |
| --------------------------- | ------------------------------------- |
| `npm run dev:server`        | Start the API in watch mode           |
| `npm run dev:client`        | Start the frontend                    |
| `npm run db:migrate`        | Apply pending migrations              |
| `npm run db:migrate:status` | Show applied and pending migrations   |
| `npm run db:seed`           | Reset and reload fictional demo data  |
| `npm test`                  | Unit and integration tests            |
| `npm run test:watch`        | Same, in watch mode                   |
| `npm run test:coverage`     | Same, with a coverage report          |
| `npm run test:api`          | Postman collections via Newman        |
| `npm run test:api:phase3`   | One phase of the API contract         |
| `npm run test:api:phase4`   | One phase of the API contract         |
| `npm run test:api:phase5`   | One phase of the API contract         |
| `npm run test:api:phase6`   | One phase of the API contract         |
| `npm run test:api:local`    | Same, against an API it starts itself |
| `npm run lint`              | Lint the workspace                    |
| `npm run typecheck`         | Type-check in strict mode             |
| `npm run format`            | Format the codebase                   |
| `npm run verify`            | Format, lint, type-check, and test    |

## Testing layers

| Layer       | Tool               | Runs against                                                                      |
| ----------- | ------------------ | --------------------------------------------------------------------------------- |
| Unit        | Vitest             | Pure functions: money, status transitions, cutoff logic, aggregation. No database |
| Integration | Vitest + Supertest | Full HTTP request down to a real PostgreSQL instance                              |
| API         | Postman + Newman   | End-to-end regression including negative and authorisation cases                  |
| E2E         | Deferred           | Browser-level teacher and staff journeys                                          |

Integration tests use a **real database**, never a mock. The rules under test are
transaction and constraint behaviour, which a fake cannot verify.

Each test file runs inside a transaction that is rolled back afterwards. Tests
that verify real concurrency use separate connections, since row locking is not
observable inside a single transaction.

### What is covered

| Area          | Cases                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | Login success and failure, bcrypt storage and cost upgrade on login, 72-byte input rejection, duplicate email, production registration permissions, rate limiting, no user enumeration                                     |
| Authorisation | Missing, malformed, and expired tokens; `tokenVersion` revocation; teacher refused on staff endpoints; staff refused without the required permission                                                                       |
| Ordering      | Server-calculated totals, client total ignored, atomic order + items + ledger debit, insufficient balance with no partial writes, invalid quantity, unavailable item, mixed locations, disabled dates, cutoff, idempotency |
| Cutoff        | One second before, exactly at, and after the cutoff, plus the `Asia/Dhaka` boundary and disabled dates                                                                                                                     |
| Idempotency   | Repeated `idempotencyKey` creates no duplicate order or debit                                                                                                                                                              |
| Concurrency   | Simultaneous orders cannot exceed a balance                                                                                                                                                                                |
| Snapshots     | A later menu price change does not alter a historical order                                                                                                                                                                |
| Cancellation  | Before-cutoff cancel with refund, refusal after cutoff, cross-teacher refusal, staff override is audited, cancelled order retained                                                                                         |
| Staff ops     | Date-based order filters, grouping by location, item quantity sums, location and daily totals, valid and invalid status transitions                                                                                        |
| Budget        | Ledger-derived balances, duplicate allocation rejected, adjustments require a reason, configurable rollover of positive prior-period balances                                                                              |
| Settings      | Settings permission, value validation, persisted cutoff and audit record                                                                                                                                                   |
| Data          | Migrations apply to an empty database, re-runs are a no-op, edited migrations are detected, seed is repeatable, locations are soft deleted                                                                                 |

## API reference

**Base URL** `/api` · **Content type** `application/json` ·
**Authentication** `Authorization: Bearer <accessToken>` on every protected
endpoint.

**Business dates** are `YYYY-MM-DD`, always the `Asia/Dhaka` calendar date.
**Timestamps** are ISO 8601 in UTC.

**Money** is returned as two fields: `amountPaisa` (the authoritative integer,
use this for arithmetic) and `amountFormatted` (display only, for example
`৳150.00`). Clients never compute money from the formatted string.

### Envelopes

```json
{ "data": { "id": 1, "name": "Bot Tola" } }
```

```json
{
  "data": [{ "id": 1 }, { "id": 2 }],
  "meta": { "total": 2 }
}
```

Every failure uses the same shape:

```json
{
  "error": {
    "code": "BUDGET_INSUFFICIENT",
    "message": "Order total exceeds the available budget for this period.",
    "details": [{ "field": "items", "issue": "required" }]
  }
}
```

`code` is a stable machine-readable string. Clients branch on `code`, never on
`message`. `message` is written for a human and may be reworded. `details` is
present only for validation failures. Stack traces, SQL fragments, and database
error text are never included.

### Status codes

| Code  | Meaning                                                                     |
| ----- | --------------------------------------------------------------------------- |
| `200` | Successful read or update                                                   |
| `201` | Resource created                                                            |
| `400` | Malformed request or failed validation                                      |
| `401` | Missing, malformed, or expired token                                        |
| `403` | Authenticated but not permitted                                             |
| `404` | Not found, or not visible to this caller                                    |
| `409` | Conflicts with existing state, for example a duplicate allocation           |
| `422` | Well-formed but semantically invalid, for example ordering after the cutoff |
| `429` | Rate limited                                                                |
| `500` | Unexpected server error                                                     |

Returning `404` rather than `403` for a resource belonging to another teacher
prevents an authenticated user from probing for the existence of other
teachers' records.

### Error codes

| Code                           | Status | Meaning                                                                 |
| ------------------------------ | ------ | ----------------------------------------------------------------------- |
| `VALIDATION_ERROR`             | 400    | Request failed validation                                               |
| `UNAUTHORIZED`                 | 401    | No token, or the token is invalid or expired                            |
| `FORBIDDEN`                    | 403    | Role or permission does not allow this action                           |
| `NOT_FOUND`                    | 404    | Resource does not exist or is not visible to the caller                 |
| `EMAIL_ALREADY_EXISTS`         | 409    | Registration or update used an existing email                           |
| `LOCATION_ALREADY_EXISTS`      | 409    | A location with that name already exists                                |
| `LOCATION_HAS_ACTIVE_ORDERS`   | 409    | The location has orders in the current period and cannot be deactivated |
| `DUPLICATE_ALLOCATION`         | 409    | The teacher already has an allocation for this period                   |
| `BUDGET_PERIOD_ALREADY_EXISTS` | 409    | The period name is already used or its dates overlap another period     |
| `ORDERING_CLOSED`              | 422    | The cutoff for this date has passed                                     |
| `ORDERING_DISABLED`            | 422    | Ordering is disabled for this date, such as a holiday                   |
| `ITEM_UNAVAILABLE`             | 422    | A requested item is inactive or unavailable                             |
| `MIXED_LOCATIONS`              | 422    | An order contained items from more than one location                    |
| `BUDGET_INSUFFICIENT`          | 422    | Order total exceeds the available balance                               |
| `INVALID_STATUS_TRANSITION`    | 422    | The requested status change is not allowed from the current status      |
| `CUTOFF_PASSED`                | 422    | Modification attempted after the cutoff                                 |
| `RATE_LIMITED`                 | 429    | Too many requests                                                       |
| `INTERNAL_ERROR`               | 500    | Unexpected server error                                                 |

The list is defined once, in `shared/src/index.ts`.

### Endpoints

| Method   | Path                                | Access                   | Purpose                                     |
| -------- | ----------------------------------- | ------------------------ | ------------------------------------------- |
| `GET`    | `/health`                           | public                   | Liveness and database connectivity          |
| `POST`   | `/api/auth/register`                | public in dev            | Create an account                           |
| `POST`   | `/api/auth/login`                   | public                   | Sign in, returns an access token            |
| `POST`   | `/api/auth/logout`                  | any signed-in            | Revoke the current session                  |
| `GET`    | `/api/auth/me`                      | any signed-in            | The current user, with role and permissions |
| `GET`    | `/api/auth/staff-check`             | `STAFF`                  | Minimal probe of the role guard             |
| `GET`    | `/api/locations`                    | any signed-in            | List active food locations                  |
| `GET`    | `/api/locations/:id`                | any signed-in            | One location                                |
| `GET`    | `/api/locations/:id/menu`           | any signed-in            | The menu of one location                    |
| `POST`   | `/api/locations`                    | `locations:manage`       | Create a location                           |
| `PATCH`  | `/api/locations/:id`                | `locations:manage`       | Update a location                           |
| `DELETE` | `/api/locations/:id`                | `locations:manage`       | Deactivate a location                       |
| `POST`   | `/api/orders`                       | `TEACHER`                | Place an order                              |
| `GET`    | `/api/orders/mine`                  | `TEACHER`                | The caller's own orders                     |
| `GET`    | `/api/orders/mine/:id`              | `TEACHER`                | One of the caller's own orders              |
| `POST`   | `/api/orders/:id/cancel`            | owner or `orders:cancel` | Cancel an order and refund it               |
| `GET`    | `/api/teacher/budget`               | signed-in                | Budget summary for the period               |
| `GET`    | `/api/teacher/budget/ledger`        | signed-in                | Budget ledger entries                       |
| `GET`    | `/api/staff/orders`                 | `STAFF`                  | Orders for a date, filtered                 |
| `GET`    | `/api/staff/orders/grouped`         | `STAFF`                  | The same orders, grouped by location        |
| `PATCH`  | `/api/staff/orders/:id/status`      | `orders:manage_status`   | Change an order's status                    |
| `PATCH`  | `/api/staff/order-items/:id/status` | `orders:manage_status`   | Change an item's status                     |
| `GET`    | `/api/staff/reports/daily`          | `STAFF`                  | Daily totals by location                    |
| `GET`    | `/api/staff/reports/budget`         | `budgets:view`           | Budget report for a period                  |
| `POST`   | `/api/staff/budget-periods`         | `budgets:allocate`       | Create a budget period                      |
| `POST`   | `/api/staff/budgets/allocations`    | `budgets:allocate`       | Allocate a budget to a teacher              |
| `POST`   | `/api/staff/budgets/adjustments`    | `budgets:adjust`         | Record an adjustment                        |
| `GET`    | `/api/staff/budgets/ledger`         | `budgets:view`           | Ledger entries for a teacher and period     |
| `POST`   | `/api/staff/menu-items`             | `menu_items:manage`      | Create a menu item                          |
| `PATCH`  | `/api/staff/menu-items/:id`         | `menu_items:manage`      | Update a menu item                          |
| `DELETE` | `/api/staff/menu-items/:id`         | `menu_items:manage`      | Deactivate a menu item                      |
| `GET`    | `/api/staff/settings`               | `settings:manage`        | List the settings                           |
| `PATCH`  | `/api/staff/settings/:key`          | `settings:manage`        | Change one setting                          |
| `PATCH`  | `/api/staff/users/:id`              | `users:manage`           | Activate, deactivate, or re-role a user     |

Permissions are enforced on the server. A role grants broad access and a
permission grants a specific capability, so a `STAFF` account can be limited to
collection work without being able to allocate budgets or edit menus.

## Postman collections

The API contract lives in `postman/collections`, split into one collection per
implementation phase:

| Collection                                           | Phase | What it covers                                                         |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `phase-3-authentication.postman_collection.json`     | 3     | Registration, sign in, sign out, session restore, role guards          |
| `phase-4-locations.postman_collection.json`          | 4     | Browsing locations, reading menus, location CRUD, soft deactivation    |
| `phase-5-menu-budget-orders.postman_collection.json` | 5     | Menu administration, budget periods, allocations, ordering, cancelling |
| `phase-6-staff-operations.postman_collection.json`   | 6     | Staff dashboard, collection status, reports, settings, user admin      |

Each collection stands on its own. It begins with a Setup folder that signs in
and creates the fixtures the phase needs, runs that phase's requests, and ends
with a teardown. Nothing carries over between collections, so any single phase
can be run on its own and its result is meaningful. Phases that need data create
it in their own Setup folder, including their own far-future budget period, so
they never depend on the seeded "current" week still being current.

```bash
npm run test:api              # every phase, with a summary per phase
npm run test:api:phase5       # one phase
npm run test:api:local        # starts the API on the test database, then stops it
npm run test:api:local -- phase5
```

A failure in one phase does not stop the others, and the runner prints a
summary per phase:

```text
  phase3   passed   18 requests, 40 assertions
  phase4   passed   16 requests, 37 assertions
  phase5   passed   45 requests, 96 assertions
  phase6   passed   35 requests, 82 assertions
```

Each phase writes its own report to `newman-report/<phase>.json`. The folders
inside a phase follow the product surface: the feature requests, then negative
cases, request validation, and authorisation boundaries for that phase.

`postman/JU-Meal.local.postman_environment.json` holds only the base URL, the
demo account emails, empty password fields, and placeholders for captured
values. **No real token or password is committed.** `scripts/api-tests.mjs` runs
Newman against that environment and supplies the documented demo passwords as
defaults, so a fresh checkout needs no configuration. `API_BASE_URL`,
`ADMIN_PASSWORD`, `STAFF_PASSWORD`, and `TEACHER_PASSWORD` override the defaults
in CI or against another host.

See [postman/README.md](../postman/README.md) for the phase breakdown and how
to add a request.

### The rate limit and repeated runs

The API limits requests per client to 300 every 15 minutes by default, which a
single collection run exhausts. A second run against the same server therefore
fails with HTTP 429 on every request, which looks like a hundred broken
assertions rather than one exhausted budget. The runner detects this case and
says so, and the CI job raises the limit. For a local run, start the API with the
limit raised:

```bash
RATE_LIMIT_MAX_REQUESTS=5000 RATE_LIMIT_WINDOW_MINUTES=1 npm run dev:server
```

The limit is a production safeguard and is deliberately not weakened in the
code; only the test environments change it.

A failed assertion, a request error, or a timeout fails the command.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and `development` and on
every pull request. It starts a PostgreSQL 16 service, installs with `npm ci`,
and then:

| Job                        | What it does                                                | Active when                               |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Capture phase inputs       | Scans the tree for later-phase artifacts                    | Always                                    |
| Format, lint, type-check   | `format:check`, `lint`, `typecheck`                         | Always                                    |
| Unit and integration tests | `npm run test:coverage` against a real PostgreSQL service   | Always — coverage uploaded as an artifact |
| API collection (Newman)    | Boots the API, waits for `/health`, runs `npm run test:api` | `postman/**/*.json` exists                |
| Frontend build             | `npm run build --workspace client`                          | `client/vite.config.*` exists             |

Any failing step fails the pipeline. The tests migrate their own database before
running, and tests that need a genuinely empty database create and drop one.

Jobs for later phases skip themselves until their files exist, so neither this
document nor the workflow needs editing as the project grows.

`.github/workflows/cd.yml` publishes a container image to GitHub Container
Registry on a version tag, and skips until a `Dockerfile` exists. Its deploy
job is a disabled placeholder.

`.github/workflows/load.yml` runs the JMeter plan on demand, and skips until
`tests/load/*.jmx` exists.

## Roadmap

| Phase | Scope                                      | Status      |
| ----- | ------------------------------------------ | ----------- |
| 1     | Scaffold, TypeScript, lint, Docker Compose | Verified    |
| 2     | Schema, migration runner, seed             | Verified    |
| 3     | Authentication and authorisation           | Verified    |
| 4     | MVC skeleton and locations CRUD            | Verified    |
| 5     | Menus, budgets, teacher ordering           | Verified    |
| 6     | Staff operations and reporting             | Verified    |
| 7     | Postman collection and Newman              | Verified    |
| 8     | CI integration                             | In progress |
| 9     | Load testing                               | Planned     |
| 10    | Frontend                                   | Not started |
| 11    | Deployment                                 | Not started |

A phase is `Verified` only once it is implemented **and** its tests pass.
`In progress` means the work is present but not yet proven green in CI.
