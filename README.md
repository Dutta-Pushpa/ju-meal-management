# JU Meal Management System

A meal ordering and food-collection platform for teachers of the Department of
Computer Science and Engineering, Jahangirnagar University (JU).

Teachers sign in, check their weekly meal budget, browse menus from
participating campus food locations, place orders before the daily cutoff, and
review their order history and balance. Authorized staff use a dashboard to
view all confirmed orders, group them by restaurant, print collection sheets,
and track collection and delivery.

> **সংক্ষিপ্ত:** জাহান্গিরনগর বিশ্ববিদ্যালয়ের সিএসই বিভাগের শিক্ষকদের জন্য খাবার
> অর্ডার ও সংগ্রহ ব্যবস্থাপনার ওয়েব সিস্টেম।

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

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Backend | Node.js 22 LTS, Express 5 |
| Database | PostgreSQL 16, run with Docker Compose |
| Data access | `node-postgres` with hand-written SQL |
| Migrations | Custom runner over `node-postgres` |
| Validation | Zod |
| Auth | JWT (HS256) Bearer tokens, bcrypt password hashing |
| Tests | Vitest, Supertest |
| API testing | Postman collection with Newman |
| Load testing | Apache JMeter |
| CI | GitHub Actions |
| Frontend | React, Vite, TypeScript |

## Quick start

**Prerequisites** — Node.js 22 LTS, npm 10+, Docker with Compose. Java 17+ is
needed only for the JMeter load test.

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

| Role | Email | Password | Can do |
| --- | --- | --- | --- |
| Teacher | `teacher@example.edu` | `TeacherPass123!` | Order meals, view own budget and history |
| Staff | `staff@example.edu` | `StaffPass123!` | View all orders, track collection and delivery |
| Admin | `admin@example.edu` | `AdminPass123!` | Everything, including users, budgets, menus |

## Project structure

```text
server/              Backend — Express, TypeScript
  src/
    routes/          URL to controller mapping
    middleware/      auth, role, permission, error handling
    controllers/     HTTP layer only
    services/        business rules, transaction boundaries
    models/          SQL and persistence
    views/           JSON response presenters
client/              Frontend — React, Vite, TypeScript
shared/              Types and Zod schemas used by both
db/
  migrations/        numbered SQL migrations
  seeds/             fictional seed data
postman/             API collection and environments
tests/
  integration/       Vitest + Supertest suites
  load/              JMeter test plans
docs/                project documentation
docker-compose.yml   PostgreSQL service
```

## Documentation

| Document | Contents |
| --- | --- |
| [architecture.md](docs/architecture.md) | Stack, project structure, layer design, conventions, security decisions |
| [database.md](docs/database.md) | Schema reference, ER diagram, transaction boundaries, migrations |
| [api.md](docs/api.md) | Endpoint contract, error format, sample requests and responses |
| [policies.md](docs/policies.md) | Business rules, assumptions, and open questions for the department |
| [development.md](docs/development.md) | Setup, commands, testing strategy, Postman, Newman, CI, load testing, roadmap |

**To make a decision about how the system behaves, [docs/policies.md](docs/policies.md)
is the only document that needs department input.** The rest is implementation
detail.

## Contributing

1. Keep each change to one coherent step, and leave the API runnable.
2. Do not document a feature as complete unless it is implemented **and** covered
   by a passing test.
3. Update the relevant document in `docs/` alongside the code. A behaviour change
   without a documentation change is incomplete.

## License

Released under the licence in [LICENSE](LICENSE). Not intended for production use
with real personal data.