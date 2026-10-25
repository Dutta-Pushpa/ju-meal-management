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
-- Application settings (current policy settings only).
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value, description) VALUES
  ('order_placement_deadline', '"12:30"',
   'Latest clock time (Dhaka business time) a teacher may place an order. Enforced by the backend.'),
  ('order_cancellation_deadline', '"13:00"',
   'Latest clock time (Dhaka business time) an order may be cancelled. Enforced by the backend.'),
  ('negative_balance_allowed', 'false',
   'Whether a teacher may place orders that push their remaining balance below zero.'),
  ('max_debt_paisa', '0',
   'Maximum permitted outstanding debt in paisa when negative balance is allowed. Zero means no debt permitted.'),
  ('max_additional_orders', '0',
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
-- ---------------------------------------------------------------------------
INSERT INTO food_locations (id, name, name_bn, description) VALUES
  (1, 'Radhuni',      'রাধুনী',        'বটতলা'),
  (2, 'Rafi',         'রাফি',          'বটতলা'),
  (3, 'Nurjahan',     'নূরজাহান',      'বটতলা'),
  (4, 'Jax Kitchen',  'জ্যাক্স কিচেন', 'বটতলা'),
  (5, 'Cafeteria',    'ক্যাফেটেরিয়া', NULL),
  (6, 'Chattor',      'চত্বর',          NULL),
  (7, 'Tasty Treat',  'টেস্টি ট্রিট',  NULL),
  (8, 'Fry Town',     'ফ্রাই টাউন',    NULL);

-- ---------------------------------------------------------------------------
-- Menu items.
--
-- All locations currently share this demo menu. Item ids are
-- (location id - 1) * 18 + item number, so location 1 has ids 1-18, location 2
-- has 19-36, location 3 has 37-54, location 4 has 55-72, location 5 has 73-90,
-- location 6 has 91-108, location 7 has 109-126 and location 8 has 127-144.
-- ---------------------------------------------------------------------------
INSERT INTO menu_items
  (id, food_location_id, name, description, category, price_paisa, is_available)
SELECT
  (l.id - 1) * 18 + t.n,
  l.id,
  t.name,
  t.description,
  t.category,
  t.price_paisa,
  true
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
-- Budget periods. Retained for historical reporting only; monthly allocations
-- are the current model.
-- ---------------------------------------------------------------------------
INSERT INTO budget_periods (id, name, starts_on, ends_on) VALUES
  (1, '2026-W41', '2026-10-05', '2026-10-11'),
  (2, '2026-W42', '2026-10-12', '2026-10-18'),
  (3, '2026-W43', '2026-10-19', '2026-10-25');

-- ---------------------------------------------------------------------------
-- Monthly allocations for October 2026, plus matching ledger credits.
--
-- 280000 paisa = 2,800 taka per teacher. The ledger entries have no budget
-- period (monthly allocation replaces periods) and carry year/month.
-- ---------------------------------------------------------------------------
INSERT INTO budget_monthly_allocations
  (teacher_id, year, month, allocated_paisa, carried_forward_paisa, created_by)
SELECT id, 2026, 10, 280000, 0, 1
FROM users
WHERE role = 'TEACHER'
ORDER BY id;

INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by)
SELECT id, NULL, 2026, 10, 'allocation', 280000, 'Monthly allocation for 2026-10', 1
FROM users
WHERE role = 'TEACHER'
ORDER BY id;

-- ---------------------------------------------------------------------------
-- Orders on previous dates for the staff daily view.
-- ---------------------------------------------------------------------------
INSERT INTO orders
  (id, teacher_id, food_location_id, order_date, status, total_paisa,
   confirmed_at, created_at, cancelled_at)
VALUES
  (1, 3, 1, '2026-10-14', 'DELIVERED', 11500,
   '2026-10-14T05:10:00Z', '2026-10-14T05:10:00Z', NULL),
  (2, 4, 2, '2026-10-14', 'DELIVERED', 4000,
   '2026-10-14T05:25:00Z', '2026-10-14T05:25:00Z', NULL),
  (3, 5, 4, '2026-10-14', 'DELIVERED', 10000,
   '2026-10-14T06:02:00Z', '2026-10-14T06:02:00Z', NULL),
  (4, 3, 1, '2026-10-15', 'DELIVERED', 5000,
   '2026-10-15T05:05:00Z', '2026-10-15T05:05:00Z', NULL),
  (5, 6, 1, '2026-10-15', 'DELIVERED', 10000,
   '2026-10-15T05:30:00Z', '2026-10-15T05:30:00Z', NULL),
  (6, 7, 3, '2026-10-15', 'COLLECTED', 7000,
   '2026-10-15T06:12:00Z', '2026-10-15T06:12:00Z', NULL),
  (7, 5, 2, '2026-10-15', 'CANCELLED', 1000,
   '2026-10-15T05:45:00Z', '2026-10-15T05:45:00Z',
   '2026-10-15T06:20:00Z');

