# Client — JU Meal Management System

React + Vite + TypeScript frontend connected to the existing Express API. It
does not embed demo arrays or compute business metrics from made-up values;
menus, budgets, orders, reports, user accounts, locations, settings, and status
changes come from authenticated API requests backed by PostgreSQL.

## Local development

From the repository root, after configuring `.env`, starting Docker PostgreSQL,
applying migrations, and seeding data (see the root README):

```bash
npm install
npm run dev:server   # terminal 1; http://localhost:4000
npm run dev:client   # terminal 2; http://localhost:5173
```

Vite proxies `/api` and `/health` to the backend. Set `VITE_API_URL` only when
the API is hosted at a different base path.

## Implemented frontend areas

- **Teacher:** budget overview, active food locations and menus, multi-item cart,
  order placement, order history/cancellation, and ledger history.
- **Staff:** daily order operations, location/status/date filtering, collection and
  delivery transitions, daily and period budget reports.
- **Admin / authorized staff:** location and menu management, user activation and
  permissions where authorized, budget-period/allocation/adjustment management,
  individual ledger lookup, and runtime settings.
- **Access:** navigation is filtered by the authenticated role/permission list;
  the API remains authoritative and rejects unauthorized requests.

Access tokens are held in memory only, never persisted in `localStorage`. A page
refresh therefore requires signing in again. This intentionally avoids storing a
long-lived bearer token in browser storage.

## Checks

```bash
npm run typecheck --workspace client
npm run build --workspace client
```

These commands require the workspace dependencies installed by `npm install`.
The client is an MVP and needs browser-based end-to-end testing plus deployment
security/configuration review before production use.
