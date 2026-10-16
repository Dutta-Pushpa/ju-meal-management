# JU Meal Management System

## Project Requirements, Workflows, Backend Design, and Website-Build Prompt

**Project:** JU Meal Management System\
**Institution:** Jahangirnagar University (JU), Department of Computer
Science and Engineering (CSE)\
**Primary users:** CSE department teachers and food-collection staff\
**Purpose:** Replace manual meal-order calls and scattered expense
tracking with a centralized website connected to a real backend and
database.

> **Important:** Restaurant names, menu items, prices, teacher records,
> and sample orders in this document are illustrative. Verify
> participating vendors and prices before using them in production. Do
> not seed the production system with real personal information without
> authorization.

------------------------------------------------------------------------

## 1. Project Overview

The JU Meal Management System is a web-based meal ordering and
collection platform for teachers of the JU CSE department. Teachers can
sign in, check their weekly meal budget, browse menus from participating
campus food locations, place orders before the daily deadline, and
review their order history and balance.

Staff use a central dashboard to see all confirmed orders, group them by
restaurant, print collection sheets, and track food from collection to
delivery. The backend validates orders, enforces the deadline,
calculates costs, and records every budget transaction.

### Main objectives

-   Reduce the need to call or message each teacher to ask for meal
    choices.
-   Keep each teacher's weekly budget and spending records accurate.
-   Consolidate restaurant-specific orders into easy-to-print collection
    sheets.
-   Make order status and distribution progress visible to authorized
    staff.
-   Provide an auditable record of budgets, orders, cancellations, and
    expenses.

## 2. User Roles and Permissions

The product has **two primary user groups**. Administrative capabilities
can be granted to designated staff accounts; a separate administrator
role is optional and must not complicate the teacher/staff experience.

### 2.1 Client side --- Teachers

Teachers can:

-   Sign in and sign out securely.
-   View their available weekly meal budget and spending summary.
-   Browse participating food locations and their menus.
-   View item descriptions, prices, and availability.
-   Select food items, quantities, and the restaurant/location.
-   Review an order summary before submitting.
-   Confirm an order before 12:00 PM under the configured cutoff policy.
-   View today's order and past orders.
-   View order totals, order statuses, and remaining budget.
-   Cancel or edit an order only when the configured policy allows it.
-   See clear messages when the deadline has passed or an item is
    unavailable.

Teachers must not be able to see other teachers' private order histories
or change their own budget records.

### 2.2 Staff side --- Food collection and distribution

Authorized staff can:

-   Sign in to a protected staff dashboard.
-   View all teachers' confirmed orders for a selected date.
-   See teacher name, item, quantity, restaurant, total, and order
    status.
-   Filter orders by date, restaurant, teacher, or status.
-   Group orders by food location automatically.
-   View item-level quantities to help verify restaurant orders.
-   Print or export a clean collection sheet.
-   Mark orders or individual collection tasks as **Pending**,
    **Collected**, or **Delivered**.
-   Review daily totals by restaurant and the total daily cost.
-   Review order and collection history.
-   Manage menus, prices, locations, and item availability if granted
    menu-management permission.
-   Allocate weekly budgets and inspect the budget ledger if granted
    budget-management permission.

Staff permissions should follow least privilege. A staff member who only
collects meals should not automatically be able to change budget
allocations.

------------------------------------------------------------------------

## 3. Food Locations and Menu Management

Each food location has its own menu, prices, and availability. The list
must be editable by authorized staff so new vendors can be added without
changing application code.

### Initial illustrative locations

1.  **Bot Tola (বটতলা)** --- Traditional Bengali meals such as rice,
    fish, chicken, beef, khichuri, polao, and bhorta.
2.  **Central Cafeteria (কেন্দ্রীয় ক্যাফেটেরিয়া)** --- Affordable meals,
    khichuri, polao, breakfast items, regular meals, and snacks.
3.  **Chottor (চত্বর)** --- Participating campus stalls; menu to be
    entered by authorized staff.
4.  **Cafeteria** --- Keep as a separate location only if it is
    operationally different from Central Cafeteria.
5.  **Tasty Treat** --- Bakery and fast-food products such as cakes,
    pastries, sandwiches, and other available items.
