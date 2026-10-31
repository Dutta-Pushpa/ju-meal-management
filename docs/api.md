# API Reference

REST contract for the JU Meal Management System.

> **সংক্ষিপ্ত:** এই ডকুমেন্টে সব API এন্ডপয়েন্ট, তাদের ইনপুট আউটপুট এবং
> উদাহরণ দেওয়া আছে।

> **Status:** `In progress`. The endpoints below are implemented, but the sample
> payloads remain illustrative until they are checked against real responses.
> An endpoint is marked `Verified` in [development.md](development.md#roadmap)
> only after it matches this document and its tests pass.

## Conventions

**Base URL** `/api`

**Content type** `application/json` in both directions.

**Authentication** `Authorization: Bearer <accessToken>` on every protected
endpoint.

**Business dates** `YYYY-MM-DD`, always the `Asia/Dhaka` calendar date.

**Timestamps** ISO 8601 in UTC, for example `2026-10-16T06:30:00.000Z`.

**Money** Every amount is returned as two fields:

| Field             | Type      | Meaning                                          |
| ----------------- | --------- | ------------------------------------------------ |
| `amountPaisa`     | `integer` | The authoritative value. Use this for arithmetic |
| `amountFormatted` | `string`  | Display only, for example `৳150.00`              |

Clients must never compute money from `amountFormatted`.

### Success envelope

Single resource:

```json
{ "data": { "id": 1, "name": "Bot Tola" } }
```

Collection:

```json
{
  "data": [{ "id": 1 }, { "id": 2 }],
  "meta": { "total": 2 }
}
```

### Error envelope

Every failure uses the same shape:

```json
{
  "error": {
    "code": "BUDGET_INSUFFICIENT",
    "message": "Order total exceeds the available budget for this month.",
    "details": [{ "field": "items", "issue": "required" }]
  }
}
```

`code` is a stable machine-readable string. Clients branch on `code`, never on
`message`. `message` is written for a human and may be reworded. `details` is
present only for validation failures.

Internal details, stack traces, SQL fragments, and database error text are
never included.

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

### Defined error codes

| Code                           | Status | Meaning                                                                 |
| ------------------------------ | ------ | ----------------------------------------------------------------------- |
| `VALIDATION_ERROR`             | 400    | Request failed schema validation                                        |
| `UNAUTHORIZED`                 | 401    | No token, or the token is invalid or expired                            |
| `FORBIDDEN`                    | 403    | Role or permission does not allow this action                           |
| `NOT_FOUND`                    | 404    | Resource does not exist or is not visible to the caller                 |
| `EMAIL_ALREADY_EXISTS`         | 409    | Registration or update used an existing email                           |
| `LOCATION_ALREADY_EXISTS`      | 409    | A location with that name already exists                                |
| `LOCATION_HAS_ACTIVE_ORDERS`   | 409    | The location has orders in the current period and cannot be deactivated |
| `DUPLICATE_ALLOCATION`         | 409    | The teacher already has an allocation for this calendar month           |
| `BUDGET_PERIOD_ALREADY_EXISTS` | 409    | The period name is already used or its dates overlap another period     |
| `ORDERING_CLOSED`              | 422    | The cutoff for this date has passed                                     |
| `ITEM_UNAVAILABLE`             | 422    | A requested item is inactive or unavailable                             |
| `MIXED_LOCATIONS`              | 422    | An order contained items from more than one location                    |
| `BUDGET_INSUFFICIENT`          | 422    | Order total exceeds the available balance                               |
| `INVALID_STATUS_TRANSITION`    | 422    | The requested status change is not allowed from the current status      |
| `CUTOFF_PASSED`                | 422    | Modification attempted after the cutoff                                 |
| `RATE_LIMITED`                 | 429    | Too many requests                                                       |

Returning `404` rather than `403` for a resource belonging to another teacher
prevents an authenticated user from probing for the existence of other
teachers' records.

## Authentication

### `POST /api/auth/register`

Creates a user. Open registration is enabled only in the development and test
profiles. In production this endpoint requires `ADMIN`, or `STAFF` with the
`users:create` permission. Staff may create teacher accounts only.

**Auth:** none in dev/test; `ADMIN` or `STAFF` with `users:create` in production.

Request:

```json
{
  "fullName": "A. Teacher",
  "email": "teacher@juniv.edu",
  "password": "Str0ngPassw0rd!",
  "role": "TEACHER"
}
```

`201` response:

```json
{
  "data": {
    "id": 42,
    "fullName": "A. Teacher",
    "email": "teacher@juniv.edu",
    "role": "TEACHER",
    "permissions": [],
    "isActive": true,
    "createdAt": "2026-10-16T06:30:00.000Z"
  }
}
```

The response never contains `password_hash` or any part of the password.

Validation: `email` must be a valid address and must not already exist, checked
case-insensitively. `password` must be at least 12 characters and at most 72 UTF-8 bytes. bcrypt
truncates anything longer, so the byte limit is enforced rather than silently
accepted. `role` must be
one of the three defined roles.

`409 EMAIL_ALREADY_EXISTS` if the email is taken.

### `POST /api/auth/login`

**Auth:** none.

Request:

```json
{ "email": "teacher@juniv.edu", "password": "Str0ngPassw0rd!" }
```

`200` response:

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresAt": "2026-10-16T06:45:00.000Z",
    "user": {
      "id": 42,
      "fullName": "A. Teacher",
      "email": "teacher@juniv.edu",
      "role": "TEACHER",
      "permissions": []
    }
  }
}
```

`401 UNAUTHORIZED` with a deliberately vague message when the email or password
is wrong. The endpoint does not reveal which one, to prevent account
enumeration. Rate limited per IP and per email.

### `POST /api/auth/logout`

**Auth:** bearer.

Revokes the current session and records the logout. `200` with an empty data
object.

### `GET /api/auth/me`

**Auth:** bearer.

Returns the authenticated user. Used by the frontend to restore a session and
to decide which navigation to render. `401` if the token has expired or the
user's `token_version` has changed since it was issued.

## Teacher — budget

Budgets are planned per calendar month (Asia/Dhaka time). `year` and `month`
default to the current Dhaka month when both are omitted; supplying only one of
them is a `400`.

### `GET /api/teacher/budget?year=2026&month=10`

**Auth:** `TEACHER`, `STAFF`, or `ADMIN`.

Returns the teacher's budget summary for one month. A `TEACHER` always receives
their own budget; supplying another `teacherId` is rejected. `STAFF` and `ADMIN`
must supply `teacherId` to view a teacher's budget.

```json
{
  "data": {
    "year": 2026,
    "month": 10,
    "period": {
      "id": "2026-10",
      "name": "October 2026",
      "startsOn": "2026-10-01",
      "endsOn": "2026-10-31"
    },
    "hasAllocation": true,
    "allocated": { "amountPaisa": 70000, "amountFormatted": "৳700.00" },
    "adjusted": { "amountPaisa": 3000, "amountFormatted": "৳30.00" },
    "carryForward": { "amountPaisa": 12000, "amountFormatted": "৳120.00" },
    "spent": { "amountPaisa": 45000, "amountFormatted": "৳450.00" },
    "refunded": { "amountPaisa": 5000, "amountFormatted": "৳50.00" },
    "available": { "amountPaisa": 45000, "amountFormatted": "৳450.00" }
  }
}
```

`available = allocated + adjusted + carryForward − spent + refunded`. The
carry-forward is computed from earlier months' ledger activity (positive
remaining balances roll into the month; a negative remaining balance rolls in
as a negative carry-forward). It is computed, never read from a stored column.
`period` is a presentation label derived from `year`/`month`, not a legacy
budget period record.

### `GET /api/teacher/budget/ledger?year=2026&month=10`

Paginated ledger entries of the authenticated teacher for one month, newest
first. Supports `page` (default `1`) and `perPage` (default `20`, maximum
`100`). `STAFF` and `ADMIN` must supply `teacherId`; teachers cannot override
their own identity. The response includes `meta.total`, `meta.page`, and
`meta.perPage`.

> Legacy: `GET /api/teacher/budget-periods` still returns the old budget-period
> records, but the UI no longer uses it. Monthly planning replaced budget
> periods.

### `POST /api/teacher/budget-requests`

**Auth:** any authenticated role; the request belongs to the signed-in user.

Body: `{ "requestType": "budget_increase" | "debt_allowance", "amountPaisa": <positive integer>, "reason": "<text>" }`.
Creates a pending budget request for an administrator to review. Returns `201`
with the created request.

### `GET /api/teacher/budget-requests?page=1&perPage=20&status=pending`

The signed-in teacher's own requests, newest first, each with `status`
(`pending` | `approved` | `rejected`), `amount`, `reason`, and — once decided —
`decidedBy` and `decidedAt`.

## Locations and menus

### `GET /api/locations`

**Auth:** any authenticated user.

Returns active locations. Inactive locations are excluded.

### `GET /api/locations/manage/all`

**Auth:** `ADMIN`, or `STAFF` with `locations:manage`.

Returns the management directory, including soft-deactivated locations. The
response includes the active-state field so authorized users can reactivate or
deactivate a location without a browser-maintained copy of the directory.

```json
{
  "data": [
    {
      "id": 1,
      "name": "Bot Tola",
      "nameBn": "বটতলা",
      "description": "Traditional Bengali meals",
      "isActive": true
    },
    {
      "id": 2,
      "name": "Central Cafeteria",
      "nameBn": "কেন্দ্রীয় ক্যাফেটেরিয়া",
      "description": null,
      "isActive": true
    }
  ],
  "meta": { "total": 2 }
}
```

### `GET /api/locations/:id`

Single location. `404` if it does not exist or is inactive.

### `POST /api/locations`

**Auth:** `ADMIN`, or `STAFF` with the `locations:manage` permission.

```json
{ "name": "Tasty Treat", "nameBn": "টেস্টি ট্রিট", "description": "Bakery and fast food" }
```

`201` returns the created location. `409 LOCATION_ALREADY_EXISTS` if the name is
already taken (compared case-insensitively).

### `PATCH /api/locations/:id`

**Auth:** same as create. Partial update; only supplied fields change, and an
absent field is left untouched. Sending `"nameBn": null` clears it. Setting
`"isActive": false` is guarded exactly like `DELETE` below.

### `DELETE /api/locations/:id`

**Auth:** same as create.

**Soft deactivation.** Sets `is_active = false`. Returns `200`. The row is
retained because historical orders reference it, per policy P8.

Deactivating a location that still has non-cancelled orders on the current
business date returns `409 LOCATION_HAS_ACTIVE_ORDERS`. Both this endpoint and
`PATCH` with `"isActive": false` apply the same guard; neither bypasses it. A
location whose only orders that day are cancelled, or whose orders fall on past
dates, deactivates normally.

### `GET /api/locations/:id/menu`

**Auth:** any authenticated user.

Returns active and available items for an active location, ordered by category
and name. An inactive or missing location returns `404`.

```json
{
  "data": {
    "location": { "id": 1, "name": "Bot Tola" },
    "items": [
      {
        "id": 10,
        "name": "Chicken Meal",
        "description": "Rice, chicken curry, bhorta",
        "category": "lunch",
        "price": { "amountPaisa": 15000, "amountFormatted": "৳150.00" },
        "isAvailable": true
      }
    ]
  }
}
```

## Orders

### `POST /api/orders`

**Auth:** `TEACHER`.

Request:

```json
{
  "orderDate": "2026-10-16",
  "foodLocationId": 1,
  "idempotencyKey": "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "items": [{ "menuItemId": 10, "quantity": 2, "notes": "less spicy" }]
}
```

`idempotencyKey` is client-generated and stable across retries of the same
checkout attempt. `orderDate` must be a valid business date within a calendar
month that has a budget allocation for the teacher (the debit is booked against
that month's budget). `items` must contain 1–50 lines; quantities are limited
to 100 per line. The supplied `foodLocationId` must match every active,
available item.

Optionally the teacher may declare a fallback dish:
`alternativeItemName` (string) and `alternativeUnitPricePaisa` (positive
integer). Both must be sent together. This records what the teacher accepts if
their first choice is unavailable; the estimated total is still debited at
placement and settled against the actual delivered cost later.

`201` response:

```json
{
  "data": {
    "id": 501,
    "orderDate": "2026-10-16",
    "foodLocation": { "id": 1, "name": "Bot Tola" },
    "status": "CONFIRMED",
    "total": { "amountPaisa": 30000, "amountFormatted": "৳300.00" },
    "items": [
      {
        "id": 9001,
        "menuItemId": 10,
        "name": "Chicken Meal",
        "quantity": 2,
        "unitPrice": { "amountPaisa": 15000, "amountFormatted": "৳150.00" },
        "lineTotal": { "amountPaisa": 30000, "amountFormatted": "৳300.00" }
      }
    ],
    "confirmedAt": "2026-10-16T06:30:00.000Z"
  }
}
```

The total is calculated by the server from current database prices. A
client-supplied total is ignored.

Failure modes:

| Situation                             | Code                  | Status                          |
| ------------------------------------- | --------------------- | ------------------------------- |
| After the 12:00 PM Asia/Dhaka cutoff  | `ORDERING_CLOSED`     | 422                             |
| An item is inactive or unavailable    | `ITEM_UNAVAILABLE`    | 422                             |
| Quantity is not a positive integer    | `VALIDATION_ERROR`    | 400                             |
| Items span more than one location     | `MIXED_LOCATIONS`     | 422                             |
| Total exceeds the available balance   | `BUDGET_INSUFFICIENT` | 422                             |
| An order with this key already exists | none                  | 200, returns the original order |

The whole operation is one database transaction. If any part fails, no order,
no order items, and no ledger debit are written.

### `GET /api/orders/mine`

**Auth:** `TEACHER`.

The authenticated teacher's own orders. Supports `orderDate`, `from`, `to`,
`status`, and pagination (`page`, default `1`; `pageSize`, default `20`, maximum
`100`). Results are newest first. A teacher can never retrieve another
teacher's orders through this endpoint or through any parameter.

### `GET /api/orders/mine/:id`

Single order. `404` when the order does not belong to the caller.

### `POST /api/orders/:id/cancel`

**Auth:** the owning teacher before the cutoff, or `STAFF`/`ADMIN` at any time.

```json
{ "reason": "changed my mind" }
```

`200` returns the cancelled order. The refund appears in the ledger
immediately.

A teacher attempting to cancel after the cutoff receives
`422 CUTOFF_PASSED`. A staff cancellation is recorded in `audit_logs` with the
actor, timestamp, and required reason. Only confirmed orders can be cancelled;
repeated cancellation attempts receive `422 INVALID_STATUS_TRANSITION`.

## Staff operations

All endpoints in this group reject `TEACHER` with `403 FORBIDDEN`.

### `GET /api/staff/orders?date=YYYY-MM-DD`

Orders for a date, with `locationId`, `status`, and `teacherId` filters plus
pagination (`page`, default `1`; `pageSize`, default `50`, maximum `100`).
Cancelled orders are excluded unless `status=CANCELLED` is requested.

```json
{
  "data": [
    {
      "id": 501,
      "teacher": { "id": 42, "fullName": "A. Teacher" },
      "foodLocation": { "id": 1, "name": "Bot Tola" },
      "status": "CONFIRMED",
      "total": { "amountPaisa": 30000, "amountFormatted": "৳300.00" },
      "items": [{ "name": "Chicken Meal", "quantity": 2 }]
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 50 }
}
```

### `GET /api/staff/orders/grouped?date=YYYY-MM-DD`

Non-cancelled orders grouped by food location, with item-level quantity sums.
This is the data source behind the collection sheet.

```json
{
  "data": {
    "date": "2026-10-16",
    "orderCount": 5,
    "locations": [
      {
        "location": { "id": 1, "name": "Bot Tola" },
        "teacherCount": 2,
        "total": { "amountPaisa": 32000, "amountFormatted": "৳320.00" },
        "itemSummary": [
          { "name": "Chicken Meal", "quantity": 2 },
          { "name": "Rice and fish", "quantity": 1 }
        ],
        "orders": [{ "id": 501, "teacherName": "A. Teacher", "items": [], "total": {} }]
      }
    ],
    "dailyTotal": { "amountPaisa": 73000, "amountFormatted": "৳730.00" }
  }
}
```

Every figure is calculated from persisted order records at request time.
Nothing is hard-coded or cached from a seed.

### `PATCH /api/staff/orders/:id/status`

**Auth:** `STAFF` or `ADMIN`.

```json
{ "status": "COLLECTED", "note": "collected from vendor at 12:40" }
```

Allowed transitions: `CONFIRMED → COLLECTED → DELIVERED`. Cancelling through
this endpoint requires a non-empty `note` and creates the refund. Any other
combination returns `422 INVALID_STATUS_TRANSITION`.

When delivering, the staff member may reconcile the billed cost:

```json
{
  "status": "DELIVERED",
  "actualCostPaisa": 27500,
  "alternativeItemName": "Beef Tehari",
  "note": "chicken unavailable"
}
```

Both fields are optional. The estimated total was already debited when the
order was placed; the difference between `actualCostPaisa` and the estimate is
debited (costlier) or refunded (cheaper) against the order's budget month, the
order's billed total is updated, and `alternativeItemName` records what was
actually served. Omitting both delivers the order at the estimated cost.

Each transition appends an `order_status_events` row and an audit entry.

### `PATCH /api/staff/order-items/:id/status`

**Auth:** `STAFF` or `ADMIN`.

Item-level collection state, for when parts of an order are collected separately.
Allowed transitions are `PENDING → COLLECTED → DELIVERED`. Each change appends
an order status event and audit entry. Request body accepts `status` and an
optional `note`.

### `GET /api/staff/reports/daily?date=YYYY-MM-DD`

**Auth:** `STAFF` or `ADMIN`.

Totals and order counts by location plus the daily total, computed from
non-cancelled order records. The response also carries a `statusSummary`
object with per-status counts for every order of the date (including
cancelled ones) and the spending on delivered orders:

```json
{
  "data": {
    "date": "2026-10-28",
    "statusSummary": {
      "total": 12,
      "pending": 2,
      "processing": 4,
      "delivered": 5,
      "cancelled": 1,
      "spendingOnDelivered": { "amountPaisa": 95000, "amountFormatted": "৳950.00" }
    },
    "locations": [
      {
        "location": { "id": 1, "name": "Cafeteria" },
        "orderCount": 10,
        "total": { "amountPaisa": 180000, "amountFormatted": "৳1800.00" }
      }
    ],
    "dailyTotal": { "amountPaisa": 180000, "amountFormatted": "৳1800.00" }
  }
}
```

### `GET /api/staff/reports/monthly?year=2026&month=10`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

Six-month teacher report ending at the anchor month (inclusive). For each
month it lists every teacher with their budget state (allocation, signed
adjustments, carry-forward, spending, refunds, remaining balance) and order
counts by status with the spending on delivered orders. `year`/`month`
default to the current Dhaka month.

### `GET /api/staff/reports/budget?period=<periodId>` (legacy)

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

Per-teacher allocation, spending, refunds, signed adjustments, and remaining
balance for a legacy budget period. Amounts come from the ledger. Retained for
historical reporting only; the UI uses `GET /api/staff/budgets/monthly`, which
is the monthly equivalent.

## Administration

Access is role-based: every endpoint here requires `ADMIN`, or `STAFF`.
Configurable per-user permissions were removed from the authorisation model.

### `GET /api/staff/budgets/monthly?year=2026&month=10`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

The monthly planning table: every active teacher with their allocation,
adjustments, carry-forward, spending, refunds, and remaining balance for the
month. `year`/`month` default to the current Dhaka month.

```json
{
  "data": [
    {
      "teacher": { "id": 42, "fullName": "Dr. Ahsan Karim", "email": "teacher@juniv.edu" },
      "hasAllocation": true,
      "allocated": { "amountPaisa": 280000, "amountFormatted": "৳2800.00" },
      "adjusted": { "amountPaisa": 5000, "amountFormatted": "৳50.00" },
      "carryForward": { "amountPaisa": 12000, "amountFormatted": "৳120.00" },
      "spent": { "amountPaisa": 45000, "amountFormatted": "৳450.00" },
      "refunded": { "amountPaisa": 0, "amountFormatted": "৳0.00" },
      "remaining": { "amountPaisa": 252000, "amountFormatted": "৳2520.00" }
    }
  ],
  "meta": { "total": 1 }
}
```

`remaining` may be negative when a teacher overspends; it rolls into the next
month as a negative carry-forward.

### `GET /api/staff/budgets/transactions?year=2026&month=10&teacherId=42`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

Successful (non-cancelled) orders placed in the budget month — date, amount,
status, and a transaction id `TXN-<orderId padded to 6 digits>`. Optional
`teacherId` filters to one teacher; supports `page` (default `1`) and `perPage`
(default `50`, maximum `100`).

```json
{
  "data": [
    {
      "id": 8,
      "transactionId": "TXN-000008",
      "teacher": { "id": 42, "fullName": "Dr. Ahsan Karim" },
      "orderDate": "2026-10-14",
      "amount": { "amountPaisa": 8500, "amountFormatted": "৳85.00" },
      "status": "delivered"
    }
  ],
  "meta": { "total": 1, "page": 1, "perPage": 50 }
}
```

### `GET /api/staff/budgets/history?year=2026&month=10`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

Allocation history for the six months ending at `year`/`month` (inclusive),
plus per-month totals and a grand total.

```json
{
  "anchor": { "year": 2026, "month": 10 },
  "months": [
    {
      "year": 2026,
      "month": 10,
      "label": "October 2026",
      "totalAllocated": { "amountPaisa": 1680000, "amountFormatted": "৳16800.00" },
      "teachers": [
        {
          "teacherId": 42,
          "fullName": "Dr. Ahsan Karim",
          "allocated": { "amountPaisa": 280000, "amountFormatted": "৳2800.00" }
        }
      ]
    }
  ],
  "grandTotal": { "amountPaisa": 8400000, "amountFormatted": "৳84000.00" }
}
```

### `POST /api/staff/budget-periods` (legacy)

**Auth:** `ADMIN`, or `STAFF` with `budgets:allocate`.

Creates a legacy budget period from `name`, `startsOn`, and `endsOn` business
dates. Rejects a duplicate name or overlapping dates with `409`. Retained for
backward compatibility; the monthly planning UI does not use it.

### `POST /api/staff/budgets/allocations`

**Auth:** `ADMIN`, or `STAFF` with `budgets:allocate`.

```json
{
  "teacherId": 42,
  "year": 2026,
  "month": 10,
  "amountPaisa": 280000,
  "reason": "monthly allocation"
}
```

Creates the monthly allocation and its matching positive ledger entry in one
transaction. `409 DUPLICATE_ALLOCATION` if the teacher already has one for that
calendar month (use the adjustment endpoint to change it).

### `POST /api/staff/budgets/adjustments`

**Auth:** `ADMIN`, or `STAFF` with `budgets:adjust`.

```json
{ "teacherId": 42, "year": 2026, "month": 10, "amountPaisa": -5000, "reason": "correction" }
```

`year`/`month` default to the current Dhaka month when omitted. `amountPaisa`
must be a non-zero signed integer (negative to decrease the budget). `reason`
is required. Written as a signed `adjustment` ledger entry against that month.

### `GET /api/staff/budgets/ledger?teacherId=<id>&year=2026&month=10`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

Ledger entries for one teacher and calendar month, newest first. `year`/`month`
default to the current Dhaka month; `teacherId` is required and `404`s when the
teacher does not exist. Supports `page` (default `1`) and `perPage` (default
`20`, maximum `100`). The response includes `meta.total`, `meta.page`, and
`meta.perPage`.

### `GET /api/staff/budget-requests?status=pending&teacherId=42`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`.

Review inbox of teacher budget requests, newest first. Both filters are
optional; `status` must be `pending`, `approved` or `rejected` when present.

### `POST /api/staff/budget-requests/:id/decision`

**Auth:** `ADMIN`, or `STAFF` with `budgets:adjust`.

Body: `{ "decision": "approved" | "rejected", "note": "optional text" }`.
Only pending requests can be decided; deciding again returns `400`. Approving a
`budget_increase` request writes a positive `adjustment` ledger entry for the
teacher's current Dhaka month; approving a `debt_allowance` request raises
that teacher's personal `debt_allowance_paisa`, which the order-placement
debt check adds on top of the global `max_debt_paisa` policy. Both decisions
are recorded in the audit trail.

### `GET /api/staff/menu-items`

**Auth:** `ADMIN`, or `STAFF` with `menu_items:manage`.

Returns all menu items for the management screen, including inactive or
currently unavailable items, with their location ID/name and the real persisted
price/status fields.

### `POST /api/staff/menu-items`

**Auth:** `ADMIN`, or `STAFF` with `menu_items:manage`.

Creates a menu item for an active location. `isAvailable` defaults to `true`.

```json
{
  "foodLocationId": 1,
  "name": "Vegetable Meal",
  "description": "Rice, vegetables, and dal",
  "category": "lunch",
  "pricePaisa": 9000,
  "isAvailable": true
}
```

### `PATCH /api/staff/menu-items/:id`

**Auth:** `ADMIN`, or `STAFF` with `menu_items:manage`.

Partial update. Supports `foodLocationId`, `name`, `description`, `category`,
`pricePaisa`, `isAvailable`, and `isActive`. Setting `isActive` to `false` is
soft deactivation; setting it to `true` reactivates the item.

### `DELETE /api/staff/menu-items/:id`

**Auth:** `ADMIN`, or `STAFF` with `menu_items:manage`.

Soft-deactivates the item. Historical orders keep their price and name snapshots
regardless of menu changes.

### `GET /api/staff/users`

**Auth:** `ADMIN`, or `STAFF` with `users:manage`.

Returns a safe user directory for authorized management. Password hashes,
token versions, and other authentication secrets are never included.

### `GET /api/staff/teachers`

**Auth:** `ADMIN`, or `STAFF` with `budgets:view`, `budgets:allocate`, or `budgets:adjust`.

Returns active teacher IDs, names, and email addresses for budget allocation
and teacher-ledger selection. Other roles cannot use this endpoint.

### `PATCH /api/staff/users/:id`

**Auth:** `ADMIN`, or `STAFF` with `users:manage`.

Accepts any of `isActive`, `role`, and `permissions`. `ADMIN` can change all
three fields. Staff with `users:manage` may only activate or deactivate teacher
accounts. Every change revokes the user's active sessions and increments
`token_version`. Changes are audited. The last active administrator cannot be
deactivated or changed to another role.

```json
{ "isActive": false }
```

### `GET /api/staff/settings`, `PATCH /api/staff/settings/:key`

**Auth:** `ADMIN`, or `STAFF` with `settings:manage`.

The read endpoint returns the supported settings with their descriptions and
last update metadata. Update with `{ "value": ... }`. Supported keys and values:

- `order_placement_deadline`: 24-hour `HH:mm` JSON string, such as `"12:30"`.
  Latest Dhaka clock time a teacher may place an order.
- `order_cancellation_deadline`: 24-hour `HH:mm` JSON string. Latest Dhaka clock
  time an order may be cancelled.
- `negative_balance_allowed`: boolean. Whether a teacher may place orders that
  push their remaining monthly balance below zero.
- `max_debt_paisa`: non-negative integer. Maximum permitted outstanding debt in
  paisa when negative balance is allowed; `0` means no debt permitted.
- `max_additional_orders`: non-negative integer. Additional orders a teacher may
  place beyond their balance when debt is allowed.

Each update is written to the audit log in the same transaction as the setting.
Deadlines are evaluated in `Asia/Dhaka`. Unspent monthly budget balances roll
forward automatically as part of the monthly balance calculation (see
`GET /api/staff/budgets/monthly`); there is no rollover setting.

## System

### `GET /health`

Unauthenticated liveness and readiness check. Reports database connectivity.
Returns `503` if the database is unreachable. Never exposes connection strings,
credentials, or internal error text.
