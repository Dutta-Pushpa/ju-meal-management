# Database Reference

Schema design, conventions, and the migration process.

> **সংক্ষিপ্ত:** এখানে ডেটাবেসের সব টেবিল, কলাম, সম্পর্ক, এবং নিয়মগুলো লেখা আছে।

## Conventions

| Concern | Rule |
| --- | --- |
| Money | `bigint` holding integer paisa. ৳1 = 100 paisa. Never `float` or `numeric` with a scale for arithmetic |
| Timestamps | `timestamptz`, written in UTC |
| Business dates | `date`, holding the `Asia/Dhaka` calendar day |
| Primary keys | `bigserial` for entities, `uuid` for sessions |
| Naming | `snake_case` tables and columns; `created_at` / `updated_at` on every mutable table |
| Soft deletion | `is_active boolean` on locations and menu items. Historical tables are never deleted |
| Enumerations | `text` with a `CHECK` constraint. No native PostgreSQL enum types, so adding a value is not a migration hazard |
| Deletion of financial data | Not supported at any permission level |

## Entity relationships

```mermaid
erDiagram
    users ||--o{ budget_allocations : receives
    users ||--o{ budget_ledger : "owns"
    users ||--o{ orders : places
    users ||--o{ sessions : holds
    budget_periods ||--o{ budget_allocations : "allocated in"
    budget_periods ||--o{ budget_ledger : "booked in"
    budget_ledger }o--o| orders : references
    food_locations ||--o{ menu_items : offers
    food_locations ||--o{ orders : "ordered from"
    orders ||--|{ order_items : contains
    orders ||--o{ order_status_events : logs
    order_items ||--o{ order_status_events : logs
    users ||--o{ audit_logs : acts

    users {
        bigserial id PK
        text full_name
        text email UK
        text password_hash
        text role
        text permissions "JSON array, empty for TEACHER"
        boolean is_active
        integer token_version
        timestamptz created_at
        timestamptz updated_at
    }
    food_locations {
        bigserial id PK
        text name UK
        text name_bn
        text description
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    menu_items {
        bigserial id PK
        bigint food_location_id FK
        text name
        text description
        text category
        bigint price_paisa
        boolean is_available
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    budget_periods {
        bigserial id PK
        text name
        date starts_on
        date ends_on
        boolean is_active
        timestamptz created_at
    }
    budget_allocations {
        bigserial id PK
        bigint teacher_id FK
        bigint budget_period_id FK
        bigint amount_paisa
        bigint created_by FK
        timestamptz created_at
    }
    budget_ledger {
        bigserial id PK
        bigint teacher_id FK
        bigint budget_period_id FK
        text entry_type
        bigint amount_paisa "signed"
        bigint order_id FK "nullable"
        text reason
        bigint created_by FK
        timestamptz created_at
    }
    orders {
        bigserial id PK
        bigint teacher_id FK
        bigint food_location_id FK
        date order_date
        text status
        bigint total_paisa
        text idempotency_key
        timestamptz confirmed_at
        timestamptz cancelled_at
        timestamptz created_at
        timestamptz updated_at
    }
    order_items {
        bigserial id PK
        bigint order_id FK
        bigint menu_item_id FK "nullable"
        text item_name_snapshot
        bigint unit_price_paisa_snapshot
        integer quantity
        bigint line_total_paisa
        text status
        timestamptz created_at
    }
    order_status_events {
        bigserial id PK
        bigint order_id FK
        bigint order_item_id FK "nullable"
        text old_status
        text new_status
        bigint changed_by FK
        text note
        timestamptz created_at
    }
```

## Tables

### `users`

Every teacher, staff member, and administrator.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `full_name` | `text` | Required |
| `email` | `text` | Required, **unique**, stored lower-cased |
| `password_hash` | `text` | bcrypt hash, always with the `$2b$` prefix. Plaintext is never stored or logged |
| `role` | `text` | `TEACHER`, `STAFF`, or `ADMIN`, enforced by a `CHECK` constraint |
| `permissions` | `jsonb` | Array of granted permission strings. Always `[]` for `TEACHER` |
| `is_active` | `boolean` | A deactivated user cannot log in and their tokens stop working |
| `token_version` | `integer` | Embedded in every JWT. Incrementing it revokes all of that user's tokens |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: unique on `email`, index on `role` for staff listings.

### `sessions`

