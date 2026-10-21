-- =============================================================================
-- 0002_add_designation_to_users.sql
--
-- Adds designation (e.g. Professor, Associate Professor, Lecturer) to users.
-- =============================================================================

ALTER TABLE users ADD COLUMN designation text;
