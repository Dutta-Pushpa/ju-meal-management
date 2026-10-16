-- =============================================================================
-- 0001_initial_schema.sql
--
-- The complete schema for the JU Meal Management System.
--
-- Conventions applied throughout, per docs/database.md:
--   * Money is bigint paisa. One taka is 100 paisa. Never floating point.
--   * Timestamps are timestamptz written in UTC.
--   * Business dates are date, holding the Asia/Dhaka calendar day.
--   * Enumerations are text with a CHECK constraint, not native enum types,
--     so adding a value later is not a schema migration hazard.
--   * Records that appear in history are soft deactivated, never deleted.
-- =============================================================================

-- Required for the exclusion constraint that stops budget periods overlapping.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest without relying on application code.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- users
--
-- Teachers, collection staff, and administrators in one table. Role grants broad
-- access; permissions grant specific capabilities, which is what allows a staff
-- account to be limited to collection work.
-- =============================================================================
CREATE TABLE users (
  id              bigserial    PRIMARY KEY,
  full_name       text         NOT NULL,
  email           text         NOT NULL,
  password_hash   text         NOT NULL,
  role            text         NOT NULL,
  permissions     jsonb        NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean      NOT NULL DEFAULT true,
  -- Embedded in every issued token. Incrementing it revokes all of that user's
  -- tokens at once, which is how logout-all and password changes work without
  -- maintaining a token blacklist.
  token_version   integer      NOT NULL DEFAULT 1,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT users_role_check
    CHECK (role IN ('TEACHER', 'STAFF', 'ADMIN')),
  CONSTRAINT users_email_format_check
    CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_permissions_is_array_check
    CHECK (jsonb_typeof(permissions) = 'array'),
  CONSTRAINT users_token_version_check CHECK (token_version >= 1)
);

-- Addresses are stored lower-cased so uniqueness is case-insensitive without
-- relying on a citext extension.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_role_idx ON users (role) WHERE is_active;
CREATE INDEX users_active_idx ON users (is_active);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- sessions
--
-- The primary authentication mechanism is the JWT. This table records logins,
-- supports revocation, and provides an audit trail of who signed in when.
-- =============================================================================
CREATE TABLE sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_version integer     NOT NULL,
  ip_address    inet,
  user_agent    text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
