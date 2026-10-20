# Business Policies

The confirmed rules of the system, the assumptions made where the department has
not yet decided, and the questions that remain open.

> **সংক্ষিপ্ত:** এখানে সিস্টেমের নিয়মগুলো, যেসব বিষয়ে এখনো সিদ্ধান্ত নেওয়া
> হয়নি তার অনুমান, এবং উন্মুক্ত প্রশ্নগুলো লেখা আছে।

## Confirmed policies

These decisions are settled. Code and interface both enforce them.

### P1 — Ordering cutoff

- The daily ordering cutoff is **12:00 PM `Asia/Dhaka`**.
- The backend enforces the cutoff. A request that arrives after it is rejected
  even if the browser thought ordering was still open.
- After the cutoff, a teacher cannot create, modify, or cancel an order for that
  date.
- The cutoff time is stored in `app_settings` and is changeable without a
  deployment.
- Staff can disable ordering for a specific date, for a holiday or a vendor
  closure.

### P2 — Orders per day

- A teacher may place **multiple orders per day**.
- Each order contains items from **exactly one food location**. An order that
  spans two restaurants is rejected.
- This keeps each order attributable to a single vendor, which is what makes the
  collection sheet and the vendor handover unambiguous.

### P3 — Cancellation and refund

- A teacher may **cancel their own order before the cutoff**.
- Cancellation before the cutoff **refunds the full amount** to the budget for
  that period and writes a matching ledger entry.
- **After the cutoff only staff may cancel**, and only a staff account holding
  the cancellation permission. The cancellation requires a reason, and the
  actor, timestamp, and reason are recorded.
- A cancelled order is retained for reporting. It is never deleted.

### P4 — Budget

- Budget is organised into **periods**. The default is one period per calendar
  week; the schema also supports other period lengths.
- A teacher has at most **one allocation per period**. A repeat allocation from
  the same actor is rejected; a change must be recorded as an explicit
  adjustment with a reason.
- **Unused funds do not roll over** to the next period. This is the current
  default and is configurable in `app_settings`.
- The budget **ledger is the source of truth**. Balances are computed from it.
  No code path overwrites a balance.
- Every allocation, debit, refund, and adjustment produces a ledger row.

### P5 — Roles and permissions

Three roles exist.

| Role      | Purpose                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `TEACHER` | Orders meals for themselves and views their own budget and history                 |
| `STAFF`   | Views all orders, runs collection and delivery, prints collection sheets           |
| `ADMIN`   | Full access, including user management, budget allocation, and menu administration |

Role grants broad access. **Permissions** grant specific capabilities, so a
`STAFF` account can be limited to collection work without being able to allocate
budgets or edit menus. Least privilege is the default. The full permission list
lives in `shared/src/index.ts` and is enforced by `server/src/middleware/auth.ts`.

### P6 — Authorisation boundary

- A teacher may only read and modify **their own** orders and budget records. A
  request that names another teacher's id is rejected, not silently ignored.
- Staff-only endpoints reject teacher accounts.
- Menu and budget administration is permission-gated on the server. Hiding a
  control in the user interface is not access control.
- Staff with `users:manage` may only activate or deactivate teacher accounts;
  role and permission changes are administrator-only. Every account change
  revokes active sessions, and the last active administrator cannot be removed.

### P7 — Prices and history

- Prices are stored as **integer paisa**. Floating-point arithmetic is never
  used for money.
- The **server** calculates order totals, using current database prices. The
  client-supplied total is ignored even if present.
- Each order item stores a **snapshot** of the item name and unit price, so a
  later menu price change never rewrites a historical order.

### P8 — Record retention

- Locations and menu items are **soft deactivated** (`is_active = false`). They
  are never hard-deleted, because historical orders reference them.
- Orders, order items, ledger entries, and audit rows are **never deleted**.
- Deleting financial or audit records is not a supported operation at any
  permission level.

## Assumptions pending department confirmation

Each of these is implemented as a configurable default so the rule can be changed
without a schema migration.

| #   | Assumption                                                       | Default                            | Configurable                                                                                 |
| --- | ---------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| A1  | Weekly budget is a single fixed amount for all teachers          | ৳700 per week                      | Yes, per teacher via allocation                                                              |
| A2  | Unspent budget does not roll over                                | No rollover                        | `app_settings`; enabled rollover credits positive prior-period balances into the next period |
| A3  | "Cafeteria" and "Central Cafeteria" are the same vendor          | One location                       | Seed data; splittable                                                                        |
| A4  | One allocation covers the whole period                           | Whole period                       | Yes                                                                                          |
| A5  | Orders may be cancelled any time before 12:00 PM                 | Yes                                | `app_settings`                                                                               |
| A6  | Only weekday lunches are collected                               | No weekend or holiday handling yet | Ordering can be disabled per date                                                            |
| A7  | Teachers are created by an admin, not self-registered            | Admin-created                      | Public registration in dev/test only                                                         |
| A8  | A teacher may order from any location, not one assigned location | Any location                       | Not yet enforced                                                                             |

## Open questions for the department

These need a decision from the department. Each one is recorded here so it is not
silently resolved in code.

1. **Budget amount.** What is the approved weekly budget, and can it differ per
   teacher?
2. **Rollover.** If a teacher does not spend the full weekly budget, does it
   carry forward, expire, or accumulate as a credit?
3. **Cutoff exceptions.** If the department observes a holiday on a working day,
   should ordering be disabled for that date, or should the cutoff move?
4. **Post-cutoff changes.** Is there any case where a teacher may change an
   order after 12:00 PM? If so, who authorises it?
5. **Staff permissions.** Which named staff may allocate budgets, edit menus,
   and authorise refunds? Should these be separate accounts?
6. **Account creation.** Should teachers set their own password through an
   activation link, or should an administrator create their account?
7. **Authentication.** Should institutional single sign-on replace passwords for
   staff?
8. **Data retention.** How long should teacher order and financial records be
   retained, and who may access them?
9. **Restaurant closure.** How does the system learn that a vendor is closed for
   a day?
10. **Price history.** Should a staff member be able to see the price of an item
    at any past date, rather than only the current price?

## Change control

A policy change requires all three of the following:

1. Update the relevant section of this document.
2. Update the corresponding rule in [development.md](development.md) or
   [database.md](database.md).
3. Update the tests that assert the old behaviour, and add a test that asserts
   the new behaviour.

A policy that is not written here is not implemented. If code and this document
disagree, this document is corrected first, and the discrepancy is treated as a
defect.
