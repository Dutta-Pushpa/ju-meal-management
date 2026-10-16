# Architecture

Stack, structure, conventions, and the reasoning behind them.

> **সংক্ষিপ্ত:** কোন টেকনোলজি ব্যবহার করা হচ্ছে, কেন, এবং কোড কীভাবে সাজানো।

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | Type safety across the API and the future frontend |
| Runtime | Node.js 22 LTS | Long-term support, mature ecosystem |
| Framework | Express 5 | Small, well understood, minimal abstraction |
| Data access | `node-postgres` with hand-written SQL | Explicit SQL, no ORM magic, full control of locking |
| Migrations | Custom runner over `node-postgres` | Needed because there is no ORM; small and auditable |
| Database | PostgreSQL 16 (Docker Compose) | Transactions, constraints, and row locking are required |
| Validation | Zod | Shared between request parsing and test fixtures |
| Passwords | bcrypt | Mature, widely deployed, and a deliberate project choice |
| Auth | JWT (HS256), Bearer token | Required by the Postman/Newman workflow |
| Tests | Vitest + Supertest | Fast, TypeScript-native, real HTTP simulation |
| API testing | Postman + Newman | Collection runs identically locally and in CI |
| Load testing | Apache JMeter | Produces `.jtl` output and an HTML report |
| CI | GitHub Actions | Migrations, Vitest, and Newman on every push |
| Frontend | React + Vite + TypeScript | Deferred until the API is stable |

## Structure

```text
/
├─ server/                  Backend
│  └─ src/
│     ├─ routes/            URL to controller mapping
│     ├─ middleware/        auth, role, permission, error handling
│     ├─ controllers/       HTTP layer only
│     ├─ services/          business rules, transaction boundaries
│     ├─ models/            SQL and persistence
│     ├─ views/             JSON response presenters
│     ├─ utils/
│     └─ server.ts
├─ client/                  Frontend (React)
├─ shared/                  Types and Zod schemas used by both
├─ db/
│  ├─ migrations/*.sql
│  ├─ seeds/*.sql
│  └─ migrate.ts
├─ postman/                 API collection and environments
├─ tests/
│  ├─ integration/
│  └─ load/*.jmx
├─ docs/
├─ docker-compose.yml
├─ .env.example
└─ package.json             npm workspaces: server, client, shared
```

## Layers

