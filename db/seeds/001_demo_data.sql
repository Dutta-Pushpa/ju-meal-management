-- =============================================================================
-- 001_demo_data.sql
--
-- FICTIONAL DEMONSTRATION DATA.
--
-- Every record below is invented. Restaurant names are illustrative and are not
-- a verified list of participating vendors. Prices are plausible examples and
-- are not real prices. No real teacher personal data appears anywhere in this
-- repository, and none may be added without authorization.
--
-- Password hashes are not stored here. db/seed.ts generates them at run time
-- and substitutes them as escaped SQL literals, so no hash is ever committed to
-- the repository. Named placeholders are used because this file holds several
-- statements, which Postgres will not accept as bound parameters.
-- =============================================================================

-- Reset first so the seed is repeatable and always produces identical output.
-- schema_migrations is deliberately not truncated: seeding is about demo data,
-- and removing migration history would break future migrate runs.
TRUNCATE TABLE
  order_status_events,
  order_items,
  budget_ledger,
  budget_allocations,
  orders,
  menu_items,
  budget_periods,
  food_locations,
  sessions,
  audit_logs,
  users
RESTART IDENTITY CASCADE;

-- TRUNCATE ... CASCADE follows every foreign key that points at the truncated
-- tables, so the wipe above also empties app_settings through its updated_by
-- reference. The defaults are therefore restored here, which keeps this file
-- self-contained: after a seed the database is fully configured even though it
-- was empty beforehand.
INSERT INTO app_settings (key, value, description) VALUES
  ('order_cutoff_time', '"12:00"',
   'Daily ordering cutoff in the app timezone. Enforced by the backend.'),
  ('budget_rollover', 'false',
   'When false, unspent budget does not carry into the next period.'),
  ('timezone', '"Asia/Dhaka"',
   'Timezone in which business dates and the cutoff are evaluated.'),
  ('ordering_disabled_dates', '[]',
   'Dates on which ordering is disabled, such as holidays or vendor closures.');

-- ---------------------------------------------------------------------------
-- Users. Three accounts are fixed so the documented demo credentials work, and
-- four further fictional teachers exist to make the staff views meaningful.
-- ---------------------------------------------------------------------------
INSERT INTO users (id, full_name, email, password_hash, role, permissions) VALUES
  (1, 'Demo Admin',            'admin@example.edu',   :admin_password_hash,   'ADMIN',  '["users:create","users:manage","settings:manage","budgets:allocate","budgets:adjust","budgets:view","locations:manage","menu_items:manage","orders:cancel","orders:manage_status"]'),
  (2, 'Demo Staff',            'staff@example.edu',   :staff_password_hash,   'STAFF',  '["orders:manage_status","locations:manage","menu_items:manage"]'),
  (3, 'Rumana Haque',          'teacher@example.edu', :teacher_password_hash, 'TEACHER', '[]'),
  (4, 'Tanvir Hasan',          'tanvir@example.edu',   :teacher_password_hash, 'TEACHER', '[]'),
  (5, 'Nusrat Jahan',          'nusrat@example.edu',   :teacher_password_hash, 'TEACHER', '[]'),
  (6, 'Arif Chowdhury',        'arif@example.edu',     :teacher_password_hash, 'TEACHER', '[]'),
  (7, 'Sharmeen Akter',        'sharmeen@example.edu', :teacher_password_hash, 'TEACHER', '[]');

-- ---------------------------------------------------------------------------
-- Food locations.
-- ---------------------------------------------------------------------------
INSERT INTO food_locations (id, name, name_bn, description) VALUES
  (1, 'Bot Tola',          'বটতলা',              'Traditional Bengali meals near the CSE department.'),
  (2, 'Central Cafeteria', 'কেন্দ্রীয় ক্যাফেটেরিয়া', 'Affordable meals, khichuri, breakfast, and snacks.'),
  (3, 'Chottor',           'চত্বর',              'Participating campus stalls.'),
  (4, 'Tasty Treat',       'টেস্টি ট্রিট',       'Bakery and fast food.');

