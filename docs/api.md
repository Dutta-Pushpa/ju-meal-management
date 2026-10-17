# API Reference

REST contract for the JU Meal Management System.

> **সংক্ষিপ্ত:** এই ডকুমেন্টে সব API এন্ডপয়েন্ট, তাদের ইনপুট আউটপুট এবং
> উদাহরণ দেওয়া আছে।

> **Status:** `Planned`. This document specifies the contract to be implemented.
> Sample payloads are illustrative of the intended shape. They are replaced with
> captured real responses once each endpoint is built, and an endpoint is marked
> `Verified` in [development.md](development.md#roadmap) only after it matches
> this document.

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
    "message": "Order total exceeds the available budget for this period.",
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

| Code                         | Status | Meaning                                                                 |
| ---------------------------- | ------ | ----------------------------------------------------------------------- |
| `VALIDATION_ERROR`           | 400    | Request failed schema validation                                        |
| `UNAUTHORIZED`               | 401    | No token, or the token is invalid or expired                            |
| `FORBIDDEN`                  | 403    | Role or permission does not allow this action                           |
| `NOT_FOUND`                  | 404    | Resource does not exist or is not visible to the caller                 |
| `EMAIL_ALREADY_EXISTS`       | 409    | Registration or update used an existing email                           |
| `LOCATION_ALREADY_EXISTS`    | 409    | A location with that name already exists                                |
| `LOCATION_HAS_ACTIVE_ORDERS` | 409    | The location has orders in the current period and cannot be deactivated |
| `DUPLICATE_ALLOCATION`       | 409    | The teacher already has an allocation for this period                   |
| `ORDERING_CLOSED`            | 422    | The cutoff for this date has passed                                     |
| `ORDERING_DISABLED`          | 422    | Ordering is disabled for this date, such as a holiday                   |
| `ITEM_UNAVAILABLE`           | 422    | A requested item is inactive or unavailable                             |
| `MIXED_LOCATIONS`            | 422    | An order contained items from more than one location                    |
| `BUDGET_INSUFFICIENT`        | 422    | Order total exceeds the available balance                               |
| `INVALID_STATUS_TRANSITION`  | 422    | The requested status change is not allowed from the current status      |
| `CUTOFF_PASSED`              | 422    | Modification attempted after the cutoff                                 |
| `RATE_LIMITED`               | 429    | Too many requests                                                       |

Returning `404` rather than `403` for a resource belonging to another teacher
prevents an authenticated user from probing for the existence of other
teachers' records.

## Authentication

### `POST /api/auth/register`

Creates a user. Open registration is enabled only in the development and test
profiles. In production this endpoint requires `ADMIN` and the
`users:create` permission.

**Auth:** none in dev/test, `ADMIN` in production.

Request:

```json
{
  "fullName": "A. Teacher",
  "email": "teacher@example.edu",
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
    "email": "teacher@example.edu",
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
{ "email": "teacher@example.edu", "password": "Str0ngPassw0rd!" }
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
      "email": "teacher@example.edu",
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

### `GET /api/teacher/budget?period=<periodId>`

**Auth:** `TEACHER`, `STAFF`, or `ADMIN`.

Returns the signed sums from the ledger for the given period. A `TEACHER` may
only request their own budget; requesting another teacher's id is rejected.

```json
{
  "data": {
    "period": { "id": 12, "name": "2026-W42", "startsOn": "2026-10-12", "endsOn": "2026-10-18" },
    "allocated": { "amountPaisa": 70000, "amountFormatted": "৳700.00" },
    "spent": { "amountPaisa": 45000, "amountFormatted": "৳450.00" },
    "refunded": { "amountPaisa": 5000, "amountFormatted": "৳50.00" },
    "adjusted": { "amountPaisa": 0, "amountFormatted": "৳0.00" },
    "available": { "amountPaisa": 30000, "amountFormatted": "৳300.00" }
  }
}
```

`available` is the sum of the ledger. It is computed, never read from a stored
column.

### `GET /api/teacher/budget/ledger?period=<periodId>`

Paginated ledger entries for the authenticated teacher, newest first.

## Locations and menus

### `GET /api/locations`

**Auth:** any authenticated user.

Returns active locations. Inactive locations are excluded.

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

Deactivating a location that still has orders in the current budget period
returns `409 LOCATION_HAS_ACTIVE_ORDERS`. Both this endpoint and `PATCH` with
`"isActive": false` apply the same guard; neither bypasses it. A location whose
only orders in the period are cancelled, or whose orders fall in a past period,
deactivates normally.

### `GET /api/locations/:id/menu`

Available items for a location, grouped by category.

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

**Auth:** `TEACHER` (or `STAFF` ordering on their own behalf).

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
checkout attempt.

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
| Ordering disabled for that date       | `ORDERING_DISABLED`   | 422                             |
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
`status`, and pagination. A teacher can never retrieve another teacher's
orders through this endpoint or through any parameter.

### `GET /api/orders/mine/:id`

Single order. `404` when the order does not belong to the caller.

### `POST /api/orders/:id/cancel`

**Auth:** the owning teacher before the cutoff, or staff with the
`orders:cancel` permission at any time.

```json
{ "reason": "changed my mind" }
```

`200` returns the cancelled order. The refund appears in the ledger
immediately.

A teacher attempting to cancel after the cutoff receives
`422 CUTOFF_PASSED`. A staff cancellation is recorded in `audit_logs` with the
actor, timestamp, and reason.

## Staff operations

All endpoints in this group reject `TEACHER` with `403 FORBIDDEN`.

### `GET /api/staff/orders?date=YYYY-MM-DD`

All confirmed orders for a date, with `locationId`, `status`, and `teacherId`
filters plus pagination.

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

Orders grouped by food location, with item-level quantity sums. This is the
data source behind the collection sheet.

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

**Auth:** `STAFF` or `ADMIN` with `orders:manage_status`.

```json
{ "status": "COLLECTED", "note": "collected from vendor at 12:40" }
```

Allowed transitions: `CONFIRMED → COLLECTED → DELIVERED`, and
`CONFIRMED → CANCELLED` for a permissioned actor. Any other combination returns
`422 INVALID_STATUS_TRANSITION`.

Each transition appends an `order_status_events` row and an audit entry.

### `PATCH /api/staff/order-items/:id/status`

Item-level collection state, for when parts of an order are collected separately.

### `GET /api/staff/reports/daily?date=YYYY-MM-DD`

Totals by location and the daily total, computed from records.

### `GET /api/staff/reports/budget?period=<periodId>`

Per-teacher allocation, spending, and remaining balance for a period.

## Administration

Every endpoint here requires `ADMIN`, or `STAFF` with the named permission.

### `POST /api/staff/budget-periods`

Creates a budget period. Rejects overlapping periods with `409`.

### `POST /api/staff/budgets/allocations`

```json
{ "teacherId": 42, "budgetPeriodId": 12, "amountPaisa": 70000, "reason": "weekly allocation" }
```

Creates the allocation and its matching positive ledger entry in one
transaction. `409 DUPLICATE_ALLOCATION` if the teacher already has one for that
period.

### `POST /api/staff/budgets/adjustments`

```json
{ "teacherId": 42, "budgetPeriodId": 12, "amountPaisa": -5000, "reason": "correction" }
```

`reason` is required. Written as a signed `adjustment` ledger entry.

### `GET /api/staff/budgets/ledger?teacherId=<id>&period=<id>`

Full ledger for one teacher and period, with pagination.

### `POST /api/staff/menu-items`, `PATCH /api/staff/menu-items/:id`, `DELETE /api/staff/menu-items/:id`

Menu administration. Delete is soft deactivation. Historical orders keep their
price and name snapshots regardless of these changes.

### `PATCH /api/staff/users/:id`

Activates or deactivates a user, changes a role or permissions, or forces a
token revocation by incrementing `token_version`.

### `GET /api/staff/settings`, `PATCH /api/staff/settings/:key`

Reads and updates runtime settings such as `order_cutoff_time` and
`budget_rollover`.

## System

### `GET /health`

Unauthenticated liveness and readiness check. Reports database connectivity.
Returns `503` if the database is unreachable. Never exposes connection strings,
credentials, or internal error text.
