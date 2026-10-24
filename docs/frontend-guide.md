# Frontend implementation and completion guide

This repository is a **React + Vite + TypeScript frontend, Express + TypeScript API, and PostgreSQL database** project. Keep PostgreSQL: its SQL migrations, transaction boundaries, constraints, and tests are part of the existing implementation. Do not replace it with MongoDB as part of frontend work.

The UI reads business data from the API. It does not carry a demo list of users, locations, food items, orders, balances, or reports. The rows created by `npm run db:seed` are fictional starter records in PostgreSQL, and all displayed order/budget values are returned by the server.

## 1. Start with the existing implementation

Before editing a workflow, read these in order:

1. `docs/architecture.md` for project boundaries and backend architecture.
2. `docs/api.md` for route contracts and response formats.
3. `docs/policies.md` for business rules, including budget and cancellation behavior.
4. The matching controller/service/model, then its existing integration tests.
5. The frontend page that calls that endpoint.

Keep the standard request/response format: successful API responses use `{ "data": ... }`; errors use the shared error envelope. `client/src/api.ts` unwraps `data` and turns API/network failures into visible messages. Do not fetch SQL directly from the browser.

## 2. Frontend file map

| File                                | Responsibility                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `client/src/main.tsx`               | Vite/React entry point and stylesheet import                                                            |
| `client/src/App.tsx`                | Sign-in/teacher registration, in-memory session, role/permission navigation, API health indicator       |
| `client/src/api.ts`                 | Typed `fetch` wrapper, bearer token, response/error handling, Bangladeshi money/date helpers            |
| `client/src/types.ts`               | TypeScript contracts for API entities and responses                                                     |
| `client/src/ui.tsx`                 | Shared buttons, fields, cards, tables, alerts, loading and empty states                                 |
| `client/src/pages/TeacherPages.tsx` | Teacher overview, menu/cart/order submission, orders/cancellation and personal budget/ledger            |
| `client/src/pages/StaffPages.tsx`   | Staff order queue, statuses, collection views and reporting                                             |
| `client/src/pages/AdminPages.tsx`   | Managed locations, menus, users/permissions, budget periods/allocations/adjustments and policy settings |
| `client/src/styles.css`             | Responsive layout and component styling                                                                 |
| `client/vite.config.ts`             | Local development server and `/api` + `/health` proxies                                                 |
| `server/src/routes/`                | API paths and access-control guards                                                                     |
| `server/src/controllers/`           | Request parsing/validation and HTTP response selection                                                  |
| `server/src/services/`              | Business rules and transaction boundaries                                                               |
| `server/src/models/`                | SQL queries and persistence                                                                             |
| `server/tests/integration/`         | API tests against PostgreSQL                                                                            |
| `db/migrations/` and `db/seeds/`    | Schema changes and fictional local demo records                                                         |

## 3. Run it locally

Prerequisites: Node.js 22.12+ (22.16+ recommended), npm 10+, and Docker with Docker Compose plugin.

From the repository root:

```bash
npm ci
docker compose up -d db
cp .env.example .env
```

Set the local database values in `.env` to match the PostgreSQL container configuration in `docker-compose.yml`. The usual local values are:

```dotenv
DATABASE_URL=postgresql://ju_meal:ju_meal_dev_password@localhost:5432/ju_meal
DATABASE_ADMIN_URL=postgresql://ju_meal:ju_meal_dev_password@localhost:5432/postgres
DB_SSL=false
JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
```

Then migrate and seed the local database:

```bash
npm run db:migrate
npm run db:seed
```

Start the API in terminal 1:

```bash
npm run dev:server
```

Start the frontend in terminal 2:

```bash
npm run dev:client
```

Open `http://localhost:5173`. Vite forwards `/api` and `/health` to the Express API on port `4000`. Use the fictional demo credentials in the root `README.md` only on a local development database. Do not deploy those accounts or passwords.

## 4. Work through the app in implementation parts

### Part A — Authentication and shared UI

