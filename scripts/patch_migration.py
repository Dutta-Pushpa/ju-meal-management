import re

path = 'db/migrations/0001_initial_schema.sql'
with open(path, 'r') as f:
    content = f.read()

# Replace the old app_settings insert
old_insert = """INSERT INTO app_settings (key, value, description) VALUES
  ('order_cutoff_time', '"12:00"',
   'Daily ordering cutoff in the app timezone. Enforced by the backend.'),
  ('budget_rollover', 'false',
   'When false, unspent budget does not carry into the next period.'),
  ('timezone', '"Asia/Dhaka"',
   'Timezone in which business dates and the cutoff are evaluated.'),
  ('ordering_disabled_dates', '[]',
   'Dates on which ordering is disabled, such as holidays or vendor closures.');"""

new_insert = """INSERT INTO app_settings (key, value, description) VALUES
  ('order_placement_deadline', '"12:30"',
   'Latest clock time (Dhaka business time) a teacher may place an order. Enforced by the backend.'),
  ('order_cancellation_deadline', '"13:00"',
   'Latest clock time (Dhaka business time) an order may be cancelled. Enforced by the backend.'),
  ('negative_balance_allowed', 'false',
   'Whether a teacher may place orders that push their remaining balance below zero.'),
  ('max_debt_paisa', '0',
   'Maximum permitted outstanding debt in paisa when negative balance is allowed. Zero means no debt permitted.'),
  ('max_additional_orders', '0',
   'Maximum number of additional orders a teacher may place beyond their balance when debt is allowed. Zero means no additional orders permitted.');"""

if old_insert in content:
    content = content.replace(old_insert, new_insert)
    print("Replaced app_settings insert")
else:
    print("Old app_settings insert not found")

# Replace the old app_settings header
old_header = """-- Configuration staff can change without a deployment, including the ordering
-- cutoff and whether unspent budget rolls over.
-- =============================================================================
-- app_settings"""

new_header = """-- Configuration staff can change without a deployment. These are the ONLY
-- settings the Admin Policy Settings page exposes (see requirements #5).
-- =============================================================================
-- app_settings"""

if old_header in content:
    content = content.replace(old_header, new_header)
    print("Replaced app_settings header")
else:
    print("Old app_settings header not found")

with open(path, 'w') as f:
    f.write(content)

print("Done")