6.  **Other participating restaurants** --- Staff can add more locations
    at any time.

### Menu requirements

Every menu item should contain:

-   Item name
-   Description (optional)
-   Food location
-   Price in Bangladeshi taka (BDT / ৳)
-   Availability status
-   Optional category and image
-   Created/updated timestamps

Store prices as a precise decimal or integer number of paisa---not
floating-point values. When an order is placed, save a snapshot of the
item name and unit price in the order item so later menu price changes
do not rewrite historical orders.

------------------------------------------------------------------------

## 4. Core Workflows

### Workflow A --- Weekly budget allocation

1.  An authorized staff member selects the week and teacher.
2.  Staff enter the weekly budget amount.
3.  The backend validates the amount and records the allocation.
4.  The teacher's account displays the available balance and the week
    covered.
5.  Every spend, refund, adjustment, or allocation is stored in a budget
    ledger.
6.  The system prevents duplicate allocations for the same teacher and
    week unless an authorized adjustment is made.

**Recommended accounting rule:** Use a ledger as the auditable source of
truth. Do not simply overwrite a balance without recording why it
changed. Define whether unused funds roll over to the next week; the
initial default should be **no rollover unless the department approves
otherwise**.

### Workflow B --- Teacher places an order

1.  Teacher signs in.
2.  The website shows the current week's budget and today's order
    deadline.
3.  Teacher chooses a food location.
4.  Teacher browses available menu items and selects quantities.
5.  The frontend displays a live order summary and estimated total.
6.  Teacher submits the order for server-side validation.
7.  The backend checks authentication, item availability, valid
    quantities, the cutoff time, and available budget.
8.  The backend calculates the authoritative total using current
    database prices.
9.  In a single database transaction, it creates the order and order
    items and records the budget debit/reservation.
10. The teacher sees a confirmation and can view the order in their
    history.

The frontend must never be trusted to supply the final price or balance.
The server calculates both.

### Workflow C --- Noon cutoff

-   The daily deadline is **12:00 PM Bangladesh time (Asia/Dhaka)** by
    default.
-   The backend---not only the browser---must enforce the deadline.
-   The policy must specify whether a teacher can edit or cancel a
    confirmed order before noon.
-   After noon, normal teacher changes are blocked and the day's
    confirmed order list is locked.
-   Authorized staff may have a controlled exception process; every
    exception must record who made it, when, and why.
-   The UI should show the deadline and clearly explain when ordering
    has closed.
-   Store timestamps consistently (preferably UTC in the database) and
    display them in Asia/Dhaka time.

**Open policy decision:** If the deadline falls on a university holiday
or a restaurant is closed, staff should be able to disable ordering for
that date or configure a different cutoff.

### Workflow D --- Staff creates the collection sheet

1.  Staff signs in and chooses a date.
2.  The dashboard loads the confirmed orders for that date.
3.  The system groups orders by restaurant/location.
4.  Staff can inspect teacher-level orders and item-level totals.
5.  Staff prints a collection sheet for each restaurant and a daily
    summary.
6.  The sheet includes restaurant name, date, item, total quantity,
    teacher/order references, and relevant notes.
7.  Staff collect the meals and update the appropriate status.
8.  Staff distribute the meals and mark them delivered.

### Workflow E --- Collection and delivery tracking

Suggested statuses:

-   **Confirmed** --- The order has been accepted by the system.
-   **Collected** --- Staff have collected the food from the vendor.
-   **Delivered** --- The food has been handed to the teacher.
-   **Cancelled** --- The order was cancelled under the configured
    policy.

If different items in one order can be collected or delivered
separately, track status at the order-item level as well as the overall
order level. Record status changes with actor, timestamp, and optional
note.

### Workflow F --- Menu and location administration

1.  Authorized staff opens menu management.
2.  Staff adds or edits a location or menu item.
3.  Staff updates price and availability.
4.  The backend validates and saves the changes.
5.  New orders use the updated price.
6.  Existing orders retain their original item-name and unit-price
    snapshots.

### Workflow G --- Budget and expense reporting

Staff with permission can review:

-   Weekly allocations per teacher
-   Order spending per teacher
-   Remaining balances
-   Daily order totals
-   Totals by restaurant
-   Cancelled orders and refunds
-   Manual adjustments with reasons
-   Collection and delivery completion

Reports must be calculated from persisted records, not hard-coded sample
values.

------------------------------------------------------------------------

## 5. Example Staff Dashboard and Collection Summary

The following is **illustrative sample data only**.

  Teacher                     Food order           Collection location     Total
  --------------------------- -------------------- --------------------- -------
  Dr. Jugal Krishna Das       Rice, fish, bhorta   Bot Tola                 ৳180
  Dr. Mohammad Shorif Uddin   Chicken meal         Central Cafeteria        ৳150
  Dr. Liton Jude Rozario      Khichuri, egg        Chottor                  ৳100
  Sarnali Basak               Sandwich, pastry     Tasty Treat              ৳160
  Md. Masum Bhuiyan           Rice, chicken        Bot Tola                 ৳140

### Grouped collection totals

  Location              Teachers / orders      Total
  ------------------- ------------------- ----------
  Bot Tola                              2       ৳320
  Central Cafeteria                     1       ৳150
  Chottor                               1       ৳100
  Tasty Treat                           1       ৳160
  **Daily total**                   **5**   **৳730**

The real system must calculate these numbers from the selected day's
confirmed orders. Never hard-code these example teachers or totals into
production logic.

### Print sheet requirements

-   Clear date and cutoff status
-   Restaurant/location heading
-   Item-level quantity summary
-   Teacher names and their order details
-   Total per restaurant and total across all restaurants
-   Collection and delivery checkboxes or status fields
-   Printer-friendly styling with no navigation bars or unnecessary
    controls
-   A generated-at timestamp and staff member's name/ID

------------------------------------------------------------------------

## 6. Business Rules and Validation

1.  Only authenticated, authorized users may access protected pages and
    API routes.
2.  There are two primary user groups: teachers and staff.
3.  Teachers can read and modify only their own orders and permitted
    profile information.
4.  Staff access must be permission-based.
5.  The server calculates totals and validates all prices and
    quantities.
6.  An order must not exceed the teacher's available budget.
7.  Budget debit and order creation must be atomic; a partial failure
    must not leave an order without the corresponding ledger entry or
    vice versa.
8.  Prevent duplicate submissions caused by double-clicking or network
    retries, using an idempotency strategy where appropriate.
9.  Enforce the 12:00 PM cutoff on the server in Asia/Dhaka time.
10. The system must define cancellation, refund, late-order, and
    exception rules before production use.
11. Preserve historical prices and item names in each order.
12. Record budget allocations, spending, refunds, manual adjustments,
    and staff actions in an audit trail.
13. Use soft deactivation for locations or menu items that appear in
    historical orders; do not delete historical financial records.
14. Validate all input on the backend and use parameterized queries or a
    safe ORM.
15. Never store plaintext passwords or expose secrets in frontend code.
16. Do not use real teacher data or production credentials in demo
    fixtures or public repositories.

------------------------------------------------------------------------

## 7. Recommended Technical Architecture

Choose a maintainable full-stack architecture. One practical option:

-   **Frontend:** React + TypeScript + Vite
-   **UI:** Responsive component system with accessible forms, tables,
    dialogs, and loading/error states
-   **Backend:** Node.js + Express + TypeScript
-   **Database:** PostgreSQL
-   **Database access:** Prisma ORM (or an equivalent migration-capable
    ORM)
-   **Authentication:** Secure server-managed sessions in HTTP-only,
    Secure, SameSite cookies, or a carefully configured equivalent
-   **Validation:** Zod or equivalent request validation
-   **Testing:** Unit tests, API integration tests, and end-to-end tests
-   **Deployment:** Environment-based configuration, HTTPS, database
    migrations, backups, and structured logs

A different stack is acceptable if the developer has a strong reason,
but the frontend, backend, and database must be genuinely connected. Do
not substitute localStorage or hard-coded arrays for a backend database.

### High-level architecture