- Test teacher registration and login against `/api/auth/register` and `/api/auth/login`.
- Confirm the response's access token is held in memory and sent as `Authorization: Bearer ...` by `api.ts`.
- Check API health at `/health` and make sure failures appear as an error instead of silent zero values.
- Keep the public registration path teacher-only. Staff/admin creation and permission updates belong to protected management routes.

### Part B — Teacher meal ordering

- `TeacherOverview` reads budget periods, `/api/orders/mine`, and `/api/teacher/budget`.
- `TeacherMeals` reads `/api/locations`, then `/api/locations/:id/menu`, and submits to `POST /api/orders`.
- `TeacherOrders` reads `/api/orders/mine` and uses `POST /api/orders/:id/cancel` for cancellation.
- `TeacherBudget` reads `/api/teacher/budget` and `/api/teacher/budget/ledger`.
- Never compute a payable total or remaining budget as an authority in the browser. The server revalidates item prices, cutoff, balance, and refund eligibility inside the business workflow.

### Part C — Staff operations and reports

- `StaffOperations` reads `GET /api/staff/orders/grouped`, `GET /api/staff/orders`, and `GET /api/locations` for live operational data and filters.
- Collection/delivery updates use `PATCH /api/staff/orders/:id/status`; item status updates use `PATCH /api/staff/order-items/:id/status` where relevant.
- `StaffReports` reads `GET /api/staff/reports/daily` and, for permitted staff, `GET /api/staff/reports/budget`.
- If a request fails, show the error/empty state. Do not create fallback metrics or pretend a failed response means zero orders or zero taka.

### Part D — Management screens

- Food locations use `/api/locations/manage/all` and the location create/update/deactivate endpoints.
- Menus use `/api/staff/menu-items` and its create/update/deactivate endpoints.
- User and permission management uses `/api/staff/users`; budget users come from `/api/staff/teachers`.
- Budget periods, allocations, adjustments and ledger operations use `/api/staff/budget-periods`, `/api/staff/budgets/allocations`, `/api/staff/budgets/adjustments`, and `/api/staff/budgets/ledger`.
- Settings use `/api/staff/settings` and `/api/staff/settings/:key`.
- Keep buttons hidden or disabled according to the user's permissions, but remember that UI checks are only for usability: every protected API route must enforce the permission on the server too.

## 5. Verify changes

After editing a page or endpoint, run the most targeted checks first, then the full suite:

```bash
# TypeScript checks (shared, server, database scripts and client)
npm run typecheck

# Production frontend compile
npm run build --workspace client

# API unit/integration tests (PostgreSQL test database required)
npm run test

# Full project quality gate (format, lint, type-check and tests)
npm run verify
```

The integration suite intentionally uses PostgreSQL, not an in-memory database. Run it against a disposable test DB, never a database containing important data. The test configuration is documented in `docs/development.md` and the CI workflow.

## 6. How to add a feature safely

1. Define the feature and its permission/business rule in `docs/policies.md` if it changes system behavior.
2. Add or adapt the SQL migration only if the schema genuinely needs to change. Do not edit old migrations already applied to a shared database.
3. Implement the query in a model and transaction/business rules in a service; keep controllers focused on HTTP.
4. Protect the route with server-side authentication/permission guards and validate all inputs.
5. Add an integration test for success, invalid input, forbidden access, and important transaction/refund/budget cases.
6. Add/extend the TypeScript response type in `client/src/types.ts`, then call the endpoint through `api.ts` from the right page.
7. Provide loading, empty, success, and API error states. Avoid fabricated data or hard-coded aggregate metrics.
8. Run the checks above and manually confirm the flow in the browser with a local seeded database.

## 7. Known validation limitation for this delivery

The implementation environment used to prepare this repository did not have Docker installed and could not resolve `registry.npmjs.org`, so a clean dependency install, Vite production build, and PostgreSQL-backed test run could not be completed here. The source files were syntax-parsed with the installed TypeScript compiler, but that is **not** a substitute for a full type-check, build, or database integration test. Run the commands in section 5 on a machine with Docker and npm registry access before treating the work as verified or production-ready.