Login audit trail and refresh-token storage. The primary authentication
mechanism is the JWT; this table records logins and supports revocation.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `bigint` | Foreign key to `users`, `ON DELETE CASCADE` |
| `token_version` | `integer` | Value at issue time. A mismatch invalidates the session |
| `ip_address` | `inet` | Recorded for abuse investigation |
| `user_agent` | `text` | |
| `expires_at` | `timestamptz` | |
| `revoked_at` | `timestamptz` | Nullable. Set on logout |
| `created_at` | `timestamptz` | |

### `food_locations`

Participating vendors. The CRUD demonstration entity for this project.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `name` | `text` | Required, unique |
| `name_bn` | `text` | Bengali display name |
| `description` | `text` | |
| `is_active` | `boolean` | Soft deactivation. Never hard-deleted |
| `created_at` / `updated_at` | `timestamptz` | |

### `menu_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `food_location_id` | `bigint` | Foreign key, `ON DELETE RESTRICT` |
| `name` | `text` | Required |
| `description` | `text` | |
| `category` | `text` | Optional grouping such as `lunch` or `snack` |
| `price_paisa` | `bigint` | `CHECK (price_paisa > 0)` |
| `is_available` | `boolean` | Orderable right now |
| `is_active` | `boolean` | Soft deactivation |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `(food_location_id, is_available)` for menu browsing.

### `budget_periods`

A budget window. Weekly by default; the table supports any window.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `name` | `text` | Display label, for example `2026-W42` |
| `starts_on` | `date` | `CHECK (ends_on >= starts_on)` |
| `ends_on` | `date` | |
| `is_active` | `boolean` | |
| `created_at` | `timestamptz` | |

Periods must not overlap. Enforced by an exclusion constraint using `daterange`.

### `budget_allocations`

The intended amount for a teacher in a period.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `teacher_id` | `bigint` | Foreign key to `users` |
| `budget_period_id` | `bigint` | Foreign key to `budget_periods` |
| `amount_paisa` | `bigint` | `CHECK (amount_paisa >= 0)` |
| `created_by` | `bigint` | Foreign key to `users`, the allocating staff member |
| `created_at` | `timestamptz` | |

**Unique constraint** on `(teacher_id, budget_period_id)`. This is what enforces
policy P4: a duplicate allocation is rejected, and changing an amount requires
an explicit adjustment with a reason.

### `budget_ledger`

Append-only. Every financial movement for every teacher. **This table is the
source of truth for balances.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `teacher_id` | `bigint` | Foreign key to `users` |
| `budget_period_id` | `bigint` | Foreign key to `budget_periods` |
| `entry_type` | `text` | `allocation`, `debit`, `refund`, or `adjustment` |
| `amount_paisa` | `bigint` | **Signed.** Credits positive, debits negative |
| `order_id` | `bigint` | Nullable foreign key to `orders` |
| `reason` | `text` | Required for `adjustment` and for staff refunds |
| `created_by` | `bigint` | Foreign key to `users` |
| `created_at` | `timestamptz` | |

**Sign convention.** Credits are positive, debits are negative. Available
balance for a teacher in a period is:

```sql
SELECT COALESCE(SUM(amount_paisa), 0)
FROM budget_ledger
WHERE teacher_id = $1 AND budget_period_id = $2;
```

There is deliberately **no stored balance column**. A mutable balance can drift
from the ledger through a single missed write; a `SUM` cannot. The ledger is
append-only and rows are never updated or deleted.

### `orders`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `teacher_id` | `bigint` | Foreign key to `users` |
| `food_location_id` | `bigint` | Foreign key. One location per order, per policy P2 |
| `order_date` | `date` | The `Asia/Dhaka` business date |
| `status` | `text` | `CONFIRMED`, `COLLECTED`, `DELIVERED`, `CANCELLED` |
| `total_paisa` | `bigint` | Server-calculated |
| `idempotency_key` | `text` | Nullable |
| `confirmed_at` | `timestamptz` | |
| `cancelled_at` | `timestamptz` | Nullable |
| `created_at` / `updated_at` | `timestamptz` | |

**Unique constraint** on `(teacher_id, idempotency_key)` where the key is not
null. This is what prevents a double-click or a network retry from creating two
orders and two debits. The client generates the key once per checkout attempt.

Indexes: `(order_date, status)` for the staff daily view, `(teacher_id,
order_date)` for teacher history.