``` text
Teacher / Staff Browser
        |
        | HTTPS
        v
React Frontend
        |
        | REST API + authenticated session
        v
Express Backend
  | Authentication / Authorization
  | Order + Deadline Validation
  | Budget Ledger + Transactions
  | Menu + Collection Services
  | Audit Logging
        |
        v
PostgreSQL Database
```

------------------------------------------------------------------------

## 8. Suggested Database Design

Use normalized relational tables with foreign keys, constraints,
indexes, and migrations. Adapt field names as needed.

### `users`

-   `id` --- primary key
-   `full_name`
-   `email` --- unique
-   `password_hash` or external identity reference
-   `role` --- `TEACHER` or `STAFF`
-   `is_active`
-   `created_at`, `updated_at`

Optional staff permissions may be represented by a separate permission
table or a carefully defined staff permission model.

### `food_locations`

-   `id`
-   `name`
-   `description`
-   `is_active`
-   `created_at`, `updated_at`

### `menu_items`

-   `id`
-   `food_location_id` --- foreign key
-   `name`
-   `description`
-   `category`
-   `price_paisa` --- integer
-   `is_available`
-   `created_at`, `updated_at`

### `budget_periods`

-   `id`
-   `starts_on`
-   `ends_on`
-   `name` or week label
-   `created_by`
-   Unique/validation rules to prevent overlapping or duplicate periods
    where inappropriate

### `budget_ledger`

-   `id`
-   `teacher_id` --- user foreign key
-   `budget_period_id`
-   `entry_type` --- allocation, debit, refund, adjustment
-   `amount_paisa` --- signed integer or a clearly defined positive
    amount plus direction
-   `related_order_id` --- nullable foreign key
-   `reason`
-   `created_by`
-   `created_at`

Define the sign convention and balance calculation consistently. The
available balance is derived from valid ledger entries for the relevant
budget period, or maintained as a transactionally updated balance with
the ledger retained as the audit source.

### `orders`

-   `id`
-   `teacher_id`
-   `order_date`
-   `status`
-   `total_paisa`
-   `confirmed_at`
-   `created_at`, `updated_at`
-   Optional idempotency key or request identifier

### `order_items`

-   `id`
-   `order_id`
-   `menu_item_id`
-   `item_name_snapshot`
-   `unit_price_paisa_snapshot`
-   `quantity`
-   `line_total_paisa`
-   `status` if item-level collection tracking is required
-   Optional notes

### `order_status_events`

-   `id`
-   `order_id` and optional `order_item_id`
-   `old_status`
-   `new_status`
-   `changed_by`
-   `note`
-   `created_at`

### `audit_logs`

-   `id`
-   `actor_user_id`
-   `action`
-   `entity_type`
-   `entity_id`
-   `metadata` with sensitive data excluded
-   `created_at`

Use foreign keys and indexes for frequently filtered fields such as
order date, teacher, status, and food location. Add database constraints
for valid quantities, positive menu prices where applicable, unique
emails, and valid role/status values.

------------------------------------------------------------------------

## 9. Suggested API Endpoints

Use consistent JSON responses, request validation, authentication
middleware, authorization checks, and clear HTTP status codes.

### Authentication

-   `POST /api/auth/login`
-   `POST /api/auth/logout`
-   `GET /api/auth/me`

### Teacher-facing

-   `GET /api/teacher/me/budget?period=...`
-   `GET /api/locations`
-   `GET /api/locations/:id/menu`
-   `POST /api/orders`
-   `GET /api/orders/mine`
-   `GET /api/orders/mine/:id`
-   `POST /api/orders/:id/cancel` --- only if cancellation policy
    permits

### Staff-facing

-   `GET /api/staff/orders?date=YYYY-MM-DD`
-   `GET /api/staff/orders/grouped-by-location?date=YYYY-MM-DD`
-   `PATCH /api/staff/orders/:id/status`
-   `PATCH /api/staff/order-items/:id/status` --- if item-level tracking
    is enabled
-   `GET /api/staff/reports/daily?date=YYYY-MM-DD`
-   `GET /api/staff/reports/budget?period=...`

### Menu and budget management (permission-gated)

-   `POST /api/staff/locations`
-   `PATCH /api/staff/locations/:id`
-   `POST /api/staff/menu-items`
-   `PATCH /api/staff/menu-items/:id`
-   `POST /api/staff/budgets/allocations`
-   `GET /api/staff/budgets/ledger?teacherId=...&period=...`

