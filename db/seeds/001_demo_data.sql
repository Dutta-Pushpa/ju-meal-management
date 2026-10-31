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
--
-- DATES ARE DYNAMIC. Everything is computed relative to "today" in Dhaka
-- business time at seed time, so a freshly seeded database always has:
--   * six months of allocation and order history (for the monthly report),
--   * orders today in every live status (for the staff daily view),
--   * one teacher with a low balance, one in (policy-sized) debt and one with
--     a debt allowance, so every warning and every budget path can be tried.
--
-- Featured demonstration accounts (all passwords in DEMO_PASSWORDS, seed.ts):
--   teacher@juniv.edu    (id 3)  low balance (~50 taka), request history,
--                                a live CONFIRMED order in today's queue
--   sarnali.basak@juniv.edu (id 17) in debt - the debt warning shows
--   imdadul.islam@juniv.edu (id 6)  in debt beyond the base cap but inside the
--                                debt allowance he was granted
-- =============================================================================

-- Reset first so the seed is repeatable and always produces identical output.
-- schema_migrations is deliberately not truncated. app_settings is listed
-- because it references users and would be truncated by CASCADE anyway.
TRUNCATE TABLE
  order_status_events,
  order_items,
  budget_ledger,
  budget_requests,
  budget_monthly_allocations,
  budget_allocations,
  orders,
  menu_items,
  budget_periods,
  food_locations,
  sessions,
  audit_logs,
  app_settings,
  users
RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- Application settings.
--
-- Debt is enabled for the demo so the low-balance and debt paths can be
-- exercised: a teacher may overdraw up to 500 taka, for at most three
-- debt-incurring orders.
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value, description) VALUES
  ('order_placement_deadline', '"12:30"',
   'Latest clock time (Dhaka business time) a teacher may place an order. Enforced by the backend.'),
  ('order_cancellation_deadline', '"13:00"',
   'Latest clock time (Dhaka business time) an order may be cancelled. Enforced by the backend.'),
  ('negative_balance_allowed', 'true',
   'Whether a teacher may place orders that push their remaining balance below zero.'),
  ('max_debt_paisa', '50000',
   'Maximum permitted outstanding debt in paisa when negative balance is allowed. Zero means no debt permitted.'),
  ('max_additional_orders', '3',
   'Maximum number of additional orders a teacher may place beyond their balance when debt is allowed. Zero means no additional orders permitted.');

-- ---------------------------------------------------------------------------
-- Demo users.
-- ---------------------------------------------------------------------------
INSERT INTO users
  (id, full_name, email, password_hash, role, designation)
VALUES
  (1, 'Demo Admin',
   'admin@juniv.edu', :admin_password_hash,
   'ADMIN', NULL),

  (2, 'Demo Staff',
   'staff@juniv.edu', :staff_password_hash,
   'STAFF', NULL),

  (3, 'Dr. Jugal Krishna Das',
   'teacher@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (4, 'Dr. Mohammad Shorif Uddin',
   'shorif.uddin@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (5, 'Dr. Mohammad Zahidur Rahman',
   'zahidur.rahman@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (6, 'Dr. Md. Imdadul Islam',
   'imdadul.islam@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (7, 'Dr. Liton Jude Rozario',
   'liton.rozario@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (8, 'Md. Golam Moazzam',
   'golam.moazzam@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (9, 'Dr. Israt Jahan',
   'israt.jahan@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (10, 'Dr. Md. Humayun Kabir',
   'humayun.kabir@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (11, 'Dr. Md Abul Kalam Azad',
   'kalam.azad@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (12, 'Abu Sayed Md. Mostafizur Rahaman',
   'mostafizur.rahaman@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (13, 'Dr. Md. Ezharul Islam',
   'ezharul.islam@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (14, 'Dr. Morium Akter',
   'morium.akter@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (15, 'Dr. Sanjit Kumar Saha',
   'sanjit.saha@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (16, 'Dr. Md. Musfique Anwar',
   'musfique.anwar@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Professor'),

  (17, 'Sarnali Basak',
   'sarnali.basak@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Associate Professor'),

  (18, 'Amina Khatun',
   'amina.khatun@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Associate Professor'),

  (19, 'Sabrina Sharmin',
   'sabrina.sharmin@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Associate Professor'),

  (20, 'Tahsina Hashem',
   'tahsina.hashem@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Assistant Professor'),

  (21, 'Md. Rafsan Jani',
   'rafsan.jani@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Associate Professor'),

  (22, 'Mohammad Ashraful Islam',
   'ashraful.islam@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Assistant Professor'),

  (23, 'Bulbul Ahammad',
   'bulbul.ahammad@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Assistant Professor'),

  (24, 'Anup Majumder',
   'anup.majumder@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Assistant Professor'),

  (25, 'Nadia Afrin Ritu',
   'nadia.ritu@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Assistant Professor'),

  (26, 'Samsun Nahar Khandakar',
   'samsun.nahar@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Assistant Professor'),

  (27, 'Md. Masum Bhuiyan',
   'masum.bhuiyan@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Lecturer'),

  (28, 'Nishat Tasnim',
   'nishat.tasnim@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Lecturer'),

  (29, 'Lubna Yasmin Pinky',
   'lubna.pinky@juniv.edu', :teacher_password_hash,
   'TEACHER', 'Lecturer');