-- One item is deliberately unavailable so the ordering rejection path is
-- visible in a demo without having to change data first.
INSERT INTO menu_items (id, food_location_id, name, description, category, price_paisa, is_available) VALUES
  (1,  1, 'Chicken Meal',     'Rice, chicken curry, bhorta',            'lunch',    15000, true),
  (2,  1, 'Fish Meal',        'Rice, fish curry, dal',                  'lunch',    18000, true),
  (3,  1, 'Beef Bhuna',       'Rice, beef bhuna, bhorta',               'lunch',    20000, true),
  (4,  1, 'Khichuri',         'Khichuri with egg',                      'lunch',    12000, true),
  (5,  1, 'Polao',            'Plain polao',                            'lunch',     8000, true),
  (6,  2, 'Regular Meal',     'Rice, curry, vegetable',                 'lunch',    10000, true),
  (7,  2, 'Egg Khichuri',     'Khichuri with egg',                      'lunch',    11000, true),
  (8,  2, 'Chicken Fried Rice','Fried rice with chicken',              'lunch',    16000, true),
  (9,  2, 'Bread and Egg',    'Breakfast item',                         'breakfast',  7000, true),
  (10, 2, 'Beef Curry',       'Curry only, no rice',                    'lunch',    14000, false),
  (11, 3, 'Chottor Thali',    'Standard stall meal',                    'lunch',    13000, true),
  (12, 3, 'Chottor Khichuri', 'Khichuri',                               'lunch',    10000, true),
  (13, 4, 'Chicken Sandwich', 'Sandwich',                               'snack',     9000, true),
  (14, 4, 'Pastry',           'Assorted pastry',                        'snack',     7000, true),
  (15, 4, 'Cake Slice',       'Slice of cake',                          'snack',    11000, true);

-- ---------------------------------------------------------------------------
-- Budget periods. Weekly, non-overlapping. The middle period contains today's
-- date so the demo always has a current period with data.
-- ---------------------------------------------------------------------------
INSERT INTO budget_periods (id, name, starts_on, ends_on) VALUES
  (1, '2026-W41', '2026-10-05', '2026-10-11'),
  (2, '2026-W42', '2026-10-12', '2026-10-18'),
  (3, '2026-W43', '2026-10-19', '2026-10-25');

-- ---------------------------------------------------------------------------
-- Allocations for the current period, plus a matching positive ledger entry.
-- Every allocation is mirrored by an 'allocation' ledger row, because the ledger
-- alone determines the balance.
-- ---------------------------------------------------------------------------
INSERT INTO budget_allocations (teacher_id, budget_period_id, amount_paisa, created_by)
VALUES
  (3, 2, 70000, 1),
  (4, 2, 70000, 1),
  (5, 2, 70000, 1),
  (6, 2, 70000, 1),
  (7, 2, 70000, 1),
  (3, 1, 70000, 1),
  (4, 1, 70000, 1);

INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by) VALUES
  (3, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (4, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (5, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (6, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (7, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (3, 1, 'allocation', 70000, 'Weekly allocation', 1),
  (4, 1, 'allocation', 70000, 'Weekly allocation', 1);

-- ---------------------------------------------------------------------------
-- Orders on two past dates, so the staff daily view has content regardless of
-- when the demo is run. Prices in order_items are snapshots taken from the
-- menu prices above at the stated quantities.
-- ---------------------------------------------------------------------------
INSERT INTO orders (id, teacher_id, food_location_id, order_date, status, total_paisa, confirmed_at, created_at, cancelled_at) VALUES
  -- 2026-10-14, all confirmed
  (1, 3, 1, '2026-10-14', 'CONFIRMED', 42000, '2026-10-14T05:10:00Z', '2026-10-14T05:10:00Z', NULL),
  (2, 4, 2, '2026-10-14', 'CONFIRMED', 17000, '2026-10-14T05:25:00Z', '2026-10-14T05:25:00Z', NULL),
  (3, 5, 4, '2026-10-14', 'CONFIRMED', 20000, '2026-10-14T06:02:00Z', '2026-10-14T06:02:00Z', NULL),
  -- 2026-10-15, progressed through collection
  (4, 3, 1, '2026-10-15', 'DELIVERED', 15000, '2026-10-15T05:05:00Z', '2026-10-15T05:05:00Z', NULL),
  (5, 6, 1, '2026-10-15', 'DELIVERED', 38000, '2026-10-15T05:30:00Z', '2026-10-15T05:30:00Z', NULL),
  (6, 7, 3, '2026-10-15', 'COLLECTED', 23000, '2026-10-15T06:12:00Z', '2026-10-15T06:12:00Z', NULL),
  -- A cancelled order, so the refund path is represented in demo data.
  -- cancelled_at is required by the orders_cancelled_fields_check constraint,
  -- which is why a cancelled row must record exactly when it was cancelled.
  (7, 5, 2, '2026-10-15', 'CANCELLED', 10000, '2026-10-15T05:45:00Z', '2026-10-15T05:45:00Z', '2026-10-15T06:20:00Z');

-- Snapshots: name and unit price at the time of ordering. Never joined back to
-- menu_items for reporting.
INSERT INTO order_items (id, order_id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot, quantity, line_total_paisa, status) VALUES
  (1,  1,  1, 'Chicken Meal', 15000, 2, 30000, 'DELIVERED'),
  (2,  1,  4, 'Khichuri',     12000, 1, 12000, 'DELIVERED'),
  (3,  2,  6, 'Regular Meal', 10000, 1, 10000, 'DELIVERED'),
  (4,  2, 14, 'Pastry',        7000, 1,  7000, 'DELIVERED'),
  (5,  3, 13, 'Chicken Sandwich', 9000, 1,  9000, 'DELIVERED'),
  (6,  3, 15, 'Cake Slice',   11000, 1, 11000, 'DELIVERED'),
  (7,  4,  1, 'Chicken Meal', 15000, 1, 15000, 'DELIVERED'),
  (8,  5,  3, 'Beef Bhuna',   20000, 1, 20000, 'DELIVERED'),
  (9,  5,  2, 'Fish Meal',    18000, 1, 18000, 'DELIVERED'),
  (10, 6, 11, 'Chottor Thali',13000, 1, 13000, 'COLLECTED'),
  (11, 6, 12, 'Chottor Khichuri', 10000, 1, 10000, 'COLLECTED'),
  (12, 7,  6, 'Regular Meal', 10000, 1, 10000, 'DELIVERED');

-- ---------------------------------------------------------------------------
-- Ledger debits and one refund, matching the orders above exactly.
-- Debits are negative; the refund for the cancelled order is positive.
-- ---------------------------------------------------------------------------
INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, order_id, reason, created_by) VALUES
  (3, 2, 'debit',  -42000, 1, 'Order on 2026-10-14', 3),
  (4, 2, 'debit',  -17000, 2, 'Order on 2026-10-14', 4),
  (5, 2, 'debit',  -20000, 3, 'Order on 2026-10-14', 5),
  (3, 2, 'debit',  -15000, 4, 'Order on 2026-10-15', 3),
  (6, 2, 'debit',  -38000, 5, 'Order on 2026-10-15', 6),
  (7, 2, 'debit',  -23000, 6, 'Order on 2026-10-15', 7),
  (5, 2, 'debit',  -10000, 7, 'Order on 2026-10-15', 5),
  -- Refund restoring the cancelled order to the teacher's balance.
  (5, 2, 'refund',  10000, 7, 'Order cancelled by the teacher before the cutoff', 5);

-- ---------------------------------------------------------------------------
-- Status history. Every seeded order has its creation event, and the progressed
-- ones have their transitions.
-- ---------------------------------------------------------------------------
INSERT INTO order_status_events (order_id, order_item_id, old_status, new_status, changed_by, note, created_at) VALUES
  (1, NULL, NULL, 'CONFIRMED', 3, 'Order placed', '2026-10-14T05:10:00Z'),
  (1, 1,  'PENDING', 'COLLECTED', 2, 'Collected from vendor', '2026-10-14T11:40:00Z'),
  (1, 1,  'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', '2026-10-14T12:35:00Z'),
  (1, 2,  'PENDING', 'COLLECTED', 2, 'Collected from vendor', '2026-10-14T11:40:00Z'),
  (1, 2,  'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', '2026-10-14T12:35:00Z'),
  (1, NULL, 'CONFIRMED', 'DELIVERED', 2, NULL, '2026-10-14T12:35:00Z'),

  (2, NULL, NULL, 'CONFIRMED', 4, 'Order placed', '2026-10-14T05:25:00Z'),
  (2, NULL, 'CONFIRMED', 'DELIVERED', 2, NULL, '2026-10-14T12:40:00Z'),

  (3, NULL, NULL, 'CONFIRMED', 5, 'Order placed', '2026-10-14T06:02:00Z'),
  (3, NULL, 'CONFIRMED', 'DELIVERED', 2, NULL, '2026-10-14T12:45:00Z'),

  (4, NULL, NULL, 'CONFIRMED', 3, 'Order placed', '2026-10-15T05:05:00Z'),
  (4, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', '2026-10-15T11:30:00Z'),
  (4, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', '2026-10-15T12:30:00Z'),

  (5, NULL, NULL, 'CONFIRMED', 6, 'Order placed', '2026-10-15T05:30:00Z'),
  (5, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', '2026-10-15T11:35:00Z'),
  (5, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', '2026-10-15T12:32:00Z'),

  (6, NULL, NULL, 'CONFIRMED', 7, 'Order placed', '2026-10-15T06:12:00Z'),
  (6, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', '2026-10-15T11:50:00Z'),

  (7, NULL, NULL, 'CONFIRMED', 5, 'Order placed', '2026-10-15T05:45:00Z'),
  (7, NULL, 'CONFIRMED', 'CANCELLED', 5, 'Cancelled by the teacher before the cutoff', '2026-10-15T06:20:00Z');

-- ---------------------------------------------------------------------------
-- Audit trail entries for the seeded administrative work.
-- ---------------------------------------------------------------------------
INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES
  (1, 'budget.allocation.created', 'budget_allocation', NULL, '{"period":"2026-W42","teachers":5,"amountPaisa":70000,"source":"seed"}'),
  (1, 'user.created', 'user', 1, '{"role":"ADMIN","source":"seed"}'),
  (1, 'user.created', 'user', 2, '{"role":"STAFF","source":"seed"}');

-- ---------------------------------------------------------------------------
-- Advance the sequences used by tables seeded with explicit ids.
--
-- TRUNCATE ... RESTART IDENTITY puts every sequence back at 1, but an INSERT
-- that supplies an explicit id does not move the sequence forward. Without the
-- setval calls below, the first row created through the API would ask for id 1
-- and collide with the demo row that already holds it. That surfaces as a
-- spurious duplicate error on a perfectly unique value, so the seed must leave
-- every sequence beyond the highest id it inserted.
-- ---------------------------------------------------------------------------
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('food_locations', 'id'), (SELECT max(id) FROM food_locations));
SELECT setval(pg_get_serial_sequence('menu_items', 'id'), (SELECT max(id) FROM menu_items));
SELECT setval(pg_get_serial_sequence('budget_periods', 'id'), (SELECT max(id) FROM budget_periods));
SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT max(id) FROM orders));
SELECT setval(pg_get_serial_sequence('order_items', 'id'), (SELECT max(id) FROM order_items));

-- ---------------------------------------------------------------------------
-- Demo password summary. These are the documented development credentials and
-- must be changed or deleted before any real deployment.
-- ---------------------------------------------------------------------------
-- admin@example.edu   / AdminPass123!
-- staff@example.edu   / StaffPass123!
-- teacher@example.edu / TeacherPass123!