-- Supports the periodic sweep of expired sessions.
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- =============================================================================
-- food_locations
--
-- Participating vendors. This is the CRUD demonstration entity.
-- =============================================================================
CREATE TABLE food_locations (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL,
  name_bn     text,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT food_locations_name_not_blank_check CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX food_locations_name_unique ON food_locations (lower(name));
CREATE INDEX food_locations_active_idx ON food_locations (is_active);

CREATE TRIGGER food_locations_set_updated_at
  BEFORE UPDATE ON food_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- menu_items
-- =============================================================================
CREATE TABLE menu_items (
  id               bigserial   PRIMARY KEY,
  food_location_id bigint      NOT NULL REFERENCES food_locations (id) ON DELETE RESTRICT,
  name             text        NOT NULL,
  description      text,
  category         text,
  price_paisa      bigint      NOT NULL,
  is_available     boolean     NOT NULL DEFAULT true,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- A zero or negative price is always a data-entry mistake. Historical order
  -- snapshots keep their own price, so this cannot corrupt the past.
  CONSTRAINT menu_items_price_positive_check CHECK (price_paisa > 0),
  CONSTRAINT menu_items_name_not_blank_check CHECK (length(btrim(name)) > 0)
);

CREATE INDEX menu_items_location_idx ON menu_items (food_location_id);
-- Covers the menu browse query, which filters on location, active, and available.
CREATE INDEX menu_items_browse_idx ON menu_items (food_location_id, is_available)
  WHERE is_active;

CREATE TRIGGER menu_items_set_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- budget_periods
--
-- A budget window. Weekly by default; the table supports any window length.
-- =============================================================================
CREATE TABLE budget_periods (
  id         bigserial   PRIMARY KEY,
  name       text        NOT NULL,
  starts_on  date        NOT NULL,
  ends_on    date        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_periods_name_not_blank_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT budget_periods_range_check CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX budget_periods_name_unique ON budget_periods (name);

-- Periods must never overlap. Two overlapping periods would make "the available
-- balance for this period" ambiguous, and ambiguity in a ledger is unacceptable.
ALTER TABLE budget_periods
  ADD CONSTRAINT budget_periods_no_overlap
  EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&);

CREATE INDEX budget_periods_range_idx ON budget_periods (starts_on, ends_on);

CREATE TRIGGER budget_periods_set_updated_at
  BEFORE UPDATE ON budget_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- budget_allocations
--
-- The intended amount for a teacher in a period. The uniqueness constraint is
-- what enforces policy: one allocation per teacher per period, and a change
-- must go through an explicit adjustment with a reason.
-- =============================================================================
CREATE TABLE budget_allocations (
  id                bigserial   PRIMARY KEY,
  teacher_id        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  budget_period_id  bigint      NOT NULL REFERENCES budget_periods (id) ON DELETE RESTRICT,
  amount_paisa      bigint      NOT NULL,
  created_by        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_allocations_amount_check CHECK (amount_paisa >= 0),
  CONSTRAINT budget_allocations_teacher_period_unique UNIQUE (teacher_id, budget_period_id)
);

CREATE INDEX budget_allocations_period_idx ON budget_allocations (budget_period_id);

-- =============================================================================
-- orders
-- =============================================================================
CREATE TABLE orders (
  id                bigserial   PRIMARY KEY,
  teacher_id        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- One location per order, per policy. Enforced by the service layer, which is
  -- the only layer that can see every line item at once.
  food_location_id  bigint      NOT NULL REFERENCES food_locations (id) ON DELETE RESTRICT,
  order_date        date        NOT NULL,
  status            text        NOT NULL DEFAULT 'CONFIRMED',
  total_paisa       bigint      NOT NULL,
  -- Client-generated and stable across retries of one checkout attempt.
  idempotency_key   text,
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_status_check
    CHECK (status IN ('CONFIRMED', 'COLLECTED', 'DELIVERED', 'CANCELLED')),
  CONSTRAINT orders_total_check CHECK (total_paisa >= 0),
  -- A cancelled order records when it happened and nothing else may.
  CONSTRAINT orders_cancelled_fields_check
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

-- Makes a double-clicked or retried submission return the original order
-- instead of creating a second one and a second debit.
CREATE UNIQUE INDEX orders_idempotency_unique
  ON orders (teacher_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Covers the staff daily view and the teacher history view.
CREATE INDEX orders_date_status_idx ON orders (order_date, status);
CREATE INDEX orders_teacher_date_idx ON orders (teacher_id, order_date DESC);
CREATE INDEX orders_location_date_idx ON orders (food_location_id, order_date);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- order_items
--
-- item_name_snapshot and unit_price_paisa_snapshot are what keep history
-- honest. A later menu price change must never rewrite a past order, so nothing
-- in the reporting path joins back to menu_items.price_paisa to recompute a
-- historical total.
-- =============================================================================
CREATE TABLE order_items (
  id                       bigserial   PRIMARY KEY,
  order_id                 bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  -- Nullable so the link survives a menu item that is later removed entirely.
  menu_item_id             bigint      REFERENCES menu_items (id) ON DELETE SET NULL,
  item_name_snapshot       text        NOT NULL,
  unit_price_paisa_snapshot bigint     NOT NULL,
  quantity                 integer     NOT NULL,
  line_total_paisa         bigint      NOT NULL,
  status                   text        NOT NULL DEFAULT 'PENDING',
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT order_items_unit_price_check CHECK (unit_price_paisa_snapshot > 0),
  CONSTRAINT order_items_status_check
    CHECK (status IN ('PENDING', 'COLLECTED', 'DELIVERED')),
  -- The server computes the line total. This constraint makes a calculation
  -- mistake impossible to persist rather than merely unlikely.
  CONSTRAINT order_items_line_total_check
    CHECK (line_total_paisa = unit_price_paisa_snapshot * quantity)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_menu_item_idx ON order_items (menu_item_id)
  WHERE menu_item_id IS NOT NULL;
-- Item-level aggregation for the collection sheet.
CREATE INDEX order_items_snapshot_idx ON order_items (item_name_snapshot);

-- =============================================================================
-- budget_ledger
--
-- Append-only. Every financial movement for every teacher. This table is the
-- source of truth for balances: the available balance is a SUM over it, never a
-- stored column, because a stored balance can drift from the ledger through a
-- single missed write and a SUM cannot.
--
-- Credits are positive, debits are negative.
-- =============================================================================
CREATE TABLE budget_ledger (
  id                bigserial   PRIMARY KEY,
  teacher_id        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  budget_period_id  bigint      NOT NULL REFERENCES budget_periods (id) ON DELETE RESTRICT,
  entry_type        text        NOT NULL,
  amount_paisa      bigint      NOT NULL,
  order_id          bigint      REFERENCES orders (id) ON DELETE RESTRICT,
  reason            text,
  created_by        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_ledger_entry_type_check
    CHECK (entry_type IN ('allocation', 'debit', 'refund', 'adjustment')),
  CONSTRAINT budget_ledger_amount_nonzero_check CHECK (amount_paisa <> 0),
  -- An adjustment without a reason is an unauditable financial change.
  -- COALESCE is required: with a NULL reason the comparison would otherwise
  -- evaluate to NULL, and a CHECK constraint passes on NULL. That would let an
  -- unexplained adjustment through unnoticed.
  CONSTRAINT budget_ledger_adjustment_reason_check
    CHECK (entry_type <> 'adjustment' OR COALESCE(length(btrim(reason)), 0) > 0)
);

-- The balance query filters on teacher and period and sums the amount.
CREATE INDEX budget_ledger_balance_idx ON budget_ledger (teacher_id, budget_period_id);
CREATE INDEX budget_ledger_order_idx ON budget_ledger (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX budget_ledger_created_at_idx ON budget_ledger (created_at DESC);

-- The ledger is append-only. These triggers make an accidental UPDATE or DELETE
-- fail loudly at the database rather than silently corrupt the audit trail.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'budget_ledger is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_ledger_no_update
  BEFORE UPDATE ON budget_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TRIGGER budget_ledger_no_delete
  BEFORE DELETE ON budget_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- =============================================================================
-- order_status_events
--
-- Append-only history of every status transition, at order or item level.
-- =============================================================================
CREATE TABLE order_status_events (
  id            bigserial   PRIMARY KEY,
  order_id      bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  order_item_id bigint      REFERENCES order_items (id) ON DELETE CASCADE,
  old_status    text,
  new_status    text        NOT NULL,
  changed_by    bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_status_events_new_status_check
    CHECK (new_status IN ('CONFIRMED', 'COLLECTED', 'DELIVERED', 'CANCELLED', 'PENDING')),
  -- An item-level event names its item; an order-level event does not.
  CONSTRAINT order_status_events_scope_check
    CHECK (order_item_id IS NULL OR new_status IN ('PENDING', 'COLLECTED', 'DELIVERED'))
);

CREATE INDEX order_status_events_order_idx ON order_status_events (order_id, created_at DESC);
CREATE INDEX order_status_events_item_idx ON order_status_events (order_item_id)
  WHERE order_item_id IS NOT NULL;

-- =============================================================================
-- audit_logs
--
-- Administrative actions outside ordinary order flow. metadata must never
-- contain a password, hash, or token.
-- =============================================================================
CREATE TABLE audit_logs (
  id             bigserial   PRIMARY KEY,
  actor_user_id  bigint      REFERENCES users (id) ON DELETE SET NULL,
  action         text        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      bigint,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_metadata_is_object_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_logs_action_not_blank_check CHECK (length(btrim(action)) > 0)
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);

-- =============================================================================
-- app_settings
--
-- Configuration staff can change without a deployment, including the ordering
-- cutoff and whether unspent budget rolls over.
-- =============================================================================
CREATE TABLE app_settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  description text,
  updated_by  bigint      REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_settings_key_not_blank_check CHECK (length(btrim(key)) > 0)
);

INSERT INTO app_settings (key, value, description) VALUES
  ('order_cutoff_time', '"12:00"',
   'Daily ordering cutoff in the app timezone. Enforced by the backend.'),
  ('budget_rollover', 'false',
   'When false, unspent budget does not carry into the next period.'),
  ('timezone', '"Asia/Dhaka"',
   'Timezone in which business dates and the cutoff are evaluated.'),
  ('ordering_disabled_dates', '[]',
   'Dates on which ordering is disabled, such as holidays or vendor closures.');