-- ---------------------------------------------------------------------------
-- Food locations.
--
-- name holds the English name only. name_bn holds the Bengali name.
-- Fry Town is inactive so the admin location list and the teacher menu both
-- demonstrate the inactive state.
-- ---------------------------------------------------------------------------
INSERT INTO food_locations (id, name, name_bn, description, is_active) VALUES
  (1, 'Radhuni',      'রাধুনী',        'বটতলা',          true),
  (2, 'Rafi',         'রাফি',          'বটতলা',          true),
  (3, 'Nurjahan',     'নূরজাহান',      'বটতলা',          true),
  (4, 'Jax Kitchen',  'জ্যাক্স কিচেন', 'বটতলা',          true),
  (5, 'Cafeteria',    'ক্যাফেটেরিয়া', NULL,             true),
  (6, 'Chattor',      'চত্বর',          NULL,             true),
  (7, 'Tasty Treat',  'টেস্টি ট্রিট',  NULL,             true),
  (8, 'Fry Town',     'ফ্রাই টাউন',    NULL,             false);

-- ---------------------------------------------------------------------------
-- Menu items.
--
-- All locations share the demo catalogue, but each location charges a slightly
-- different price: 25 paisa (0.25 taka) more per location id, so location 8
-- costs 1.75 taka more than location 1 for the same dish. Item ids are
-- (location id - 1) * 18 + item number, so location 1 has ids 1-18, location 2
-- has 19-36, location 3 has 37-54, location 4 has 55-72, location 5 has 73-90,
-- location 6 has 91-108, location 7 has 109-126 and location 8 has 127-144.
--
-- A few items are unavailable today so the teacher menu shows that state too.
-- ---------------------------------------------------------------------------
INSERT INTO menu_items
  (id, food_location_id, name, description, category, price_paisa, is_available)
SELECT
  (l.id - 1) * 18 + t.n,
  l.id,
  t.name,
  t.description,
  t.category,
  t.price_paisa + (l.id - 1) * 25,
  CASE
    WHEN l.id = 1 AND t.n IN (15, 17) THEN false  -- no rui/tengra at Radhuni today
    WHEN l.id = 6 AND t.n = 7 THEN false          -- chicken sold out at Chattor
    ELSE true
  END
FROM food_locations l
CROSS JOIN (VALUES
  (1,  '১ প্লেট ভাত',               'One plate rice',     'ভাত ও ডাল',   1000),
  (2,  'হাফ প্লেট ভাত',              'Half plate rice',    'ভাত ও ডাল',    500),
  (3,  'পাতলা ডাল',                 'Dal',                'ভাত ও ডাল',   1000),
  (4,  'ঘন ডাল',                    'Ghono dal',          'ভাত ও ডাল',   1500),
  (5,  'ডাল বড়া',                  'Dal bora',           'ভাত ও ডাল',   1000),
  (6,  'ডিম',                       'Egg',                'ডিম ও মাংস',  2000),
  (7,  'মুরগির মাংস (ডাল)',         'Chicken (dal)',      'ডিম ও মাংস',  5000),
  (8,  'মুরগির মাংস (ঝাল ফ্রাই)',   'Chicken (jhal fry)', 'ডিম ও মাংস',  5000),
  (9,  'আলু ভর্তা',                 'Alu bhorta',         'ভর্তা ও শাক', 1000),
  (10, 'মাছ ভর্তা',                 'Mach bhorta',        'ভর্তা ও শাক', 2000),
  (11, 'পুঁই শাক',                  'Pui shak',           'ভর্তা ও শাক', 2000),
  (12, 'পালং শাক',                  'Palong shak',        'ভর্তা ও শাক', 2000),
  (13, 'কলমি শাক',                  'Kolmi shak',         'ভর্তা ও শাক', 2000),
  (14, 'লাল শাক',                   'Laal shak',          'ভর্তা ও শাক', 2000),
  (15, 'রুই মাছ',                   'Rui mach',           'মাছ',         5000),
  (16, 'পাঙ্গাশ মাছ',               'Pangash mach',       'মাছ',         5000),
  (17, 'টেংরা মাছ',                 'Tengra mach',        'মাছ',         4000),
  (18, 'ছোট মাছ / গুঁড়া মাছ',      'Choto mach',         'মাছ',         3000)
) AS t (n, name, description, category, price_paisa)
ORDER BY l.id, t.n;