These are proposed endpoints, not an assertion that they already exist.
Implement only the operations required by the agreed policies.

------------------------------------------------------------------------

## 10. Frontend Pages

### Public / authentication

-   Login page
-   Unauthorized / access-denied page

### Teacher portal

-   Dashboard: weekly budget, remaining balance, today's order, deadline
-   Browse locations
-   Restaurant menu and item selection
-   Order review and confirmation
-   Order history and order detail
-   Budget transaction history

### Staff portal

-   Daily operations dashboard
-   All orders table with date and status filters
-   Grouped-by-restaurant collection view
-   Print collection sheet
-   Order and item status updates
-   Daily expense summary
-   Budget allocation and ledger screens (permission-gated)
-   Restaurant/location and menu management (permission-gated)

### UX requirements

-   Responsive layout for desktop, tablet, and mobile.
-   Accessible form labels and keyboard navigation.
-   Loading, empty, success, and error states.
-   Confirmation before sensitive actions.
-   Clear cutoff countdown/status without relying on it for enforcement.
-   Search, filters, sorting, and pagination for large order lists.
-   Printer-specific layout for collection sheets.
-   Avoid exposing teacher data on public pages.

------------------------------------------------------------------------

## 11. Security, Privacy, and Reliability

-   Hash passwords using a modern password-hashing algorithm if managing
    passwords directly.
-   Use secure cookies, CSRF protection where applicable, rate limiting,
    and login abuse protection.
-   Enforce authorization on the backend for every protected resource.
-   Prevent teachers from changing IDs in requests to access other
    teachers' orders.
-   Validate and normalize all input; escape output where appropriate.
-   Store secrets in environment variables or a secrets manager, never
    in source control.
-   Use HTTPS in deployment.
-   Keep audit logs for budget and status changes without logging
    passwords, session tokens, or unnecessary sensitive data.
-   Use database transactions for order creation, budget debits,
    refunds, and other multi-step financial changes.
-   Add automated database backups and test restoration.
-   Use migrations and a documented seed script with clearly fictional
    demo data.
-   Add monitoring and structured error logs without leaking internal
    details to users.
-   Establish who may access teacher records and how long records are
    retained.

------------------------------------------------------------------------

## 12. Testing and Acceptance Criteria

The project is not complete merely because the pages look correct.
Verify that the complete frontend-backend-database workflow works.

### Authentication and permissions

-   Valid teacher and staff accounts can log in and log out.
-   Unauthenticated users cannot access protected APIs.
-   Teachers cannot view or change other teachers' orders or budgets.
-   Staff-only endpoints reject teacher accounts.
-   Menu and budget management are restricted to authorized staff.

### Ordering and budgets

-   A teacher can browse active locations and available menu items from
    the database.
-   The server calculates order totals from database prices.
-   A successful order creates order and order-item records and a
    matching ledger debit.
-   Insufficient balance prevents the order and creates no partial
    records.
-   Invalid quantities and unavailable items are rejected.
-   Repeated submissions do not create duplicate orders or duplicate
    debits.
-   Menu price changes do not alter historical order snapshots.
-   Orders submitted after the cutoff are rejected by the server.
-   Cancellation/refund behavior follows the approved policy.

### Staff collection

-   Staff can see all confirmed orders for a chosen date.
-   Orders are grouped by location and item quantities are summed
    correctly.
-   Location totals and the daily total match the underlying orders.
-   Status changes persist after refresh and are recorded in the audit
    history.
-   The collection sheet prints legibly and contains the selected date
    and correct totals.

### Budget and reporting

-   Weekly allocations and expenses appear in the ledger.
-   Remaining balance matches the ledger calculation.
-   Refunds and adjustments are traceable.
-   Reports are generated from the database, not static examples.

### Delivery quality

-   Database migrations run on a clean database.
-   Seed data is fictional and repeatable.
-   Automated tests cover cutoff boundaries, concurrent orders, budget
    checks, and permission rules.
-   README explains setup, environment variables, migration, seed,
    tests, and deployment.

