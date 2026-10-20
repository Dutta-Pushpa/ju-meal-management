# JU Meal Management System

A meal ordering and food-collection platform for teachers of the Department of
Computer Science and Engineering, Jahangirnagar University (JU).

Teachers sign in, check their weekly meal budget, browse menus from
participating campus food locations, place orders before the daily cutoff, and
review their order history and balance. Staff use a dashboard to view all
confirmed orders, group them by restaurant, print collection sheets, and track
collection and delivery.

> **সংক্ষিপ্ত:** জাহান্গিরনগর বিশ্ববিদ্যালয়ের সিএসই বিভাগের শিক্ষকদের জন্য খাবার
> অর্ডার ও সংগ্রহ ব্যবস্থাপনার ওয়েব সিস্টেম।

> **Status.** The API, the database schema, the migrations, the seed data, and
> the authentication, location, menu, budget, ordering, staff, reporting,
> settings, and user-administration endpoints are implemented and tested against
> a real PostgreSQL instance. The React frontend is not built yet.

> ### Data notice
>
> **All data in this repository is fictional demonstration data.** Restaurant
> names, menu items, prices, teacher records, and sample orders are
> illustrative. Prices are not verified real-world prices. Confirm
> participating vendors and prices with the department before any production
> use, and never seed a real system with real personal information without
> authorization.

## Features

**For teachers**

- Secure sign-in and sign-out
- Weekly budget, spending, and remaining balance
- Browse food locations and menus with live prices and availability
- Build an order, review the itemised total, submit before the cutoff
- Order history with per-item detail
- Budget transaction history
- Cancel and receive a refund before the cutoff

**For staff**

- Daily operations dashboard with date, location, and status filters
- All confirmed orders for a date
- Automatic grouping by restaurant with item-level quantity summaries
- Printable collection sheets per location plus a daily summary
- Mark orders and individual items as collected or delivered
- Daily cost totals by restaurant
- Weekly budget allocation and ledger review
- Menu, price, and location administration

**Enforced everywhere**

- The server is the authority on prices, totals, balances, permissions, and the
  12:00 PM `Asia/Dhaka` cutoff. A request after the cutoff is rejected even if
  the browser thought ordering was open.
- Order creation and the budget debit happen in one database transaction, so an
  order can never exist without its matching ledger entry.
- Concurrent orders cannot overspend a balance.
- Historical orders keep their own price and name snapshots, so a later menu
  price change never rewrites the past.

## Tech stack

| Layer       | Choice                                             |
| ----------- | -------------------------------------------------- |
| Language    | TypeScript (strict)                                |
| Backend     | Node.js 22 LTS, Express 5                          |
| Database    | PostgreSQL 16, run with Docker Compose             |
| Data access | `node-postgres` with hand-written SQL              |
| Migrations  | Custom runner over `node-postgres`                 |
| Validation  | Hand-written, `server/src/utils/validation.ts`     |
| Auth        | JWT (HS256) Bearer tokens, bcrypt password hashing |
| Tests       | Vitest, Supertest                                  |
| API testing | Postman collection with Newman                     |
| CI          | GitHub Actions                                     |
| Frontend    | React, Vite, TypeScript                            |

## Architecture

```text
   Postman / Newman / Browser
                 |
               HTTPS
                 v
        Express application (server/)
   +-------------------------------------------------+
   | routes       URL to controller mapping            |
   | middleware   auth, role, permission, errors       |
   | controllers  parse, delegate, choose status code  |
   | services     cutoff, budget, transactions         |
   | models       SQL and persistence                  |
   | views        JSON shape, BDT, Asia/Dhaka times    |
   +-------------------------------------------------+
                 |
           node-postgres pool
                 v
       PostgreSQL 16 (Docker or Neon)
```

Each layer has one job, and a rule belongs in the highest layer that can see
everything it needs.

- **Routes** map a URL and method to a controller and declare its middleware.
- **Middleware** runs before protected handlers. Nothing here knows business rules.
- **Controllers** handle HTTP only: validate input, call one service, choose the
  status code, hand off to a view. No business logic.
- **Services** hold the business rules and own transaction boundaries — order
  creation, cutoff enforcement, budget validation, refunds.
- **Models** own persistence. Every query is parameterised; string interpolation
  into SQL is not permitted anywhere.
- **Views** transform model output into the public JSON shape. Pure functions,
  no database access.

### Conventions

**Money.** Always integer paisa, stored and computed in `bigint`. One taka is
100 paisa, so ৳150 is `15000`. Floating point is never used for money. The API
returns both `amountPaisa` (authoritative) and `amountFormatted` (display), and
clients never compute money from the formatted string.

**Time.** Timestamps are `timestamptz` written in UTC. `orders.order_date` is a
`date` holding the `Asia/Dhaka` calendar day, not a timestamp. The cutoff is
evaluated by converting the request time into `Asia/Dhaka`, never by trusting a
client-supplied clock or offset. The cutoff time lives in `app_settings` so it
can change without a deployment.

**Dates on the wire.** Business dates are `YYYY-MM-DD`. Timestamps are ISO 8601
UTC.

### Authentication

Login returns a JWT in the response body; clients send it as
`Authorization: Bearer <token>`. Claims are `sub`, `role`, `permissions`,
`tokenVersion`, `iat`, `exp`, `jti`, with a 15-minute lifetime.