-- ---------------------------------------------------------------------------
-- Legacy budget periods, allocations and ledger entries.
--
-- Retained for the legacy "budget report" only; monthly allocations are the
-- current model. These ledger entries carry a budget_period_id but no
-- year/month, which keeps them out of every monthly balance calculation.
-- ---------------------------------------------------------------------------
INSERT INTO budget_periods (id, name, starts_on, ends_on) VALUES
  (1, '2026-W41', '2026-10-05', '2026-10-11'),
  (2, '2026-W42', '2026-10-12', '2026-10-18'),
  (3, '2026-W43', '2026-10-19', '2026-10-25');

INSERT INTO budget_allocations (teacher_id, budget_period_id, amount_paisa, created_by)
SELECT t.tid, p.id, 50000, 1
FROM (VALUES (3), (4), (5)) AS t (tid)
CROSS JOIN budget_periods p;

INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by)
SELECT a.teacher_id, a.budget_period_id, NULL, NULL, 'allocation', a.amount_paisa,
       'Legacy weekly allocation for ' || p.name, 1
FROM budget_allocations a
JOIN budget_periods p ON p.id = a.budget_period_id;

INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by)
SELECT a.teacher_id, a.budget_period_id, NULL, NULL, 'debit',
       -(30000 + ((a.teacher_id * 7 + a.budget_period_id * 13) % 40) * 250),
       'Legacy weekly orders (migrated)', a.teacher_id
FROM budget_allocations a;

-- ---------------------------------------------------------------------------
-- Monthly allocations for the current Dhaka month and the five before it.
--
-- Past months allocate 60000 paisa (600 taka); the current month allocates
-- 280000 paisa (2,800 taka). The ramp makes the monthly report look like a
-- system that started small and grew. Three teachers have tailored stories:
--   id 3  (demo login)  small current budget (30000 = 300 taka), nearly spent
--   id 6                modest current budget (60000), under-allocated before
--   id 17               under-allocated before (10000/month) while the
--                       generated history shows her ordering anyway - the
--                       debt story
--
-- Matching 'allocation' ledger entries are inserted so the all-time running
-- balance (used by the debt-order cap) agrees with the allocations. They are
-- stamped at the first day of their own month so the running balance flows
-- chronologically, the way live data does.
-- ---------------------------------------------------------------------------
WITH months AS (
  SELECT EXTRACT(YEAR FROM m)::int AS y,
         EXTRACT(MONTH FROM m)::int AS mo,
         m = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date) AS is_current
  FROM generate_series(
         date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date) - interval '5 months',
         date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date),
         interval '1 month'
       ) AS m
)
INSERT INTO budget_monthly_allocations
  (teacher_id, year, month, allocated_paisa, carried_forward_paisa, created_by)
SELECT u.id, months.y, months.mo,
       CASE
         WHEN NOT months.is_current THEN
           CASE WHEN u.id IN (6, 17) THEN 10000 ELSE 60000 END
         WHEN u.id = 3 THEN 30000
         WHEN u.id = 6 THEN 60000
         ELSE 280000
       END,
       0, 1
FROM users u
CROSS JOIN months
WHERE u.role = 'TEACHER'
ORDER BY u.id, months.y, months.mo;

INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by, created_at)
SELECT ma.teacher_id, NULL, ma.year, ma.month, 'allocation', ma.allocated_paisa,
       'Monthly allocation for ' || ma.year || '-' || lpad(ma.month::text, 2, '0'), 1,
       timezone('UTC', make_date(ma.year, ma.month, 1) + time '10:00')
FROM budget_monthly_allocations ma;

-- ---------------------------------------------------------------------------
-- Hand-written showcase orders.
--
-- Dates are relative to Dhaka "today" at seed time. Every live status appears
-- today: CONFIRMED (in the staff queue), COLLECTED (ready to deliver with the
-- reconciliation form), DELIVERED (including one reconciled costlier), and
-- CANCELLED. Teachers 3 and 6 get a small history; everyone else's history is
-- generated further down.
-- ---------------------------------------------------------------------------
WITH v AS (
  SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date AS today
)
INSERT INTO orders
  (id, teacher_id, food_location_id, order_date, status, total_paisa,
   alternative_item_name, alternative_unit_price_paisa, actual_cost_paisa,
   delivery_confirmed_at, delivery_confirmed_by, confirmed_at, created_at, cancelled_at)
SELECT
  r.id, r.teacher_id, r.location_id, v.today + r.day_offset, r.status, r.total,
  r.alt_name, r.alt_price, r.actual_cost,
  CASE WHEN r.status = 'DELIVERED'
       THEN LEAST(timezone('UTC', v.today + r.day_offset + r.deliver_time), now()) END,
  CASE WHEN r.status = 'DELIVERED' THEN 2 END,
  LEAST(timezone('UTC', v.today + r.day_offset + r.placed_time), now()),
  LEAST(timezone('UTC', v.today + r.day_offset + r.placed_time), now()),
  CASE WHEN r.status = 'CANCELLED'
       THEN LEAST(timezone('UTC', v.today + r.day_offset + r.cancel_time), now()) END
