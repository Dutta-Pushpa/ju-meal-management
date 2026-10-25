import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closePool,
  count,
  getPool,
  inTransaction,
  query,
  syncSequence,
  truncateAll,
} from '../helpers/database.js';

/**
 * Schema constraint tests.
 *
 * These verify that the guarantees the business rules depend on are enforced by
 * PostgreSQL itself, not only by application code. A rule that lives solely in a
 * service can be bypassed by a script, a migration, or a future endpoint.
 */

const NOW = '2026-10-16T06:00:00Z';

beforeAll(async () => {
  getPool();
  await truncateAll();

  await query(
    `INSERT INTO users (id, full_name, email, password_hash, role) VALUES
       (1, 'Admin', 'admin@juniv.edu', 'hash', 'ADMIN'),
       (2, 'Staff', 'staff@juniv.edu', 'hash', 'STAFF'),
       (3, 'Teacher One', 'teacher@juniv.edu', 'hash', 'TEACHER'),
       (4, 'Teacher Two', 'teacher2@juniv.edu', 'hash', 'TEACHER')`,
  );

  await query(
    `INSERT INTO food_locations (id, name) VALUES (1, 'Bot Tola'), (2, 'Central Cafeteria')`,
  );

  await query(
    `INSERT INTO menu_items (id, food_location_id, name, price_paisa) VALUES
       (1, 1, 'Chicken Meal', 15000),
       (2, 1, 'Fish Meal', 18000)`,
  );

  await query(
    `INSERT INTO budget_periods (id, name, starts_on, ends_on) VALUES
       (1, '2026-W42', '2026-10-12', '2026-10-18')`,
  );

  // Rows above were inserted with explicit ids, which does not advance the
  // sequences. Without this, the next insert that omits an id collides with an
  // existing row and fails on the primary key, masking the constraint the test
  // was actually trying to exercise.
  for (const table of ['users', 'food_locations', 'menu_items', 'budget_periods']) {
    await syncSequence(table);
  }
});

afterAll(async () => {
  await closePool();
});

describe('users', () => {
  it('rejects an unknown role', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO users (full_name, email, password_hash, role)
           VALUES ('X', 'x@juniv.edu', 'hash', 'SUPERUSER')`,
        ),
      ),
    ).rejects.toThrow(/users_role_check/);
  });

  it('treats email uniqueness as case insensitive', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO users (full_name, email, password_hash, role)
           VALUES ('Duplicate', 'ADMIN@juniv.edu', 'hash', 'TEACHER')`,
        ),
      ),
    ).rejects.toThrow(/users_email_unique/);
  });

  it('rejects a malformed email', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO users (full_name, email, password_hash, role)
           VALUES ('Bad', 'not-an-email', 'hash', 'TEACHER')`,
        ),
      ),
    ).rejects.toThrow(/users_email_format_check/);
  });

  it('keeps updated_at current on update', async () => {
    const before = await inTransaction(async (c) => {
      const { rows } = await c.query<{ updated_at: Date }>(
        'SELECT updated_at FROM users WHERE id = 3',
      );
      return rows[0]!.updated_at;
    });

    // updated_at is set by a trigger, so a stale client value is overwritten.
    await query(
      `UPDATE users SET full_name = 'Teacher One', updated_at = '2000-01-01' WHERE id = 3`,
    );

    const after = await queryOneUpdatedAt(3);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

async function queryOneUpdatedAt(id: number): Promise<Date> {
  const rows = await query<{ updated_at: Date }>('SELECT updated_at FROM users WHERE id = $1', [
    id,
  ]);
  return rows[0]!.updated_at;
}

describe('menu_items', () => {
  it('rejects a zero or negative price', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO menu_items (food_location_id, name, price_paisa) VALUES (1, 'Free', 0)`,
        ),
      ),
    ).rejects.toThrow(/menu_items_price_positive_check/);
  });
});

describe('budget_periods', () => {
  it('rejects an overlapping period', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO budget_periods (name, starts_on, ends_on)
           VALUES ('Overlapping', '2026-10-15', '2026-10-20')`,
        ),
      ),
    ).rejects.toThrow(/budget_periods_no_overlap/);
  });

  it('rejects a period that ends before it starts', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO budget_periods (name, starts_on, ends_on)
           VALUES ('Backwards', '2026-10-20', '2026-10-10')`,
        ),
      ),
    ).rejects.toThrow(/budget_periods_range_check/);
  });
});

