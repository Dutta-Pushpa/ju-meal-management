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

## Commands

| Command | Description |
| --- | --- |
| `npm run dev:server` | Start the API in watch mode |
| `npm run dev:client` | Start the frontend |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:status` | Show applied and pending migrations |
| `npm run db:seed` | Reset and reload fictional demo data |
| `npm test` | Unit and integration tests |
| `npm run test:watch` | Same, in watch mode |
| `npm run test:api` | Postman collection via Newman |
| `npm run test:load` | JMeter load test |
| `npm run lint` | Lint the workspace |
| `npm run typecheck` | Type-check in strict mode |
| `npm run format` | Format the codebase |

## Testing layers

| Layer | Tool | Runs against |
| --- | --- | --- |
| Unit | Vitest | Pure functions: money, status transitions, cutoff logic, aggregation. No database |
| Integration | Vitest + Supertest | Full HTTP request down to a real PostgreSQL instance |
| API | Postman + Newman | End-to-end regression including negative and authorisation cases |
| Load | JMeter | Throughput and latency under concurrent activity |
| E2E | Deferred | Browser-level teacher and staff journeys |

Integration tests use a **real database**, never a mock. The rules under test are
transaction and constraint behaviour, which a fake cannot verify.

Each test file runs inside a transaction that is rolled back afterwards. Tests
that verify real concurrency use separate connections, since row locking is not
observable inside a single transaction. The suite refuses to run against a
database whose name does not end in `_test`.

## What is covered

| Area | Cases |
| --- | --- |
| Auth | Login success and failure, bcrypt storage and cost upgrade on login, 72-byte input rejection, duplicate email, registration validation, rate limiting, no user enumeration |
| Authorisation | Missing, malformed, and expired tokens; `tokenVersion` revocation; teacher refused on staff endpoints; staff refused without the required permission |
| Ordering | Server-calculated totals, client total ignored, atomic order + items + ledger debit, insufficient balance with no partial writes, invalid quantity, unavailable item, mixed locations |
| Cutoff | One second before, exactly at, and after the cutoff, plus the `Asia/Dhaka` boundary and disabled dates |
| Idempotency | Repeated `idempotencyKey` creates no duplicate order or debit |
| Concurrency | Simultaneous orders cannot exceed a balance |
| Snapshots | A later menu price change does not alter a historical order |
| Cancellation | Before-cutoff cancel with refund, refusal after cutoff, cross-teacher refusal, staff override is audited, cancelled order retained |
| Staff ops | Grouping by location, item quantity sums, location and daily totals, valid and invalid status transitions |
| Budget | Ledger-derived balances, duplicate allocation rejected, adjustments require a reason |
| Data | Migrations apply to an empty database, re-runs are a no-op, edited migrations are detected, seed is repeatable, locations are soft deleted |

## Postman collection

`postman/JU-Meal-Management.postman.collection.json`, with folders mirroring the
API: auth, locations, menus, teacher budget, orders, staff operations,
administration, and a negative-cases folder.

Environment files hold only the base URL and placeholders. **No real token or
password is committed**; CI injects credentials from repository secrets.

Login captures its token into an environment variable so later requests
authenticate themselves:

```javascript
pm.test("login returns an access token", function () {
  pm.response.to.have.status(200);
  const body = pm.response.json();
  pm.expect(body.data.accessToken).to.be.a("string").and.not.empty;
  pm.environment.set("accessToken", body.data.accessToken);
});
```

The negative folder covers the cases that matter: missing token, malformed
token, expired token, teacher hitting a staff endpoint, staff without a
permission they do not hold, and one teacher reading another's order.

```bash
npm run test:api     # same command locally and in CI
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

1. Start a PostgreSQL service container
2. Install dependencies
3. Lint and type-check
4. Apply migrations
5. Seed the test database
6. Run Vitest
7. Boot the API and wait for `/health`
8. Run the Newman collection
9. Archive reports as artifacts

Any failing step fails the pipeline.

## Load testing

JMeter plan at `tests/load/meal-ordering.jmx`, with three thread groups:

| Group | Simulates | Threads | Ramp-up |
| --- | --- | --- | --- |
| TG1 | Teachers browsing menus | 25 | 60 s |
| TG2 | Teachers checking out near the cutoff | 50 | 30 s |
| TG3 | Staff refreshing the daily dashboard | 5 | 10 s |

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

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold, TypeScript, lint, Docker Compose | Planned |
| 2 | Schema, migration runner, seed | Planned |
| 3 | Authentication and authorisation | Planned |
| 4 | MVC skeleton and locations CRUD | Planned |
| 5 | Menus, budgets, teacher ordering | Planned |
| 6 | Staff operations and reporting | Planned |
| 7 | Postman collection and Newman | Planned |
| 8 | CI integration | Planned |
| 9 | Load testing | Planned |
| 10 | Frontend | Not started |
| 11 | Deployment | Not started |

A phase is `Verified` only once it is implemented **and** its tests pass.