FROM (VALUES
  -- today: one per live status
  (1,  3, 1,  0, 'CONFIRMED', 6500,  'মুরগির মাংস (ঝাল ফ্রাই)'::text, 5000, NULL::bigint, time '04:50', NULL::time, NULL::time),
  (2,  5, 2,  0, 'COLLECTED', 4050,  NULL, NULL, NULL, time '05:05', NULL, NULL),
  (3,  6, 3,  0, 'DELIVERED', 10100, NULL, NULL, NULL, time '05:20', time '07:00', NULL),
  (4,  8, 4,  0, 'DELIVERED', 7150,  NULL, NULL, 7500, time '05:35', time '07:05', NULL),
  (5,  9, 1,  0, 'CANCELLED', 1000,  NULL, NULL, NULL, time '06:00', NULL, time '06:40'),
  -- yesterday
  (6,  4, 1, -1, 'DELIVERED', 7000,  NULL, NULL, NULL, time '05:15', time '07:10', NULL),
  (7,  3, 1, -1, 'DELIVERED', 7000,  NULL, NULL, NULL, time '05:40', time '07:12', NULL),
  (8,  7, 5, -1, 'DELIVERED', 2700,  NULL, NULL, NULL, time '06:05', time '07:15', NULL),
  -- earlier this week: alternative item delivered cheaper (refund)
  (9,  3, 1, -3, 'DELIVERED', 6000,  'ডিম ভুনা', 4500, 4500, time '05:25', time '07:00', NULL),
  (10, 6, 2, -4, 'CANCELLED', 525,   NULL, NULL, NULL, time '05:50', NULL, time '06:30'),
  (13, 6, 3, -6, 'DELIVERED', 11650, NULL, NULL, NULL, time '05:55', time '07:00', NULL),
  -- older history for the featured teacher
  (11, 3, 2, -20, 'DELIVERED', 2550, NULL, NULL, NULL, time '05:30', time '07:00', NULL),
  (12, 3, 1, -27, 'DELIVERED', 4000, NULL, NULL, NULL, time '05:45', time '07:05', NULL)
) AS r(id, teacher_id, location_id, day_offset, status, total, alt_name, alt_price,
       actual_cost, placed_time, deliver_time, cancel_time)
CROSS JOIN v;

-- ---------------------------------------------------------------------------
-- Order item snapshots for the hand-written orders.
-- ---------------------------------------------------------------------------
INSERT INTO order_items
  (id, order_id, menu_item_id, item_name_snapshot,
   unit_price_paisa_snapshot, quantity, line_total_paisa, status)
VALUES
  (1,  1,  7, 'মুরগির মাংস (ডাল)',  5000, 1, 5000, 'PENDING'),
  (2,  1,  4, 'ঘন ডাল',              1500, 1, 1500, 'PENDING'),
  (3,  2, 24, 'ডিম',                 2025, 1, 2025, 'COLLECTED'),
  (4,  2, 28, 'মাছ ভর্তা',           2025, 1, 2025, 'COLLECTED'),
  (5,  3, 69, 'রুই মাছ',             5050, 1, 5050, 'DELIVERED'),
  (6,  3, 70, 'পাঙ্গাশ মাছ',         5050, 1, 5050, 'DELIVERED'),
  (7,  4, 53, 'টেংরা মাছ',           4075, 1, 4075, 'DELIVERED'),
  (8,  4, 54, 'ছোট মাছ / গুঁড়া মাছ', 3075, 1, 3075, 'DELIVERED'),
  (9,  5,  5, 'ডাল বড়া',             1000, 1, 1000, 'PENDING'),
  (10, 6,  7, 'মুরগির মাংস (ডাল)',  5000, 1, 5000, 'DELIVERED'),
  (11, 6,  6, 'ডিম',                 2000, 1, 2000, 'DELIVERED'),
  (12, 7, 15, 'রুই মাছ',             5000, 1, 5000, 'DELIVERED'),
  (13, 7, 11, 'পুঁই শাক',            2000, 1, 2000, 'DELIVERED'),
  (14, 8, 73, '১ প্লেট ভাত',          1100, 1, 1100, 'DELIVERED'),
  (15, 8, 76, 'ঘন ডাল',              1600, 1, 1600, 'DELIVERED'),
  (16, 9,  7, 'মুরগির মাংস (ডাল)',  5000, 1, 5000, 'DELIVERED'),
  (17, 9,  9, 'আলু ভর্তা',           1000, 1, 1000, 'DELIVERED'),
  (18, 10, 20, 'হাফ প্লেট ভাত',       525, 1,  525, 'PENDING'),
  (19, 11, 24, 'ডিম',                2025, 1, 2025, 'DELIVERED'),
  (20, 11, 20, 'হাফ প্লেট ভাত',       525, 1,  525, 'DELIVERED'),
  (21, 12, 12, 'পালং শাক',           2000, 2, 4000, 'DELIVERED'),
  (22, 13, 69, 'রুই মাছ',            5050, 2, 10100, 'DELIVERED'),
  (23, 13, 40, 'ঘন ডাল',             1550, 1, 1550, 'DELIVERED');

