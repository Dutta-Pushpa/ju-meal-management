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
INSERT INTO users (id, full_name, email, password_hash, role, designation, permissions) VALUES
  (1, 'Demo Admin',                       'admin@juniv.edu',             :admin_password_hash,   'ADMIN',   NULL,                  '["users:create","users:manage","settings:manage","budgets:allocate","budgets:adjust","budgets:view","locations:manage","menu_items:manage","orders:cancel","orders:manage_status"]'),
  (2, 'Demo Staff',                       'staff@juniv.edu',             :staff_password_hash,   'STAFF',   NULL,                  '["orders:manage_status","locations:manage","menu_items:manage"]'),
  (3, 'Dr. Jugal Krishna Das',             'teacher@juniv.edu',           :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (4, 'Dr. Mohammad Shorif Uddin',         'shorif.uddin@juniv.edu',       :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (5, 'Dr. Mohammad Zahidur Rahman',       'zahidur.rahman@juniv.edu',     :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (6, 'Dr. Md. Imdadul Islam',             'imdadul.islam@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (7, 'Dr. Liton Jude Rozario',            'liton.rozario@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (8, 'Md. Golam Moazzam',                 'golam.moazzam@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (9, 'Dr. Israt Jahan',                   'israt.jahan@juniv.edu',        :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (10, 'Dr. Md. Humayun Kabir',            'humayun.kabir@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (11, 'Dr. Md Abul Kalam Azad',           'kalam.azad@juniv.edu',         :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (12, 'Abu Sayed Md. Mostafizur Rahaman', 'mostafizur.rahaman@juniv.edu', :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (13, 'Dr. Md. Ezharul Islam',            'ezharul.islam@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (14, 'Dr. Morium Akter',                 'morium.akter@juniv.edu',       :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (15, 'Dr. Sanjit Kumar Saha',            'sanjit.saha@juniv.edu',        :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (16, 'Dr. Md. Musfique Anwar',           'musfique.anwar@juniv.edu',     :teacher_password_hash, 'TEACHER', 'Professor',           '[]'),
  (17, 'Sarnali Basak',                    'sarnali.basak@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Associate Professor', '[]'),
  (18, 'Amina Khatun',                     'amina.khatun@juniv.edu',       :teacher_password_hash, 'TEACHER', 'Associate Professor', '[]'),
  (19, 'Sabrina Sharmin',                  'sabrina.sharmin@juniv.edu',    :teacher_password_hash, 'TEACHER', 'Associate Professor', '[]'),
  (20, 'Tahsina Hashem',                   'tahsina.hashem@juniv.edu',     :teacher_password_hash, 'TEACHER', 'Assistant Professor', '[]'),
  (21, 'Md. Rafsan Jani',                  'rafsan.jani@juniv.edu',        :teacher_password_hash, 'TEACHER', 'Associate Professor', '[]'),
  (22, 'Mohammad Ashraful Islam',          'ashraful.islam@juniv.edu',     :teacher_password_hash, 'TEACHER', 'Assistant Professor', '[]'),
  (23, 'Bulbul Ahammad',                   'bulbul.ahammad@juniv.edu',     :teacher_password_hash, 'TEACHER', 'Assistant Professor', '[]'),
  (24, 'Anup Majumder',                    'anup.majumder@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Assistant Professor', '[]'),
  (25, 'Nadia Afrin Ritu',                 'nadia.ritu@juniv.edu',         :teacher_password_hash, 'TEACHER', 'Assistant Professor', '[]'),
  (26, 'Samsun Nahar Khandakar',           'samsun.khandakar@juniv.edu',   :teacher_password_hash, 'TEACHER', 'Assistant Professor', '[]'),
  (27, 'Md. Masum Bhuiyan',                'masum.bhuiyan@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Lecturer',            '[]'),
  (28, 'Nishat Tasnim',                    'nishat.tasnim@juniv.edu',      :teacher_password_hash, 'TEACHER', 'Lecturer',            '[]'),
  (29, 'Lubna Yasmin Pinky',               'lubna.pinky@juniv.edu',        :teacher_password_hash, 'TEACHER', 'Lecturer',            '[]');

-- ---------------------------------------------------------------------------
-- Food locations.
-- ---------------------------------------------------------------------------
INSERT INTO food_locations (id, name, name_bn, description) VALUES
  (1, 'রাধুনী',       'রাধুনী',       'বটতলা'),
  (2, 'রাফি',         'রাফি',         'বটতলা'),
  (3, 'নূরজাহান',     'নূরজাহান',     'বটতলা'),
  (4, 'জ্যাক্স কিচেন', 'জ্যাক্স কিচেন', 'বটতলা');

-- All four Bot Tola shops currently share this menu. A shop-specific menu can
-- be added later by inserting or updating only that shop's menu_items rows.
INSERT INTO menu_items (id, food_location_id, name, description, category, price_paisa, is_available) VALUES
  (1,  1, '১ প্লেট ভাত',              'One plate rice',       'ভাত ও ডাল', 1000, true),
  (2,  1, 'হাফ প্লেট ভাত',             'Half plate rice',      'ভাত ও ডাল',  500, true),
  (3,  1, 'পাতলা ডাল',                'Dal',                 'ভাত ও ডাল', 1000, true),
  (4,  1, 'ঘন ডাল',                   'Ghono dal',            'ভাত ও ডাল', 1500, true),
  (5,  1, 'ডাল বড়া',                 'Dal bora',             'ভাত ও ডাল', 1000, true),
  (6,  1, 'ডিম',                      'Egg',                  'ডিম ও মাংস', 2000, true),
  (7,  1, 'মুরগির মাংস (ডাল)',        'Chicken (dal)',        'ডিম ও মাংস', 5000, true),
  (8,  1, 'মুরগির মাংস (ঝাল ফ্রাই)',  'Chicken (jhal fry)',   'ডিম ও মাংস', 5000, true),
  (9,  1, 'আলু ভর্তা',                'Alu bhorta',           'ভর্তা ও শাক', 1000, true),
  (10, 1, 'মাছ ভর্তা',                'Mach bhorta',          'ভর্তা ও শাক', 2000, true),
  (11, 1, 'পুঁই শাক',                 'Pui shak',             'ভর্তা ও শাক', 2000, true),
  (12, 1, 'পালং শাক',                 'Palong shak',          'ভর্তা ও শাক', 2000, true),
  (13, 1, 'কলমি শাক',                 'Kolmi shak',           'ভর্তা ও শাক', 2000, true),
  (14, 1, 'লাল শাক',                  'Laal shak',            'ভর্তা ও শাক', 2000, true),
  (15, 1, 'রুই মাছ',                  'Rui mach',             'মাছ',       5000, true),
  (16, 1, 'পাঙ্গাশ মাছ',              'Pangash mach',         'মাছ',       5000, true),
  (17, 1, 'টেংরা মাছ',                'Tengra mach',          'মাছ',       4000, true),
  (18, 1, 'ছোট মাছ / গুঁড়া মাছ',      'Choto mach',           'মাছ',       3000, true),
  (19, 2, '১ প্লেট ভাত',              'One plate rice',       'ভাত ও ডাল', 1000, true),
  (20, 2, 'হাফ প্লেট ভাত',             'Half plate rice',      'ভাত ও ডাল',  500, true),
  (21, 2, 'পাতলা ডাল',                'Dal',                 'ভাত ও ডাল', 1000, true),
  (22, 2, 'ঘন ডাল',                   'Ghono dal',            'ভাত ও ডাল', 1500, true),
  (23, 2, 'ডাল বড়া',                 'Dal bora',             'ভাত ও ডাল', 1000, true),
  (24, 2, 'ডিম',                      'Egg',                  'ডিম ও মাংস', 2000, true),
  (25, 2, 'মুরগির মাংস (ডাল)',        'Chicken (dal)',        'ডিম ও মাংস', 5000, true),
  (26, 2, 'মুরগির মাংস (ঝাল ফ্রাই)',  'Chicken (jhal fry)',   'ডিম ও মাংস', 5000, true),
  (27, 2, 'আলু ভর্তা',                'Alu bhorta',           'ভর্তা ও শাক', 1000, true),
  (28, 2, 'মাছ ভর্তা',                'Mach bhorta',          'ভর্তা ও শাক', 2000, true),
  (29, 2, 'পুঁই শাক',                 'Pui shak',             'ভর্তা ও শাক', 2000, true),
  (30, 2, 'পালং শাক',                 'Palong shak',          'ভর্তা ও শাক', 2000, true),
  (31, 2, 'কলমি শাক',                 'Kolmi shak',           'ভর্তা ও শাক', 2000, true),
  (32, 2, 'লাল শাক',                  'Laal shak',            'ভর্তা ও শাক', 2000, true),
  (33, 2, 'রুই মাছ',                  'Rui mach',             'মাছ',       5000, true),
  (34, 2, 'পাঙ্গাশ মাছ',              'Pangash mach',         'মাছ',       5000, true),
  (35, 2, 'টেংরা মাছ',                'Tengra mach',          'মাছ',       4000, true),
  (36, 2, 'ছোট মাছ / গুঁড়া মাছ',      'Choto mach',           'মাছ',       3000, true),
  (37, 3, '১ প্লেট ভাত',              'One plate rice',       'ভাত ও ডাল', 1000, true),
  (38, 3, 'হাফ প্লেট ভাত',             'Half plate rice',      'ভাত ও ডাল',  500, true),
  (39, 3, 'পাতলা ডাল',                'Dal',                 'ভাত ও ডাল', 1000, true),
  (40, 3, 'ঘন ডাল',                   'Ghono dal',            'ভাত ও ডাল', 1500, true),
  (41, 3, 'ডাল বড়া',                 'Dal bora',             'ভাত ও ডাল', 1000, true),
  (42, 3, 'ডিম',                      'Egg',                  'ডিম ও মাংস', 2000, true),
  (43, 3, 'মুরগির মাংস (ডাল)',        'Chicken (dal)',        'ডিম ও মাংস', 5000, true),
  (44, 3, 'মুরগির মাংস (ঝাল ফ্রাই)',  'Chicken (jhal fry)',   'ডিম ও মাংস', 5000, true),
  (45, 3, 'আলু ভর্তা',                'Alu bhorta',           'ভর্তা ও শাক', 1000, true),
  (46, 3, 'মাছ ভর্তা',                'Mach bhorta',          'ভর্তা ও শাক', 2000, true),
  (47, 3, 'পুঁই শাক',                 'Pui shak',             'ভর্তা ও শাক', 2000, true),
  (48, 3, 'পালং শাক',                 'Palong shak',          'ভর্তা ও শাক', 2000, true),
  (49, 3, 'কলমি শাক',                 'Kolmi shak',           'ভর্তা ও শাক', 2000, true),
  (50, 3, 'লাল শাক',                  'Laal shak',            'ভর্তা ও শাক', 2000, true),
  (51, 3, 'রুই মাছ',                  'Rui mach',             'মাছ',       5000, true),
  (52, 3, 'পাঙ্গাশ মাছ',              'Pangash mach',         'মাছ',       5000, true),
  (53, 3, 'টেংরা মাছ',                'Tengra mach',          'মাছ',       4000, true),
  (54, 3, 'ছোট মাছ / গুঁড়া মাছ',      'Choto mach',           'মাছ',       3000, true),
  (55, 4, '১ প্লেট ভাত',              'One plate rice',       'ভাত ও ডাল', 1000, true),
  (56, 4, 'হাফ প্লেট ভাত',             'Half plate rice',      'ভাত ও ডাল',  500, true),
  (57, 4, 'পাতলা ডাল',                'Dal',                 'ভাত ও ডাল', 1000, true),
  (58, 4, 'ঘন ডাল',                   'Ghono dal',            'ভাত ও ডাল', 1500, true),
  (59, 4, 'ডাল বড়া',                 'Dal bora',             'ভাত ও ডাল', 1000, true),
  (60, 4, 'ডিম',                      'Egg',                  'ডিম ও মাংস', 2000, true),
  (61, 4, 'মুরগির মাংস (ডাল)',        'Chicken (dal)',        'ডিম ও মাংস', 5000, true),
  (62, 4, 'মুরগির মাংস (ঝাল ফ্রাই)',  'Chicken (jhal fry)',   'ডিম ও মাংস', 5000, true),
  (63, 4, 'আলু ভর্তা',                'Alu bhorta',           'ভর্তা ও শাক', 1000, true),
  (64, 4, 'মাছ ভর্তা',                'Mach bhorta',          'ভর্তা ও শাক', 2000, true),
  (65, 4, 'পুঁই শাক',                 'Pui shak',             'ভর্তা ও শাক', 2000, true),
  (66, 4, 'পালং শাক',                 'Palong shak',          'ভর্তা ও শাক', 2000, true),
  (67, 4, 'কলমি শাক',                 'Kolmi shak',           'ভর্তা ও শাক', 2000, true),
  (68, 4, 'লাল শাক',                  'Laal shak',            'ভর্তা ও শাক', 2000, true),
  (69, 4, 'রুই মাছ',                  'Rui mach',             'মাছ',       5000, true),
  (70, 4, 'পাঙ্গাশ মাছ',              'Pangash mach',         'মাছ',       5000, true),
  (71, 4, 'টেংরা মাছ',                'Tengra mach',          'মাছ',       4000, true),
  (72, 4, 'ছোট মাছ / গুঁড়া মাছ',      'Choto mach',           'মাছ',       3000, true);

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
  (8, 2, 70000, 1),
  (9, 2, 70000, 1),
  (10, 2, 70000, 1),
  (11, 2, 70000, 1),
  (12, 2, 70000, 1),
  (13, 2, 70000, 1),
  (14, 2, 70000, 1),
  (15, 2, 70000, 1),
  (16, 2, 70000, 1),
  (17, 2, 70000, 1),
  (18, 2, 70000, 1),
  (19, 2, 70000, 1),
  (20, 2, 70000, 1),
  (21, 2, 70000, 1),
  (22, 2, 70000, 1),
  (23, 2, 70000, 1),
  (24, 2, 70000, 1),
  (25, 2, 70000, 1),
  (26, 2, 70000, 1),
  (27, 2, 70000, 1),
  (28, 2, 70000, 1),
  (29, 2, 70000, 1),
  (3, 1, 70000, 1),
  (4, 1, 70000, 1);

INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by) VALUES
  (3, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (4, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (5, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (6, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (7, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (8, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (9, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (10, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (11, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (12, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (13, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (14, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (15, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (16, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (17, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (18, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (19, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (20, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (21, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (22, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (23, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (24, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (25, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (26, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (27, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (28, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (29, 2, 'allocation', 70000, 'Weekly allocation', 1),
  (3, 1, 'allocation', 70000, 'Weekly allocation', 1),
  (4, 1, 'allocation', 70000, 'Weekly allocation', 1);

-- ---------------------------------------------------------------------------
-- Orders on two past dates, so the staff daily view has content regardless of
-- when the demo is run. Prices in order_items are snapshots taken from the
-- menu prices above at the stated quantities.
-- ---------------------------------------------------------------------------
INSERT INTO orders (id, teacher_id, food_location_id, order_date, status, total_paisa, confirmed_at, created_at, cancelled_at) VALUES
  -- 2026-10-14, all confirmed
  (1, 3, 1, '2026-10-14', 'CONFIRMED', 11500, '2026-10-14T05:10:00Z', '2026-10-14T05:10:00Z', NULL),
  (2, 4, 2, '2026-10-14', 'CONFIRMED', 4000, '2026-10-14T05:25:00Z', '2026-10-14T05:25:00Z', NULL),
  (3, 5, 4, '2026-10-14', 'CONFIRMED', 10000, '2026-10-14T06:02:00Z', '2026-10-14T06:02:00Z', NULL),
  -- 2026-10-15, progressed through collection
  (4, 3, 1, '2026-10-15', 'DELIVERED', 5000, '2026-10-15T05:05:00Z', '2026-10-15T05:05:00Z', NULL),
  (5, 6, 1, '2026-10-15', 'DELIVERED', 10000, '2026-10-15T05:30:00Z', '2026-10-15T05:30:00Z', NULL),
  (6, 7, 3, '2026-10-15', 'COLLECTED', 7000, '2026-10-15T06:12:00Z', '2026-10-15T06:12:00Z', NULL),
  -- A cancelled order, so the refund path is represented in demo data.
  -- cancelled_at is required by the orders_cancelled_fields_check constraint,
  -- which is why a cancelled row must record exactly when it was cancelled.
  (7, 5, 2, '2026-10-15', 'CANCELLED', 1000, '2026-10-15T05:45:00Z', '2026-10-15T05:45:00Z', '2026-10-15T06:20:00Z');

-- Snapshots: name and unit price at the time of ordering. Never joined back to
-- menu_items for reporting.
INSERT INTO order_items (id, order_id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot, quantity, line_total_paisa, status) VALUES
  (1,  1,  7, 'মুরগির মাংস (ডাল)', 5000, 2, 10000, 'DELIVERED'),
  (2,  1,  4, 'ঘন ডাল',             1500, 1,  1500, 'DELIVERED'),
  (3,  2, 24, 'ডিম',                2000, 1,  2000, 'DELIVERED'),
  (4,  2, 28, 'মাছ ভর্তা',          2000, 1,  2000, 'DELIVERED'),
  (5,  3, 69, 'রুই মাছ',            5000, 1,  5000, 'DELIVERED'),
  (6,  3, 70, 'পাঙ্গাশ মাছ',        5000, 1,  5000, 'DELIVERED'),
  (7,  4,  7, 'মুরগির মাংস (ডাল)', 5000, 1,  5000, 'DELIVERED'),
  (8,  5, 15, 'রুই মাছ',            5000, 1,  5000, 'DELIVERED'),
  (9,  5, 16, 'পাঙ্গাশ মাছ',        5000, 1,  5000, 'DELIVERED'),
  (10, 6, 53, 'টেংরা মাছ',          4000, 1,  4000, 'COLLECTED'),
  (11, 6, 54, 'ছোট মাছ / গুঁড়া মাছ', 3000, 1,  3000, 'COLLECTED'),
  (12, 7, 19, '১ প্লেট ভাত',         1000, 1,  1000, 'DELIVERED');

-- ---------------------------------------------------------------------------
-- Ledger debits and one refund, matching the orders above exactly.
-- Debits are negative; the refund for the cancelled order is positive.
-- ---------------------------------------------------------------------------
INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, order_id, reason, created_by) VALUES
  (3, 2, 'debit',  -11500, 1, 'Order on 2026-10-14', 3),
  (4, 2, 'debit',   -4000, 2, 'Order on 2026-10-14', 4),
  (5, 2, 'debit',  -10000, 3, 'Order on 2026-10-14', 5),
  (3, 2, 'debit',   -5000, 4, 'Order on 2026-10-15', 3),
  (6, 2, 'debit',  -10000, 5, 'Order on 2026-10-15', 6),
  (7, 2, 'debit',   -7000, 6, 'Order on 2026-10-15', 7),
  (5, 2, 'debit',   -1000, 7, 'Order on 2026-10-15', 5),
  -- Refund restoring the cancelled order to the teacher's balance.
  (5, 2, 'refund',   1000, 7, 'Order cancelled by the teacher before the cutoff', 5);

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
  (1, 'budget.allocation.created', 'budget_allocation', NULL, '{"period":"2026-W42","teachers":27,"amountPaisa":70000,"source":"seed"}'),
  (1, 'user.created', 'user', 1, '{"role":"ADMIN","source":"seed"}'),
  (1, 'user.created', 'user', 2, '{"role":"STAFF","source":"seed"}');

-- ---------------------------------------------------------------------------
-- Demo password summary. These are the documented development credentials and
-- must be changed or deleted before any real deployment.
-- ---------------------------------------------------------------------------
-- admin@juniv.edu   / AdminPass123!
-- staff@juniv.edu   / StaffPass123!
-- teacher@juniv.edu / TeacherPass123!