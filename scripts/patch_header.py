path = 'db/migrations/0001_initial_schema.sql'
with open(path, 'r') as f:
    content = f.read()

old_header = """-- app_settings
--
-- Configuration staff can change without a deployment, including the ordering
-- cutoff and whether unspent budget rolls over.
-- =============================================================================
CREATE TABLE app_settings"""

new_header = """-- app_settings
--
-- Configuration staff can change without a deployment. These are the ONLY
-- settings the Admin Policy Settings page exposes (see requirements #5).
-- =============================================================================
CREATE TABLE app_settings"""

if old_header in content:
    content = content.replace(old_header, new_header)
    print('Header replaced')
else:
    print('Old header NOT found')

with open(path, 'w') as f:
    f.write(content)