describe('budget_allocations', () => {
  it('allows only one allocation per teacher per period', async () => {
    await query(
      `INSERT INTO budget_allocations (teacher_id, budget_period_id, amount_paisa, created_by)
       VALUES (3, 1, 70000, 1)`,
    );

    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO budget_allocations (teacher_id, budget_period_id, amount_paisa, created_by)
           VALUES (3, 1, 90000, 1)`,
        ),
      ),
    ).rejects.toThrow(/budget_allocations_teacher_period_unique/);
  });
});

describe('budget_ledger', () => {
  it('rejects an unknown entry type', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, created_by)
           VALUES (3, 1, 'mystery', 100, 1)`,
        ),
      ),
    ).rejects.toThrow(/budget_ledger_entry_type_check/);
  });

  it('rejects an adjustment with no reason', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by)
           VALUES (3, 1, 'adjustment', -100, NULL, 1)`,
        ),
      ),
    ).rejects.toThrow(/budget_ledger_adjustment_reason_check/);
  });

  it('rejects a zero amount', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, created_by)
           VALUES (3, 1, 'debit', 0, 3)`,
        ),
      ),
    ).rejects.toThrow(/budget_ledger_amount_nonzero_check/);
  });

  it('refuses to update an existing entry', async () => {
    await query(
      `INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, created_by)
       VALUES (3, 1, 'allocation', 70000, 1)`,
    );

    await expect(
      inTransaction((c) =>
        c.query(`UPDATE budget_ledger SET amount_paisa = 999999 WHERE teacher_id = 3`),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to delete an entry', async () => {
    await expect(
      inTransaction((c) => c.query(`DELETE FROM budget_ledger WHERE teacher_id = 3`)),
    ).rejects.toThrow(/append-only/);
  });
});

describe('orders and order_items', () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO orders (id, teacher_id, food_location_id, order_date, status, total_paisa, confirmed_at)
       VALUES (1, 3, 1, '2026-10-15', 'CONFIRMED', 30000, $1)`,
      [NOW],
    );

    await query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot, quantity, line_total_paisa)
       VALUES (1, 1, 'Chicken Meal', 15000, 2, 30000)`,
    );

    // These rows also carry explicit ids, so their sequences need catching up.
    for (const table of ['orders', 'order_items']) {
      await syncSequence(table);
    }
  });

  it('accepts an order whose line totals match the stored total', async () => {
    expect(await count('orders', 'id = 1')).toBe(1);
  });

  it('rejects a line total that disagrees with unit price times quantity', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot, quantity, line_total_paisa)
           VALUES (1, 2, 'Fish Meal', 18000, 1, 99999)`,
        ),
      ),
    ).rejects.toThrow(/order_items_line_total_check/);
  });

  it('rejects a non-positive quantity', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot, quantity, line_total_paisa)
           VALUES (1, 2, 'Fish Meal', 18000, 0, 0)`,
        ),
      ),
    ).rejects.toThrow(/order_items_quantity_check/);
  });

  it('requires cancelled_at exactly when the order is cancelled', async () => {
    await expect(
      inTransaction((c) => c.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = 1`)),
    ).rejects.toThrow(/orders_cancelled_fields_check/);

    // Supplying it succeeds, proving the constraint is the only obstacle.
    await expect(
      inTransaction((c) =>
        c.query(`UPDATE orders SET status = 'CANCELLED', cancelled_at = $1 WHERE id = 1`, [NOW]),
      ),
    ).resolves.toBeDefined();
  });

  it('prevents a duplicate order from the same idempotency key', async () => {
    await query(
      `INSERT INTO orders (teacher_id, food_location_id, order_date, status, total_paisa, confirmed_at, idempotency_key)
       VALUES (4, 1, '2026-10-15', 'CONFIRMED', 10000, $1, 'retry-key-1')`,
      [NOW],
    );

    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO orders (teacher_id, food_location_id, order_date, status, total_paisa, confirmed_at, idempotency_key)
           VALUES (4, 1, '2026-10-15', 'CONFIRMED', 10000, $1, 'retry-key-1')`,
          [NOW],
        ),
      ),
    ).rejects.toThrow(/orders_idempotency_unique/);
  });

  it('allows several orders with no idempotency key at all', async () => {
    await expect(
      inTransaction((c) =>
        c.query(
          `INSERT INTO orders (teacher_id, food_location_id, order_date, status, total_paisa, confirmed_at)
           VALUES (4, 1, '2026-10-15', 'CONFIRMED', 10000, $1)`,
          [NOW],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('keeps a historical order readable after the menu item is deactivated', async () => {
    await query(`UPDATE menu_items SET is_active = false, is_available = false WHERE id = 1`);

    const rows = await query<{ item_name_snapshot: string; unit_price_paisa_snapshot: number }>(
      'SELECT item_name_snapshot, unit_price_paisa_snapshot FROM order_items WHERE order_id = 1',
    );

    // The snapshot is untouched by the menu change.
    expect(rows[0]?.item_name_snapshot).toBe('Chicken Meal');
    expect(rows[0]?.unit_price_paisa_snapshot).toBe(15000);

    await query(`UPDATE menu_items SET is_active = true, is_available = true WHERE id = 1`);
  });
});

describe('app_settings', () => {
  it('ships the documented defaults', async () => {
    const rows = await query<{ key: string; value: unknown }>(
      'SELECT key, value FROM app_settings',
    );

    const keys = rows.map((row) => row.key);
    expect(keys).toContain('order_placement_deadline');
    expect(keys).toContain('order_cancellation_deadline');
    expect(keys).toContain('negative_balance_allowed');
    expect(keys).toContain('max_debt_paisa');
    expect(keys).toContain('max_additional_orders');

    const deadline = rows.find((row) => row.key === 'order_placement_deadline');
    expect(deadline?.value).toBe('"12:30"');
  });
});
