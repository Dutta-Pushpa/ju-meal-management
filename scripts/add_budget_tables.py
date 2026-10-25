path = 'db/migrations/0001_initial_schema.sql'

with open(path, 'r') as f:
    content = f.read()

table_sql = """
-- =============================================================================
-- budget_monthly_allocations
--
-- One row per teacher per calendar month. The intended monthly budget for a
-- teacher. Carried-forward balances are separate ledger entries (see
-- budget_ledger) and are NOT stored on this table, so the monthly summary is
-- always derived from the ledger.
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

-- =============================================================================
-- budget_requests
--
-- Teachers request additional budget or permission to incur further debt.
-- An administrator approves or rejects; every decision is auditable.
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
"""

marker = "CREATE INDEX budget_allocations_period_idx ON budget_allocations (budget_period_id);"
if marker in content:
    content = content.replace(marker, marker + table_sql)
    with open(path, 'w') as f:
        f.write(content)
    print('Tables added successfully')
else:
    print('Marker not found')