-- ---------------------------------------------------------------------------
-- Ledger for the hand-written orders: one placement debit per order,
-- refunds for the cancellations, and the delivery reconciliation entries for
-- orders 4 (actual cost higher - extra debit) and 9 (cheaper - refund).
-- Each entry is stamped with the moment of the event it records.
-- ---------------------------------------------------------------------------
INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, order_id, reason, created_by, created_at)
SELECT o.teacher_id, NULL,
       EXTRACT(YEAR FROM o.order_date)::int, EXTRACT(MONTH FROM o.order_date)::int,
       x.entry_type, x.amount, o.id, x.reason, x.created_by,
       CASE x.at_when
         WHEN 'cancelled' THEN o.cancelled_at
         WHEN 'delivered' THEN o.delivery_confirmed_at
         ELSE o.created_at
       END
FROM (VALUES
  (1,  'debit',  -6500, 'Placement debit', 3, 'placed'),
  (2,  'debit',  -4050, 'Placement debit', 5, 'placed'),
  (3,  'debit', -10100, 'Placement debit', 6, 'placed'),
  (4,  'debit',  -7150, 'Placement debit', 8, 'placed'),
  (4,  'debit',   -350, 'Actual cost reconciliation (delivery)', 2, 'delivered'),
  (5,  'debit',  -1000, 'Placement debit', 9, 'placed'),
  (5,  'refund',  1000, 'Order cancelled by the teacher before the cutoff', 9, 'cancelled'),
  (6,  'debit',  -7000, 'Placement debit', 4, 'placed'),
  (7,  'debit',  -7000, 'Placement debit', 3, 'placed'),
  (8,  'debit',  -2700, 'Placement debit', 7, 'placed'),
  (9,  'debit',  -6000, 'Placement debit', 3, 'placed'),
  (9,  'refund',  1500, 'Actual cost reconciliation (delivery)', 2, 'delivered'),
  (10, 'debit',   -525, 'Placement debit', 6, 'placed'),
  (10, 'refund',   525, 'Order cancelled by the teacher before the cutoff', 6, 'cancelled'),
  (11, 'debit',  -2550, 'Placement debit', 3, 'placed'),
  (12, 'debit',  -4000, 'Placement debit', 3, 'placed'),
  (13, 'debit', -11650, 'Placement debit', 6, 'placed')
) AS x(order_id, entry_type, amount, reason, created_by, at_when)
JOIN orders o ON o.id = x.order_id;

-- Order 4 was delivered costlier than estimated. Reconciliation mirrors the
-- app: total_paisa keeps the placement estimate, actual_cost_paisa holds the
-- real cost, and the difference is debited in the ledger.

-- ---------------------------------------------------------------------------
-- Status history for the hand-written orders.
-- ---------------------------------------------------------------------------
INSERT INTO order_status_events
  (order_id, order_item_id, old_status, new_status, changed_by, note, created_at)
SELECT e.order_id, e.order_item_id, e.old_status, e.new_status, e.changed_by, e.note,
       LEAST(timezone('UTC', o.order_date + e.at_time), now())
