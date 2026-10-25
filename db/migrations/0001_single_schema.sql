-- =============================================================================
-- 0001_single_schema.sql
--
-- The complete schema for the JU Meal Management System (single migration).
--
-- Conventions:
--   * Money is bigint paisa. One taka is 100 paisa. Never floating point.
--   * Timestamps are timestamptz written in UTC.
--   * Business dates are date, holding the Asia/Dhaka calendar day.
--   * Enumerations are text with a CHECK constraint, not native enum types.
--   * Records that appear in history are soft deactivated, never deleted.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- users
-- =============================================================================
CREATE TABLE users (
  id              bigserial    PRIMARY KEY,
  full_name       text         NOT NULL,
  email           text         NOT NULL,
  password_hash   text         NOT NULL,
  role            text         NOT NULL,
  designation     text,
  permissions     jsonb        NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean      NOT NULL DEFAULT true,
  -- Embedded in every issued token. Incrementing it revokes all of that user's
  -- tokens at once.
  token_version   integer      NOT NULL DEFAULT 1,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT users_role_check
    CHECK (role IN ('TEACHER', 'STAFF', 'ADMIN')),
  CONSTRAINT users_email_format_check
    CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_token_version_check CHECK (token_version >= 1)
);

-- Uniqueness is case-insensitive via lower(email).
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_role_idx ON users (role) WHERE is_active;
CREATE INDEX users_active_idx ON users (is_active);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- sessions
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
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- =============================================================================
-- food_locations
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

  CONSTRAINT menu_items_price_positive_check CHECK (price_paisa > 0),
  CONSTRAINT menu_items_name_not_blank_check CHECK (length(btrim(name)) > 0)
);

CREATE INDEX menu_items_location_idx ON menu_items (food_location_id);
CREATE INDEX menu_items_browse_idx ON menu_items (food_location_id, is_available)
  WHERE is_active;

CREATE TRIGGER menu_items_set_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- budget_periods
--
-- Retained for historical reporting. Monthly allocations are the current model.
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

ALTER TABLE budget_periods
  ADD CONSTRAINT budget_periods_no_overlap
  EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&);

CREATE INDEX budget_periods_range_idx ON budget_periods (starts_on, ends_on);

CREATE TRIGGER budget_periods_set_updated_at
  BEFORE UPDATE ON budget_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- budget_allocations (legacy weekly/period allocation)
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
-- budget_monthly_allocations
--
-- One row per teacher per calendar month, with the carried-forward amount.
-- =============================================================================
CREATE TABLE budget_monthly_allocations (
  id                    bigserial   PRIMARY KEY,
  teacher_id            bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  year                  integer     NOT NULL,
  month                 integer     NOT NULL,
  allocated_paisa       bigint      NOT NULL DEFAULT 0,
  carried_forward_paisa bigint      NOT NULL DEFAULT 0,
  created_by            bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_monthly_allocation_year_month_range
    CHECK (year > 2000 AND year < 2100 AND month BETWEEN 1 AND 12),
  CONSTRAINT budget_monthly_allocation_unique_teacher_month
    UNIQUE (teacher_id, year, month),
  CONSTRAINT budget_monthly_allocation_amounts_nonneg
    CHECK (allocated_paisa >= 0 AND carried_forward_paisa >= 0)
);

CREATE INDEX budget_monthly_allocation_teacher_idx
  ON budget_monthly_allocations (teacher_id, year DESC, month DESC);

CREATE TRIGGER budget_monthly_allocations_set_updated_at
  BEFORE UPDATE ON budget_monthly_allocations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE budget_monthly_allocations IS
  'One allocation per teacher per calendar month, with carry-forward.';