------------------------------------------------------------------------

## 13. Implementation Plan

### Phase 1 --- Foundation

-   Confirm cutoff, budget rollover, cancellation, and staff permission
    policies.
-   Create the repository and frontend/backend project structure.
-   Configure PostgreSQL, ORM, migrations, and fictional seed data.
-   Implement login, sessions, roles, and authorization middleware.

### Phase 2 --- Menus and teacher ordering

-   Build food location and menu management.
-   Build teacher dashboard and menu browsing.
-   Implement transactional order creation, budget validation, ledger
    entries, and cutoff enforcement.
-   Build order history and budget history.

### Phase 3 --- Staff operations

-   Build daily order dashboard and filters.
-   Implement grouping by restaurant and item-level totals.
-   Add printable collection sheets.
-   Implement collection and delivery status tracking.

### Phase 4 --- Budget administration and reports

-   Add weekly budget allocation and adjustments.
-   Build budget ledger and daily/weekly reports.
-   Add audit trail and permission-gated administration.

### Phase 5 --- Quality and deployment

-   Add automated tests and security checks.
-   Test concurrent ordering and cutoff boundaries.
-   Add logging, backups, deployment configuration, and documentation.
-   Conduct a pilot with authorized users and verified menus before full
    deployment.

------------------------------------------------------------------------

## 14. Decisions to Confirm Before Production

1.  What is the approved weekly budget per teacher, and can it differ by
    teacher?
2.  Do unused funds roll over to the next week?
3.  Can teachers edit or cancel orders before noon? Are cancellations
    allowed after noon?
4.  Does a teacher place one combined order per day or multiple separate
    orders?
5.  Can one order contain items from multiple restaurants, or should
    each restaurant have a separate order?
6.  Who is allowed to allocate budgets, edit menus, and make refunds?
7.  Are "Cafeteria" and "Central Cafeteria" separate locations?
8.  Are weekends, holidays, and restaurant closure days treated
    differently?
9.  What authentication method will be used: university email/password,
    institutional single sign-on, or staff-created accounts?
10. What are the department's data-retention and audit requirements?

Document the chosen policies in the README and encode them consistently
in both backend logic and the user interface.

------------------------------------------------------------------------

# 15. Copy-and-Use Prompt to Build the Website

Copy the prompt below into your coding agent (for example, an IDE coding
assistant). Give it access to the project repository if you want it to
create and modify files.

------------------------------------------------------------------------

## MASTER BUILD PROMPT

You are a senior full-stack engineer and product designer. Build a
complete, secure, working web application called **JU Meal Management
System** for teachers and authorized food-collection staff of
Jahangirnagar University's CSE Department.

### Product goal

Teachers must be able to sign in, see their weekly meal budget, browse
food menus from participating JU campus food locations, place orders
before **12:00 PM Asia/Dhaka time**, and view their own order history
and remaining balance. Staff must be able to view every confirmed order
for a selected date, group orders by restaurant, print collection
sheets, track collection and delivery, and review expenses. Connect the
frontend to a real backend and persistent relational database.

### Required stack

Use **React + TypeScript + Vite** for the frontend, **Node.js +
Express + TypeScript** for the backend, **PostgreSQL** for the database,
and **Prisma ORM** (or explain any necessary alternative before changing
the stack). Use a maintainable REST API, schema validation, database
migrations, automated tests, and environment variables. Do not use
localStorage, static arrays, or mock API responses as the actual
persistence layer.

### Roles and authorization

There are two primary roles: `TEACHER` and `STAFF`. Build role-protected
pages and backend routes. Teachers may only view and manage their own
orders and budget history. Staff can view all orders and update
collection/delivery status. Menu and budget administration must be
limited to explicitly authorized staff permissions. Enforce
authorization in the backend, not just by hiding frontend controls.

### Teacher features

1.  Secure login/logout and current-user profile.
2.  Dashboard with weekly allocation, spent amount, remaining budget,
    today's order, and ordering cutoff.
3.  Browse active food locations and database-backed menus with prices
    and availability.
4.  Add items and quantities to an order and review an itemized total.
5.  Submit an order before noon.
6.  Server validates prices, quantities, availability, deadline, and
    balance.