FROM (VALUES
  (1, NULL::bigint, NULL::text, 'CONFIRMED', 3, 'Order placed', time '04:50'),
  (2, NULL, NULL, 'CONFIRMED', 5, 'Order placed', time '05:05'),
  (2, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:40'),
  (3, NULL, NULL, 'CONFIRMED', 6, 'Order placed', time '05:20'),
  (3, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:45'),
  (3, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:00'),
  (3, 5, 'PENDING', 'COLLECTED', 2, 'Collected from vendor', time '06:45'),
  (3, 5, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:00'),
  (3, 6, 'PENDING', 'COLLECTED', 2, 'Collected from vendor', time '06:45'),
  (3, 6, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:00'),
  (4, NULL, NULL, 'CONFIRMED', 8, 'Order placed', time '05:35'),
  (4, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:50'),
  (4, NULL, 'COLLECTED', 'DELIVERED', 2, 'Actual cost higher than estimate; difference debited', time '07:05'),
  (4, 7, 'PENDING', 'COLLECTED', 2, 'Collected from vendor', time '06:50'),
  (4, 7, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:05'),
  (4, 8, 'PENDING', 'COLLECTED', 2, 'Collected from vendor', time '06:50'),
  (4, 8, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:05'),
  (5, NULL, NULL, 'CONFIRMED', 9, 'Order placed', time '06:00'),
  (5, NULL, 'CONFIRMED', 'CANCELLED', 9, 'Cancelled by the teacher before the cutoff', time '06:40'),
  (6, NULL, NULL, 'CONFIRMED', 4, 'Order placed', time '05:15'),
  (6, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:45'),
  (6, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:10'),
  (7, NULL, NULL, 'CONFIRMED', 3, 'Order placed', time '05:40'),
  (7, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:48'),
  (7, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:12'),
  (8, NULL, NULL, 'CONFIRMED', 7, 'Order placed', time '06:05'),
  (8, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:55'),
  (8, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:15'),
  (9, NULL, NULL, 'CONFIRMED', 3, 'Order placed', time '05:25'),
  (9, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:40'),
  (9, NULL, 'COLLECTED', 'DELIVERED', 2, 'Vendor out of chicken; delivered ডিম ভুনা instead', time '07:00'),
  (10, NULL, NULL, 'CONFIRMED', 6, 'Order placed', time '05:50'),
  (10, NULL, 'CONFIRMED', 'CANCELLED', 6, 'Cancelled by the teacher before the cutoff', time '06:30'),
  (11, NULL, NULL, 'CONFIRMED', 3, 'Order placed', time '05:30'),
  (11, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:40'),
  (11, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:00'),
  (12, NULL, NULL, 'CONFIRMED', 3, 'Order placed', time '05:45'),
  (12, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:40'),
  (12, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:05'),
  (13, NULL, NULL, 'CONFIRMED', 6, 'Order placed', time '05:55'),
  (13, NULL, 'CONFIRMED', 'COLLECTED', 2, 'Collected from vendor', time '06:45'),
  (13, NULL, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', time '07:00')
) AS e(order_id, order_item_id, old_status, new_status, changed_by, note, at_time)
JOIN orders o ON o.id = e.order_id;

-- Advance the orders/order_items sequences past the explicit demo ids so the
-- generated history below can use ordinary auto-generated ids.
SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT MAX(id) FROM orders), true);
SELECT setval(pg_get_serial_sequence('order_items', 'id'), (SELECT MAX(id) FROM order_items), true);

-- ---------------------------------------------------------------------------
-- Generated order history.
--
-- For the five completed months plus the current month up to two days ago,
-- every teacher (except the hand-written showcase teachers 3 and 6) places one
-- delivery-eligible order on about six weekdays in seven, at one of the five
-- active locations, with one or two items. This gives the monthly report,
-- teacher profile cards and budget ledgers realistic six-month depth.
--
-- The temp table holds the "recipe" for each order so orders, items, ledger
-- entries and status events can all be inserted from the same deterministic
-- pick. It disappears when this seed transaction commits.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE seed_gen ON COMMIT DROP AS
WITH days AS (
  SELECT generate_series(
           date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date) - interval '5 months',
           (now() AT TIME ZONE 'Asia/Dhaka')::date - 2,
           interval '1 day'
         )::date AS order_date
)
SELECT u.id AS teacher_id,
       l.id AS food_location_id,
       d.order_date,
       mi.id AS menu_item_id,
       mi.price_paisa AS unit_price,
       1 + ((EXTRACT(DAY FROM d.order_date)::int + u.id) % 2) AS quantity
FROM users u
CROSS JOIN days d
JOIN food_locations l
  ON l.id = 1 + (u.id % 5)
 AND l.is_active
JOIN menu_items mi
  ON mi.id = (l.id - 1) * 18 + 1 + ((u.id + EXTRACT(DAY FROM d.order_date)::int) % 18)
WHERE u.role = 'TEACHER'
  AND u.id NOT IN (3, 6)
  AND EXTRACT(ISODOW FROM d.order_date) < 6
  AND (EXTRACT(DAY FROM d.order_date)::int + u.id) % 7 <> 3;

INSERT INTO orders
  (teacher_id, food_location_id, order_date, status, total_paisa,
   delivery_confirmed_at, delivery_confirmed_by, confirmed_at, created_at)
SELECT g.teacher_id, g.food_location_id, g.order_date, 'DELIVERED',
       g.unit_price * g.quantity,
       timezone('UTC', g.order_date + time '07:05' + ((g.teacher_id % 5) * interval '4 minutes')),
       2,
       timezone('UTC', g.order_date + time '05:10' + ((g.teacher_id % 4) * interval '7 minutes')),
       timezone('UTC', g.order_date + time '05:10' + ((g.teacher_id % 4) * interval '7 minutes'))
FROM seed_gen g;

INSERT INTO order_items
  (order_id, menu_item_id, item_name_snapshot,
   unit_price_paisa_snapshot, quantity, line_total_paisa, status)
SELECT o.id, g.menu_item_id, mi.name, g.unit_price, g.quantity,
       g.unit_price * g.quantity, 'DELIVERED'
FROM seed_gen g
JOIN orders o
  ON o.teacher_id = g.teacher_id AND o.order_date = g.order_date
JOIN menu_items mi ON mi.id = g.menu_item_id;

INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, order_id, reason, created_by, created_at)
SELECT o.teacher_id, NULL,
       EXTRACT(YEAR FROM o.order_date)::int, EXTRACT(MONTH FROM o.order_date)::int,
       'debit', -o.total_paisa, o.id, 'Order on ' || o.order_date::text, o.teacher_id,
       o.created_at
FROM seed_gen g
JOIN orders o
  ON o.teacher_id = g.teacher_id AND o.order_date = g.order_date;

INSERT INTO order_status_events
  (order_id, order_item_id, old_status, new_status, changed_by, note, created_at)
SELECT o.id, NULL, NULL, 'CONFIRMED', o.teacher_id, 'Order placed', o.created_at
FROM seed_gen g
JOIN orders o
  ON o.teacher_id = g.teacher_id AND o.order_date = g.order_date;

INSERT INTO order_status_events
  (order_id, order_item_id, old_status, new_status, changed_by, note, created_at)
SELECT o.id, NULL, 'CONFIRMED', 'DELIVERED', 2, NULL, o.delivery_confirmed_at
FROM seed_gen g
JOIN orders o
  ON o.teacher_id = g.teacher_id AND o.order_date = g.order_date;

-- ---------------------------------------------------------------------------
-- Budget requests: a mix of pending, approved and rejected, so both the
-- teacher submission list and the admin inbox have something to show.
-- Approving a budget_increase books an adjustment to the current month;
-- approving a debt_allowance raises the teacher's allowance.
-- ---------------------------------------------------------------------------
WITH v AS (
  SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date AS today
)
INSERT INTO budget_requests
  (id, teacher_id, request_type, amount_paisa, reason, status, decided_by, decided_at, created_at)
SELECT r.id, r.teacher_id, r.request_type, r.amount, r.reason, r.status, r.decided_by,
       CASE WHEN r.decided_by IS NULL THEN NULL
            ELSE timezone('UTC', v.today + r.decided_day + r.decided_time) END,
       timezone('UTC', v.today + r.created_day + r.created_time)
FROM (VALUES
  (1, 3, 'budget_increase', 20000, 'Conference guests next week - need extra meals', 'approved', 1, -6, time '09:00', -5, time '10:00'),
  (2, 3, 'debt_allowance',  30000, 'Exam week: may need meals before the allocation arrives', 'rejected', 1, -4, time '11:00', -3, time '09:30'),
  (3, 3, 'budget_increase', 15000, 'Departmental lunch on Thursday', 'pending', NULL, 0, time '04:00', NULL, NULL),
  (4, 5, 'debt_allowance',  20000, 'Waiting for this month''s research allowance', 'pending', NULL, -1, time '08:30', NULL, NULL),
  (5, 6, 'debt_allowance',  20000, 'Recurring shortfall at the end of the month', 'approved', 1, -8, time '09:15', -7, time '10:05')
) AS r(id, teacher_id, request_type, amount, reason, status, decided_by,
       created_day, created_time, decided_day, decided_time)
CROSS JOIN v;

UPDATE users SET debt_allowance_paisa = 20000 WHERE id = 6;

INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by)
SELECT br.teacher_id, NULL, v.y, v.mo, 'adjustment', br.amount_paisa,
       'Budget request #' || br.id || ' approved', 1
FROM budget_requests br
CROSS JOIN (
  SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Dhaka'))::int AS y,
         EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Dhaka'))::int AS mo
) AS v
WHERE br.status = 'approved' AND br.request_type = 'budget_increase';

-- ---------------------------------------------------------------------------
-- Balance alignment.
--
-- The generated history leaves most teachers with a healthy balance. Three
-- teachers are aligned to specific demonstration states via a single admin
-- adjustment each (computed from the current totals, so this stays exact
-- regardless of how the generated history sums up):
--   id 3  ->  5000 paisa (50 taka): the low-balance warning shows, yet new
--             orders still fit inside the debt policy.
--   id 6  -> -45000 paisa (-450 taka): inside the 500 taka debt cap, with the
--             approved 20000 allowance giving extra headroom.
--   id 17 -> -30000 paisa (-300 taka): the debt warning shows; the debt-order
--             cap has already been reached, so further debt orders are refused.
-- ---------------------------------------------------------------------------
WITH targets AS (
  SELECT * FROM (VALUES (3, 5000), (6, -45000), (17, -30000)) AS t(id, target)
)
INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by)
SELECT targets.id, NULL, v.y, v.mo, 'adjustment',
       targets.target
         - COALESCE((SELECT SUM(a.allocated_paisa)
                       FROM budget_monthly_allocations a
                      WHERE a.teacher_id = targets.id), 0)
         - COALESCE((SELECT SUM(l.amount_paisa)
                       FROM budget_ledger l
                      WHERE l.teacher_id = targets.id
                        AND l.entry_type <> 'allocation'
                        AND l.year IS NOT NULL), 0),
       'Balance correction: migrated from the legacy period system', 1
FROM targets
CROSS JOIN (
  SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Dhaka'))::int AS y,
         EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Dhaka'))::int AS mo
) AS v;

-- ---------------------------------------------------------------------------
-- Audit trail entries.
-- ---------------------------------------------------------------------------
INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
VALUES
  (1, 'budget.monthly_allocation.created', 'budget_monthly_allocation', NULL,
   '{"window":"current Dhaka month plus five prior","source":"seed"}'),
  (1, 'user.created', 'user', 1, '{"role":"ADMIN","source":"seed"}'),
  (1, 'user.created', 'user', 2, '{"role":"STAFF","source":"seed"}'),
  (1, 'budget.request.decided', 'budget_request', 1,
   '{"decision":"approved","type":"budget_increase","amountPaisa":20000,"source":"seed"}'),
  (1, 'budget.request.decided', 'budget_request', 2,
   '{"decision":"rejected","type":"debt_allowance","amountPaisa":30000,"source":"seed"}'),
  (1, 'budget.request.decided', 'budget_request', 5,
   '{"decision":"approved","type":"debt_allowance","amountPaisa":20000,"source":"seed"}'),
  (1, 'budget.monthly.adjusted', 'budget_ledger', NULL,
   '{"teachers":[3,6,17],"reason":"legacy migration correction","source":"seed"}');

-- ---------------------------------------------------------------------------
-- Demo credentials. Change or remove before deployment.
-- ---------------------------------------------------------------------------
-- admin@juniv.edu   / AdminPass123!
-- staff@juniv.edu   / StaffPass123!
-- teacher@juniv.edu / TeacherPass123!  (featured low-balance account)
--
-- Every other teacher account also uses TeacherPass123!, including
-- sarnali.basak@juniv.edu (in debt) and imdadul.islam@juniv.edu
-- (in debt with an approved debt allowance).

-- ---------------------------------------------------------------------------
-- Canonical campus vendors.
--
-- The live panel standardised on six English-named vendors: Bottola,
-- Cafeteria, Chattor, Dairy Farm, Gerua and Prantik. Location names are
-- English only (Bangla goes into name_bn, which is optional). This block adds
-- the four vendors that are not part of the original demo set — menus follow
-- the same generated-catalogue scheme, "(location id - 1) * 18 + item number,
-- price + (location id - 1) * 25 paisa" — and deactivates every vendor outside
-- the canonical list.
-- ---------------------------------------------------------------------------
INSERT INTO food_locations (id, name, name_bn, description, is_active) VALUES
  (9,  'Bottola',    'বোত্তলা',      'বটতলা',          true),
  (10, 'Dairy Farm', 'ডেইরি ফার্ম',   NULL,             true),
  (11, 'Gerua',      'গেরুয়া',       NULL,             true),
  (12, 'Prantik',    'প্রান্তিক',     NULL,             true);

-- Menus for the four new vendors, derived from the base catalogue (location 1
-- carries the un-offset base prices).
INSERT INTO menu_items
  (id, food_location_id, name, description, category, price_paisa, is_available)
SELECT
  (l.id - 1) * 18 + src.n,
  l.id,
  src.name,
  src.description,
  src.category,
  src.price_paisa + (l.id - 1) * 25,
  true
FROM food_locations l
CROSS JOIN (
  SELECT id AS n, name, description, category, price_paisa
  FROM menu_items
  WHERE food_location_id = 1
) src
WHERE l.id IN (9, 10, 11, 12)
ORDER BY l.id, src.n;

-- Only the six canonical vendors stay active.
UPDATE food_locations
SET is_active = false
WHERE name NOT IN ('Bottola', 'Cafeteria', 'Chattor', 'Dairy Farm', 'Gerua', 'Prantik');

-- ---------------------------------------------------------------------------
-- Synchronize serial/bigserial sequences after explicit demo IDs.
--
-- TRUNCATE ... RESTART IDENTITY resets sequences. Explicit IDs in INSERT
-- statements do not advance those sequences, so a later INSERT could attempt
-- to reuse an existing ID and cause a primary-key violation.
--
-- This block advances sequences when they are behind the maximum existing ID.
-- It does not move a sequence backwards or modify existing records.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sequence_row record;
  max_id bigint;
  current_value bigint;
  sequence_called boolean;
BEGIN
  FOR sequence_row IN
    SELECT
      c.table_schema,
      c.table_name,
      c.column_name,
      pg_get_serial_sequence(
        format('%I.%I', c.table_schema, c.table_name),
        c.column_name
      ) AS sequence_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_default LIKE 'nextval(%'
  LOOP
    IF sequence_row.sequence_name IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT MAX(%I) FROM %I.%I',
      sequence_row.column_name,
      sequence_row.table_schema,
      sequence_row.table_name
    )
    INTO max_id;

    EXECUTE format(
      'SELECT last_value, is_called FROM %s',
      sequence_row.sequence_name::regclass
    )
    INTO current_value, sequence_called;

    IF max_id IS NOT NULL AND (
      current_value < max_id
      OR (current_value = max_id AND NOT sequence_called)
    ) THEN
      PERFORM setval(
        sequence_row.sequence_name::regclass,
        max_id,
        true
      );
    END IF;
  END LOOP;
END $$;