### `order_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `order_id` | `bigint` | Foreign key, `ON DELETE CASCADE` |
| `menu_item_id` | `bigint` | Nullable foreign key. Retained even if the item is deactivated |
| `item_name_snapshot` | `text` | Name at the time of ordering |
| `unit_price_paisa_snapshot` | `bigint` | Price at the time of ordering |
| `quantity` | `integer` | `CHECK (quantity > 0)` |
| `line_total_paisa` | `bigint` | `unit_price_paisa_snapshot * quantity` |
| `status` | `text` | Item-level collection state |
| `notes` | `text` | |
| `created_at` | `timestamptz` | |

The two snapshot columns satisfy policy P7. A later menu price change must not
rewrite history, so nothing in the reporting path ever joins back to
`menu_items.price_paisa` to recompute a historical total.

### `order_status_events`

Append-only history of every status transition, at order level or item level.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `order_id` | `bigint` | Foreign key to `orders` |
| `order_item_id` | `bigint` | Nullable foreign key to `order_items` |
| `old_status` | `text` | Nullable for the first transition |
| `new_status` | `text` | |
| `changed_by` | `bigint` | Foreign key to `users` |
| `note` | `text` | |
| `created_at` | `timestamptz` | |

### `audit_logs`

Administrative actions outside ordinary order flow.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key |
| `actor_user_id` | `bigint` | Nullable foreign key to `users` |
| `action` | `text` | For example `budget.allocation.created`, `menu_item.price.updated` |
| `entity_type` | `text` | |
| `entity_id` | `bigint` | Nullable |
| `metadata` | `jsonb` | Must never contain passwords, hashes, or tokens |
| `created_at` | `timestamptz` | |

### `app_settings`

Configuration that staff may change without a deployment.

| Column | Type | Notes |
| --- | --- | --- |
| `key` | `text` | Primary key |
| `value` | `jsonb` | |
| `description` | `text` | |
| `updated_by` | `bigint` | Nullable foreign key to `users` |
| `updated_at` | `timestamptz` | |

Seeded keys: `order_cutoff_time` (default `12:00`), `budget_rollover` (default
`false`), `timezone` (default `Asia/Dhaka`), `ordering_disabled_dates`.

## Transaction boundaries

Two operations must be atomic. If either half fails, both roll back, so an order
can never exist without its ledger debit, and a debit can never exist without its
order.

**Order creation** runs at `SERIALIZABLE` isolation:

1. Begin transaction.
2. `SELECT ... FROM users WHERE id = $1 FOR UPDATE` — lock the teacher row. This
   serialises concurrent orders by the same teacher so two simultaneous requests
   cannot both read the same balance and both succeed.
3. Check ordering is open for the date and the cutoff has not passed.
4. Load the requested menu items and verify availability, active state, and
   quantity bounds.
5. Calculate the total from database prices.
6. Sum the ledger for the teacher's period and verify sufficient balance.
7. Insert the order, insert the order items, insert the ledger debit.
8. Commit.

**Cancellation** opens a transaction, marks the order cancelled, inserts the
matching positive ledger refund, and appends a status event.

## Migration runner

There is no ORM, so `db/migrate.ts` implements migrations directly.

- Migrations are numbered SQL files in `db/migrations/`, applied in filename
  order. `0001_initial_schema.sql`, `0002_...`, and so on.
- Each file runs inside a transaction and is recorded in `schema_migrations`
  with a checksum.
- A **PostgreSQL advisory lock** is held for the duration of the run, so two
  concurrent deployments cannot apply migrations simultaneously.
- On start-up the runner verifies that every applied migration's checksum still
  matches its file. A mismatch means an already-applied migration was edited,
  which is a hard failure rather than a silent drift.
- `db:migrate` applies pending migrations. `db:migrate:status` reports what has
  and has not been applied without changing anything.

Editing a migration that has already been applied is not permitted. Add a new
migration instead.

## Seed data

`db/seed.sql` loads fictional demonstration data and is safe to run repeatedly:
it truncates the demo tables first, so the seed always produces the same result.

It creates two locations, a representative menu with realistic-looking paisa
prices, three budget periods, fictional teacher and staff accounts, and a few
past orders with matching ledger entries so the reports have something to show.

**Every seeded record is fictional.** Restaurant names are illustrative. Prices
are not verified real-world prices and must be confirmed before production use.
No real teacher personal data is ever seeded.