7.  Create the order, order items, and budget debit atomically in a
    database transaction.
8.  Show a confirmation and persistent order history.
9.  Display budget ledger entries and remaining balance.
10. Enforce the approved cancellation/edit policy and show clear errors
    after cutoff.

### Staff features

1.  Daily operations dashboard with date selection, totals, filters, and
    order counts.
2.  Table of all confirmed orders with teacher, items, quantities,
    location, total, and status.
3.  Automatic grouping by restaurant/location.
4.  Item-level quantity summaries for each restaurant.
5.  Printer-friendly collection sheets grouped by location, plus a daily
    summary.
6.  Update order or item status to `PENDING`, `COLLECTED`, or
    `DELIVERED` as appropriate; represent confirmed and cancelled states
    separately.
7.  Persist every status update and record who changed it and when.
8.  View daily costs by restaurant and the total daily cost.
9.  Permission-gated weekly budget allocation, ledger review, menu
    editing, price updates, and location management.

### Initial food locations

Create fictional seed menu data for: - Bot Tola (বটতলা) - Central
Cafeteria (কেন্দ্রীয় ক্যাফেটেরিয়া) - Chottor (চত্বর) - Cafeteria (only as a
separate location if configured as distinct) - Tasty Treat - Other
locations added by authorized staff

Clearly label all seeded teachers, menu data, and prices as
demonstration data. Do not invent or claim that sample prices are
verified real-world prices. Let authorized staff add, deactivate, and
update locations and menu items from the UI.

### Business logic that must be correct

-   The server is the source of truth for prices, totals, balances,
    permissions, and cutoff enforcement.
-   Use Asia/Dhaka time for the 12:00 PM ordering cutoff. Handle date
    boundaries and store timestamps consistently.
-   A request received after the cutoff must be rejected by the backend,
    even if a user bypasses the frontend.
-   Use a database transaction for order creation plus budget debit.
    Concurrent orders must not allow a teacher to overspend.
-   Use integer paisa or another precise money representation; never use
    floating-point arithmetic for money.
-   Save item name and unit-price snapshots on order items so historical
    orders do not change when menus are updated.
-   Keep a budget ledger for allocations, debits, refunds, and
    adjustments; do not silently overwrite financial records.
-   Prevent duplicate orders/debits from double-clicks or retries.
-   Do not hard-code daily totals. Calculate grouped totals from
    database records.
-   Enforce the agreed cancellation, refund, holiday, and
    budget-rollover policies. If a policy is unspecified, document the
    assumption in the README and make it configurable where practical
    rather than inventing a hidden rule.
-   Keep an audit trail for budget changes, status changes, and
    administrative actions.

### Suggested database entities

Design a normalized relational schema for `users`, `food_locations`,
`menu_items`, `budget_periods`, `budget_ledger`, `orders`,
`order_items`, `order_status_events`, and `audit_logs`. Add foreign
keys, unique constraints, validation constraints, useful indexes, and
migrations. Include timestamps and soft-deactivation fields where
appropriate. Do not delete historical orders when a menu item or
location is deactivated.

### Suggested API groups

Implement authenticated, validated endpoints for: - Login/logout/current
user - Teacher budget, menus, order creation, own order history, and
permitted cancellation - Staff daily orders, grouped orders, status
updates, collection reports, and daily totals - Permission-gated
menu/location CRUD - Permission-gated weekly budget allocations, ledger,
and reports

Use consistent JSON error responses and appropriate HTTP status codes.
Never expose passwords, password hashes, secrets, or session tokens.

### UI/UX quality

Create a polished, professional, accessible interface appropriate for
university staff. Use a clean layout, readable typography, responsive
design, clear navigation, tables, useful status indicators, loading
states, empty states, form validation, success/error feedback, and
confirmation dialogs for sensitive actions. Use Bangladeshi taka
formatting. Include the 12:00 PM cutoff prominently. Make the print view
clean and hide navigation and interactive controls when printing. Do not
prioritize visual polish over correctness.

### Security requirements