`users.token_version` is embedded in every token. Incrementing it revokes all of
that user's tokens at once, which is how logout-all and password-change
revocation work without a blacklist.

Roles are `TEACHER`, `STAFF`, `ADMIN`. Role grants broad access; permissions
grant specific capabilities, so a `STAFF` account can be limited to collection
work without being able to allocate budgets. Permissions are enforced on the
server — hiding a button is not access control.

**Security trade-off.** A JWT in a JSON body is reachable by JavaScript. This
was chosen because the Postman and Newman workflow needs a token it can put in
an `Authorization` header. The cost is that an XSS flaw would expose the token.
The frontend therefore holds the token in memory only, never `localStorage`; the
token expires after 15 minutes; `tokenVersion` allows instant revocation; and
the API sets a Content Security Policy and other security headers. Migrating to
an HTTP-only cookie is documented in
[policies.md](docs/policies.md#open-questions-for-the-department).

Other controls: parameterised SQL everywhere; strict validation of every body,
query, and path parameter; login rate limiting; and an error envelope that
never leaks stack traces, SQL, or database messages.

### Password hashing

Passwords are hashed with **bcrypt** (`$2b$`), at a configurable cost factor held
in `BCRYPT_COST` and defaulting to **12**. Four rules follow from bcrypt's
behaviour, and all four are covered by tests:

- The 72-byte limit is enforced, not ignored. bcrypt silently truncates longer
  input, so two passwords sharing a prefix would be interchangeable. The check
  is on UTF-8 bytes, so a short-looking multibyte password is not accepted by
  accident.
- Minimum length is 12 characters, checked before hashing.
- A timing-safe comparison is always used. A plain `===` on hash strings is not
  acceptable anywhere in the codebase.
- Cost upgrades on login. After a successful verification, a hash made with a
  lower cost than the current `BCRYPT_COST` is re-hashed and stored at the new
  cost, which is what makes raising the cost later safe for existing accounts.

A hash is never returned in any API response, and never written to a log, an
audit row, or an error message.

## Project structure

```text
/
├─ server/                  Backend — Express 5, TypeScript
│  ├─ src/
│  │  ├─ routes/            URL to controller mapping
│  │  ├─ middleware/        auth, permissions, error handling
│  │  ├─ controllers/       HTTP layer only
│  │  ├─ services/          business rules, transaction boundaries
│  │  ├─ models/            SQL and persistence
│  │  ├─ views/             JSON response presenters
│  │  ├─ utils/             validation, money, tokens, passwords, logging
│  │  ├─ config/            environment configuration
│  │  ├─ db/                connection pool and type parsers
│  │  ├─ app.ts             application factory
│  │  └─ server.ts          entry point
│  └─ tests/                Vitest + Supertest suites (unit, integration)
├─ shared/                  Types and constants shared by the server and client
├─ client/                  Frontend — React, Vite, TypeScript (not built yet)
├─ db/
│  ├─ migrations/           numbered SQL migrations
│  ├─ seeds/                fictional demo data
│  ├─ migrate.ts            migration runner
│  └─ seed.ts               seed loader
├─ postman/                 API contract, one collection per phase
│  ├─ collections/          phase 3 to phase 6
│  └─ JU-Meal.local.postman_environment.json
├─ scripts/                 Newman runners
├─ docs/                    policies, database, development
├─ .github/workflows/       CI and CD
├─ docker-compose.yml       PostgreSQL service
└─ package.json             npm workspaces: server, client, shared
```

## Quick start

**Prerequisites** — Node.js 22 LTS, npm 10+, Docker with Compose.

```bash
docker compose up -d db      # start PostgreSQL
npm install
cp .env.example .env
npm run db:migrate           # create the schema
npm run db:seed              # load fictional demo data
npm run dev:server           # API on http://localhost:4000
```

`GET /health` reports database connectivity. Full command reference is in
[docs/development.md](docs/development.md).

## Demo accounts

Created by `npm run db:seed`. **Fictional accounts with placeholder passwords —
change or delete them before any deployment.**

| Role    | Email                 | Password          | Can do                                         |
| ------- | --------------------- | ----------------- | ---------------------------------------------- |
| Teacher | `teacher@example.edu` | `TeacherPass123!` | Order meals, view own budget and history       |
| Staff   | `staff@example.edu`   | `StaffPass123!`   | View all orders, track collection and delivery |
| Admin   | `admin@example.edu`   | `AdminPass123!`   | Everything, including users, budgets, menus    |

## Documentation

| Document                                   | Contents                                                           |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [docs/policies.md](docs/policies.md)       | Business rules, assumptions, and open questions for the department |
| [docs/database.md](docs/database.md)       | Schema reference, ER diagram, transaction boundaries, migrations   |
| [docs/development.md](docs/development.md) | Setup, commands, testing, API reference, CI                        |

**To make a decision about how the system behaves,
[docs/policies.md](docs/policies.md) is the only document that needs department
input.** The rest is implementation detail.

## Contributing

1. Keep each change to one coherent step, and leave the API runnable.
2. Do not document a feature as complete unless it is implemented **and** covered
   by a passing test.
3. Update the relevant document in `docs/` alongside the code. A behaviour change
   without a documentation change is incomplete.

## License

Released under the licence in [LICENSE](LICENSE). Not intended for production use
with real personal data.