-- ---------------------------------------------------------------------------
-- Order item snapshots.
-- ---------------------------------------------------------------------------
INSERT INTO order_items
  (id, order_id, menu_item_id, item_name_snapshot,
   unit_price_paisa_snapshot, quantity, line_total_paisa, status)
VALUES
  (1,  1,  7, 'মুরগির মাংস (ডাল)',  5000, 2, 10000, 'DELIVERED'),
  (2,  1,  4, 'ঘন ডাল',              1500, 1,  1500, 'DELIVERED'),
  (3,  2, 24, 'ডিম',                 2000, 1,  2000, 'DELIVERED'),
  (4,  2, 28, 'মাছ ভর্তা',           2000, 1,  2000, 'DELIVERED'),
  (5,  3, 69, 'রুই মাছ',             5000, 1,  5000, 'DELIVERED'),
  (6,  3, 70, 'পাঙ্গাশ মাছ',         5000, 1,  5000, 'DELIVERED'),
  (7,  4,  7, 'মুরগির মাংস (ডাল)',  5000, 1,  5000, 'DELIVERED'),
  (8,  5, 15, 'রুই মাছ',             5000, 1,  5000, 'DELIVERED'),
  (9,  5, 16, 'পাঙ্গাশ মাছ',         5000, 1,  5000, 'DELIVERED'),
  (10, 6, 53, 'টেংরা মাছ',           4000, 1,  4000, 'COLLECTED'),
  (11, 6, 54, 'ছোট মাছ / গুঁড়া মাছ', 3000, 1,  3000, 'COLLECTED'),
  (12, 7, 19, '১ প্লেট ভাত',          1000, 1,  1000, 'PENDING');

-- ---------------------------------------------------------------------------
-- Ledger debits and refund (Dhaka business month is October 2026).
-- ---------------------------------------------------------------------------
INSERT INTO budget_ledger
  (teacher_id, budget_period_id, year, month, entry_type, amount_paisa,
   order_id, reason, created_by)
VALUES
  (3, NULL, 2026, 10, 'debit',  -11500, 1, 'Order on 2026-10-14', 3),
  (4, NULL, 2026, 10, 'debit',   -4000, 2, 'Order on 2026-10-14', 4),
  (5, NULL, 2026, 10, 'debit',  -10000, 3, 'Order on 2026-10-14', 5),
  (3, NULL, 2026, 10, 'debit',   -5000, 4, 'Order on 2026-10-15', 3),
  (6, NULL, 2026, 10, 'debit',  -10000, 5, 'Order on 2026-10-15', 6),
  (7, NULL, 2026, 10, 'debit',   -7000, 6, 'Order on 2026-10-15', 7),
  (5, NULL, 2026, 10, 'debit',   -1000, 7, 'Order on 2026-10-15', 5),
  (5, NULL, 2026, 10, 'refund',   1000, 7,
   'Order cancelled by the teacher before the cutoff', 5);

-- ---------------------------------------------------------------------------
-- Order status history.
-- ---------------------------------------------------------------------------
INSERT INTO order_status_events
  (order_id, order_item_id, old_status, new_status, changed_by, note, created_at)
VALUES
  (1, NULL, NULL, 'CONFIRMED', 3, 'Order placed', '2026-10-14T05:10:00Z'),
  (1, 1, 'PENDING', 'COLLECTED', 2, 'Collected from vendor', '2026-10-14T11:40:00Z'),
  (1, 1, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', '2026-10-14T12:35:00Z'),
  (1, 2, 'PENDING', 'COLLECTED', 2, 'Collected from vendor', '2026-10-14T11:40:00Z'),
  (1, 2, 'COLLECTED', 'DELIVERED', 2, 'Handed to teacher', '2026-10-14T12:35:00Z'),
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
  (7, NULL, 'CONFIRMED', 'CANCELLED', 5,
   'Cancelled by the teacher before the cutoff', '2026-10-15T06:20:00Z');

-- ---------------------------------------------------------------------------
-- Audit trail entries.
-- ---------------------------------------------------------------------------
INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
VALUES
  (1, 'budget.monthly_allocation.created', 'budget_monthly_allocation', NULL,
   '{"year":2026,"month":10,"teachers":27,"amountPaisa":280000,"source":"seed"}'),
  (1, 'user.created', 'user', 1, '{"role":"ADMIN","source":"seed"}'),
  (1, 'user.created', 'user', 2, '{"role":"STAFF","source":"seed"}');

-- ---------------------------------------------------------------------------
-- Demo credentials. Change or remove before deployment.
-- ---------------------------------------------------------------------------
-- admin@juniv.edu   / AdminPass123!
-- staff@juniv.edu   / StaffPass123!
-- teacher@juniv.edu / TeacherPass123!

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