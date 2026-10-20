# Postman collections

The API contract, split into one collection per implementation phase.

| Collection                                           | Phase | What it covers                                                         |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `phase-3-authentication.postman_collection.json`     | 3     | Registration, sign in, sign out, session restore, role guards          |
| `phase-4-locations.postman_collection.json`          | 4     | Browsing locations, reading menus, location CRUD, soft deactivation    |
| `phase-5-menu-budget-orders.postman_collection.json` | 5     | Menu administration, budget periods, allocations, ordering, cancelling |
| `phase-6-staff-operations.postman_collection.json`   | 6     | Staff dashboard, collection status, reports, settings, user admin      |

## Each collection stands on its own

Every collection is self-contained. It begins with a **Setup** folder that
signs in and creates the fixtures the phase needs, runs the phase's own
requests, and ends with a **Teardown** folder that signs out. Nothing is
carried over from another collection, so any single phase can be run on its own
and its result is meaningful.

Phases that need data create it in their own Setup folder:

| Phase | Setup creates                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------- |
| 3     | Nothing; the endpoints are public                                                                 |
| 4     | The three demo sessions                                                                           |
| 5     | Sessions, a location and a menu item, a budget period, and an allocation                          |
| 6     | Sessions, a new account, a location and a menu item, a budget period, an allocation, and an order |

Each phase creates its own budget period, far enough apart in the calendar
that two phases running back to back never produce overlapping periods.

## Running them

```bash
npm run test:api              # every phase, with a summary per phase
npm run test:api:phase3       # one phase
npm run test:api:phase4
npm run test:api:phase5
npm run test:api:phase6
```

`npm run test:api` expects the API to be running against a migrated and seeded
database. `npm run test:api:local` starts the API on the test database itself,
runs the phases, and stops it again:

```bash
npm run test:api:local             # every phase
npm run test:api:local -- phase5   # one phase
```

The runner prints a summary per phase, so a broken phase is visible without
reading the request log:

```text
  phase3   passed   18 requests, 40 assertions
  phase4   passed   16 requests, 37 assertions
  phase5   passed   45 requests, 96 assertions
  phase6   passed   35 requests, 82 assertions
```

A failure in one phase does not stop the others. Each phase writes its own
report to `newman-report/<phase>.json`.

## The environment file

`JU-Meal.local.postman_environment.json` holds the base URL, the demo account
emails, empty password fields, and placeholders for captured values. **No real
token or password is committed.** `scripts/api-tests.mjs` supplies the
documented demo passwords as defaults, so a fresh checkout needs no
configuration. `API_BASE_URL`, `ADMIN_PASSWORD`, `STAFF_PASSWORD`, and
`TEACHER_PASSWORD` override the defaults in CI or against another host.

## Adding a request

Open the phase collection in Postman, add the request to the folder it belongs
to, and add its assertions. A request that needs data from an earlier step in
the same phase reads the variable that step set; a request that needs data from
another phase must create it in its own Setup folder.