```text
   Postman / Newman / JMeter / Browser
                  |
                HTTPS
                  v
       Express application (server/)
  +-------------------------------------------------+
  | routes       URL to controller mapping            |
  | middleware   auth, role, permission, errors       |
  | controllers  parse, delegate, choose status code  |
  | services     cutoff, budget, transactions        |
  | models       SQL and persistence                  |
  | views        JSON shape, BDT, Asia/Dhaka times    |
  +-------------------------------------------------+
                  |
            node-postgres pool
                  v
        PostgreSQL 16 (Docker)
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

### MVC mapping

The project is MVC adapted to a JSON API, where there is no server-rendered
template.

| MVC | Location | Notes |
| --- | --- | --- |
| Model | `server/src/models/` | Entities, SQL, persistence |
| View | `server/src/views/` | JSON presenters; the React app in `client/` becomes the user-facing view |
| Controller | `server/src/controllers/` | HTTP request handling |

`services/` sits between Controller and Model. This is a deliberate addition.
Putting the cutoff and budget rules in controllers would tie them to `req` and
`res`, making them impractical to test and easy to bypass from a second
endpoint. The service layer keeps business rules callable, testable, and in one
place.

## Conventions

**Money.** Always integer paisa, stored and computed in `bigint`. One taka is
100 paisa, so ৳150 is `15000`. Floating point is never used for money. The API
returns both `amountPaisa` (authoritative) and `amountFormatted` (display), and
clients never compute money from the formatted string.

**Time.** Timestamps are `timestamptz` written in UTC. `orders.order_date` is a
`date` holding the `Asia/Dhaka` calendar day, not a timestamp. The cutoff is
evaluated by converting the request time into `Asia/Dhaka`, never by trusting a
client-supplied clock or offset. The cutoff time itself lives in `app_settings`
so it can change without a deployment.

**Dates on the wire.** Business dates are `YYYY-MM-DD`. Timestamps are ISO 8601
UTC.

## Authentication

Login returns a JWT in the response body; clients send it as
`Authorization: Bearer <token>`. Claims are `sub`, `role`, `permissions`,
`tokenVersion`, `iat`, `exp`, `jti`, with a 15-minute lifetime.

`users.token_version` is embedded in every token. Incrementing it revokes all
of that user's tokens at once, which is how logout-all and password-change
revocation work without a blacklist.

Roles are `TEACHER`, `STAFF`, `ADMIN`. Role grants broad access; permissions
grant specific capabilities, so a `STAFF` account can be limited to collection
work without being able to allocate budgets. Permissions are enforced on the
server — hiding a button is not access control.

## Security trade-off

**JWT in a JSON body is reachable by JavaScript.** This was chosen because the
Postman and Newman workflow needs a token it can put in an `Authorization`
header, and those clients cannot read HTTP-only cookies. The cost is that an
XSS flaw would expose the token.

Mitigations in the design:

- The frontend holds the token in memory only, never `localStorage`.
- A 15-minute expiry limits the damage window.
- `tokenVersion` allows instant revocation.
- Content Security Policy and other security headers are set on the API.
- Output is escaped by the framework, never rendered as raw HTML.

Migrating to an HTTP-only cookie is documented in
[policies.md](policies.md#open-questions-for-the-department) as a hardening
option for once the frontend exists.

Other controls: parameterised SQL everywhere; strict Zod validation on every
body, query, and path parameter; login rate limiting; and an error envelope that
never leaks stack traces, SQL, or database messages.

## Password hashing

Passwords are hashed with **bcrypt** (`$2b$`), at a configurable cost factor held
in `BCRYPT_COST` and defaulting to **12**. Hashing and verification use the
library's async API so a request thread is never blocked on the deliberately
slow hash.

Four rules follow from bcrypt's behaviour, and all four are covered by tests:

- **The 72-byte limit is enforced, not ignored.** bcrypt silently truncates input
  beyond 72 bytes, so two passwords sharing a prefix would be interchangeable.
  Registration therefore rejects any password whose **UTF-8 byte length** exceeds
  72. The check is on bytes, not characters, so a short-looking Bengali or other
  multibyte password is not accepted by accident.
- **Minimum length is 12 characters**, checked before hashing.
- **A timing-safe comparison** is always used. The library handles this, but a
  plain `===` on hash strings is not acceptable anywhere in the codebase.
- **Cost upgrades on login.** After a successful verification, if the stored hash
  was made with a lower cost than the current `BCRYPT_COST`, the password is
  re-hashed and stored at the new cost. This is what makes raising the cost later
  safe for existing accounts.

A hash is never returned in any API response, and never written to a log, an
audit row, or an error message.

**Note on the choice.** Argon2id is the current OWASP first recommendation and is
preferable where you are free to choose; bcrypt is used here as the project's
choice. It remains a sound option — it is deliberately expensive, well studied,
and not known to be practically exploitable the way older fast hashes are — so
the important part is that the cost factor is configured high and raised over
time, which is what the upgrade rule above guarantees.

## Configuration

Environment variables are declared in `.env.example` with placeholders only.
Configuration is validated at startup and the application refuses to boot if a
required variable is missing, rather than failing later at the first request
that needs it. Secrets are never committed; `JWT_SECRET` must be replaced
before any real deployment.

## Deviations from the original requirements

The original requirements document is preserved in the repository history. These
decisions differ from it, each deliberately.

| Original | Decision | Reason |
| --- | --- | --- |
| Prisma ORM | Hand-written SQL with `node-postgres` | Explicit requirement; full control of locking |
| HTTP-only cookie sessions | JWT in the JSON body | Required by the Postman/Newman workflow |
| Two roles: `TEACHER`, `STAFF` | Three: `TEACHER`, `STAFF`, `ADMIN` | Separates budget and menu administration from collection |
| One order per day | Multiple orders per day, one location each | Real need for breakfast and lunch |
| Hard delete | Soft deactivation only | Historical financial records are never deleted |
| MVC | MVC plus a service layer | Keeps business rules testable and independent of HTTP |