Use secure password hashing if handling passwords, secure HTTP-only
cookies or a properly configured authentication method, rate limiting,
input validation, least-privilege authorization, safe database queries,
and CSRF protection where applicable. Do not commit secrets. Provide an
`.env.example` with placeholders only. Use fictional seed accounts and
clearly document how to change their credentials. Never seed real
teacher personal data.

### Tests required

Write automated unit/integration tests for: - Authentication and role
authorization - Teacher isolation from other teachers' data -
Server-side noon cutoff, including the exact boundary - Invalid and
unavailable menu items - Insufficient budget - Atomic order creation and
ledger debit - Concurrent orders that could exceed a balance - Duplicate
request prevention - Correct location grouping and item totals - Status
history - Historical price snapshots - Budget ledger and report
calculations

### Deliverables

1.  Working frontend, backend, and database schema.
2.  Database migrations and a repeatable fictional seed script.
3.  `.env.example` without secrets.
4.  README with prerequisites, installation, environment setup, database
    creation, migration, seeding, development commands, test commands,
    demo accounts, architecture, API overview, and deployment guidance.
5.  Automated tests and clear test results.
6.  A list of any remaining policy decisions or incomplete features.
7.  A complete local development workflow, such as `docker compose up`
    if Docker is used.

### Required development process

First inspect the existing repository and report the current structure.
Then implement in small, coherent steps. Keep the app runnable after
each phase. Do not claim a feature is complete unless it is implemented
and tested. Run migrations, seed the database, run lint/type checks and
tests, fix failures, and summarize the actual results. If you cannot run
a command or verify a feature, state that honestly.

Start by creating the project structure and database schema, then
implement authentication and authorization, menu management, teacher
ordering and budget transactions, staff collection workflows,
reports/printing, and tests. Build a real end-to-end application, not
just a static mockup.

------------------------------------------------------------------------

## 16. Final Definition of Done

The project is ready for a controlled demo when a teacher can log in,
view a database-backed balance, choose available menu items, submit a
valid order before noon, and see the resulting ledger debit; and staff
can log in, see the same persisted order, group it by location, print a
collection sheet, mark it collected and delivered, and see accurate
totals after refreshing the page. Unauthorized access, overspending,
duplicate debits, and late orders must be rejected by the backend and
covered by tests.


# JU Meal Management System — Roadmap

## Phase 1 — Project setup
- [ ] Create the GitHub repository
- [ ] Install and verify Node.js, npm, Git, and Docker
- [ ] Create the monorepo and npm workspaces
- [ ] Set up React, Express, TypeScript, and Tailwind CSS
- [ ] Run frontend and backend locally

## Phase 2 — Database
- [ ] Configure PostgreSQL
- [ ] Design the Prisma schema
- [ ] Create and run migrations
- [ ] Add seed data for restaurants and sample users
- [ ] Verify database queries

## Phase 3 — Authentication
- [ ] Build the login page
- [ ] Implement secure login and logout
- [ ] Hash passwords and manage sessions securely
- [ ] Restrict teacher and staff routes by role
- [ ] Test unauthorized access

## Phase 4 — Restaurant menus
- [ ] Create restaurant management APIs
- [ ] Add and edit menu items and prices
- [ ] Build the teacher restaurant and menu pages
- [ ] Load real menu data from the backend
- [ ] Support item availability

## Phase 5 — Teacher ordering
- [ ] Display weekly budget and balance
- [ ] Add items to an order
- [ ] Calculate totals on the server
- [ ] Confirm orders before noon
- [ ] Save order items and deduct budgets safely

## Phase 6 — Staff workflow
- [ ] Build the staff dashboard
- [ ] Fetch all confirmed orders
- [ ] Group orders by restaurant
- [ ] Generate printable collection sheets
- [ ] Track collected and delivered orders

## Phase 7 — Testing and polish
- [ ] Test APIs and database operations
- [ ] Test the complete teacher-to-staff workflow
- [ ] Handle invalid input and failed requests
- [ ] Improve mobile and desktop layouts
- [ ] Add useful error messages and loading states

## Phase 8 — Deployment
- [ ] Configure production database and secrets
- [ ] Deploy the frontend and backend
- [ ] Apply production database migrations
- [ ] Configure HTTPS, CORS, and authentication cookies
- [ ] Run end-to-end production checks