-- =============================================================================
-- budget_requests
-- =============================================================================
CREATE TABLE budget_requests (
  id               bigserial   PRIMARY KEY,
  teacher_id       bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_type     text        NOT NULL,
  amount_paisa     bigint      NOT NULL,
  reason           text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending',
  decided_by       bigint      REFERENCES users (id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_request_type_check
    CHECK (request_type IN ('budget_increase', 'debt_allowance')),
  CONSTRAINT budget_request_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT budget_request_amount_positive CHECK (amount_paisa > 0)
);

CREATE INDEX budget_requests_teacher_idx ON budget_requests (teacher_id, created_at DESC);
CREATE INDEX budget_requests_status_idx ON budget_requests (status, created_at DESC);

COMMENT ON TABLE budget_requests IS
  'Teacher requests for additional budget or debt allowance, approved or rejected by an administrator.';

-- =============================================================================
-- orders
--
-- Lifecycle: PENDING -> ACCEPTED -> DELIVERED, with CANCELLED available before
-- the cancellation deadline. CONFIRMED and COLLECTED are retained so older
-- data keeps meaning.
-- =============================================================================
CREATE TABLE orders (
  id                bigserial   PRIMARY KEY,
  teacher_id        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- One location per order, enforced by the service layer.
  food_location_id  bigint      NOT NULL REFERENCES food_locations (id) ON DELETE RESTRICT,
  order_date        date        NOT NULL,
  status            text        NOT NULL DEFAULT 'PENDING',
  total_paisa       bigint      NOT NULL,
  idempotency_key   text,
  alternative_item_name         text,
  alternative_unit_price_paisa  bigint,
  actual_cost_paisa             bigint,
  delivery_confirmed_at         timestamptz,
  delivery_confirmed_by         bigint REFERENCES users (id) ON DELETE SET NULL,
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'CONFIRMED', 'COLLECTED', 'DELIVERED', 'CANCELLED')),
  CONSTRAINT orders_total_check CHECK (total_paisa >= 0),
  CONSTRAINT orders_alternative_price_check
    CHECK (alternative_unit_price_paisa IS NULL OR alternative_unit_price_paisa > 0),
  CONSTRAINT orders_actual_cost_check
    CHECK (actual_cost_paisa IS NULL OR actual_cost_paisa >= 0),
  -- status and cancelled_at must be set together in one UPDATE.
  CONSTRAINT orders_cancelled_fields_check
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX orders_idempotency_unique
  ON orders (teacher_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX orders_date_status_idx ON orders (order_date, status);
CREATE INDEX orders_teacher_date_idx ON orders (teacher_id, order_date DESC);
CREATE INDEX orders_location_date_idx ON orders (food_location_id, order_date);
CREATE INDEX orders_delivery_confirmed_idx ON orders (delivery_confirmed_at)
  WHERE delivery_confirmed_at IS NOT NULL;

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- order_items
-- =============================================================================
CREATE TABLE order_items (
  id                        bigserial   PRIMARY KEY,
  order_id                  bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id              bigint      REFERENCES menu_items (id) ON DELETE SET NULL,
  item_name_snapshot        text        NOT NULL,
  unit_price_paisa_snapshot bigint      NOT NULL,
  quantity                  integer     NOT NULL,
  line_total_paisa          bigint      NOT NULL,
  status                    text        NOT NULL DEFAULT 'PENDING',
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT order_items_unit_price_check CHECK (unit_price_paisa_snapshot > 0),
  CONSTRAINT order_items_status_check
    CHECK (status IN ('PENDING', 'COLLECTED', 'DELIVERED')),
  CONSTRAINT order_items_line_total_check
    CHECK (line_total_paisa = unit_price_paisa_snapshot * quantity)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_menu_item_idx ON order_items (menu_item_id)
  WHERE menu_item_id IS NOT NULL;
CREATE INDEX order_items_snapshot_idx ON order_items (item_name_snapshot);

-- =============================================================================
-- budget_ledger
--
-- Append-only. Balances are always a SUM over this table. Credits are positive,
-- debits are negative. year/month are the Dhaka business month of the entry
-- (derive from order_date, never from created_at, which is UTC).
-- budget_period_id is nullable because monthly allocation replaces periods.
-- =============================================================================
CREATE TABLE budget_ledger (
  id                bigserial   PRIMARY KEY,
  teacher_id        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  budget_period_id  bigint      REFERENCES budget_periods (id) ON DELETE RESTRICT,
  year              integer,
  month             integer,
  entry_type        text        NOT NULL,
  amount_paisa      bigint      NOT NULL,
  order_id          bigint      REFERENCES orders (id) ON DELETE RESTRICT,
  reason            text,
  created_by        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_ledger_entry_type_check
    CHECK (entry_type IN ('allocation', 'debit', 'refund', 'adjustment')),
  CONSTRAINT budget_ledger_amount_nonzero_check CHECK (amount_paisa <> 0),
  -- COALESCE is required: a NULL reason would make the comparison NULL, and a
  -- CHECK passes on NULL.
  CONSTRAINT budget_ledger_adjustment_reason_check
    CHECK (entry_type <> 'adjustment' OR COALESCE(length(btrim(reason)), 0) > 0),
  CONSTRAINT budget_ledger_year_range
    CHECK (year IS NULL OR (year > 2000 AND year < 2100)),
  CONSTRAINT budget_ledger_month_range
    CHECK (month IS NULL OR (month BETWEEN 1 AND 12)),
  CONSTRAINT budget_ledger_year_month_pair_check
    CHECK ((year IS NULL) = (month IS NULL))
);

CREATE INDEX budget_ledger_balance_idx ON budget_ledger (teacher_id, budget_period_id);
CREATE INDEX budget_ledger_teacher_year_month_idx ON budget_ledger (teacher_id, year, month);
CREATE INDEX budget_ledger_order_idx ON budget_ledger (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX budget_ledger_created_at_idx ON budget_ledger (created_at DESC);

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
    CHECK (new_status IN ('PENDING', 'ACCEPTED', 'CONFIRMED', 'COLLECTED', 'DELIVERED', 'CANCELLED')),
  CONSTRAINT order_status_events_scope_check
    CHECK (order_item_id IS NULL OR new_status IN ('PENDING', 'COLLECTED', 'DELIVERED'))
);

CREATE INDEX order_status_events_order_idx ON order_status_events (order_id, created_at DESC);
CREATE INDEX order_status_events_item_idx ON order_status_events (order_item_id)
  WHERE order_item_id IS NOT NULL;

-- =============================================================================
-- audit_logs
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