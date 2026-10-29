import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { closePool, count, getPool, query } from '../helpers/database.js';

/**
 * Seed data tests.
 *
 * The seed is what a reviewer sees first, so it must be internally consistent
 * and repeatable. A ledger that disagrees with the orders it paid for would be
 * worse than no demo data at all.
 */

const SEED_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/seeds/001_demo_data.sql',
);

/** Run the seed file against the test database, generating fresh hashes. */
async function runSeed(): Promise<void> {
  getPool();

  const sql = await readFile(SEED_FILE, 'utf8');
  const cost = 4; // lowest valid cost, to keep the test fast
  const [admin, staff, teacher] = await Promise.all([
    bcrypt.hash('AdminPass123!', cost),
    bcrypt.hash('StaffPass123!', cost),
    bcrypt.hash('TeacherPass123!', cost),
  ]);

  const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const substituted = sql
    .replace(/:admin_password_hash\b/g, literal(admin))
    .replace(/:staff_password_hash\b/g, literal(staff))
    .replace(/:teacher_password_hash\b/g, literal(teacher));

  await query(substituted);
}

beforeAll(async () => {
  await runSeed();
});

afterAll(async () => {
  await closePool();
});

describe('seed data', () => {
  it('creates locations, menus, users, periods, orders, and ledger entries', async () => {
    expect(await count('users')).toBeGreaterThan(0);
    expect(await count('food_locations')).toBeGreaterThan(0);
    expect(await count('menu_items')).toBeGreaterThan(0);
    expect(await count('budget_periods')).toBeGreaterThan(0);
    expect(await count('orders')).toBeGreaterThan(0);
    expect(await count('order_items')).toBeGreaterThan(0);
    expect(await count('budget_ledger')).toBeGreaterThan(0);
  });

  it('seeds the four Bot Tola shops with the shared Bengali menu', async () => {
    const shops = await query<{ name: string; item_count: string }>(`
      SELECT l.name_bn AS name, count(m.id)::text AS item_count
      FROM food_locations l
      LEFT JOIN menu_items m ON m.food_location_id = l.id
      WHERE l.name_bn IN ('রাধুনী', 'রাফি', 'নূরজাহান', 'জ্যাক্স কিচেন')
        AND l.description = 'বটতলা'
      GROUP BY l.id, l.name
      ORDER BY l.id
    `);

    expect(shops).toEqual([
      { name: 'রাধুনী', item_count: '18' },
      { name: 'রাফি', item_count: '18' },
      { name: 'নূরজাহান', item_count: '18' },
      { name: 'জ্যাক্স কিচেন', item_count: '18' },
    ]);
  });

  it('leaves no plaintext password anywhere in the database', async () => {
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users
       WHERE password_hash LIKE '%AdminPass123%'
          OR password_hash LIKE '%StaffPass123%'
          OR password_hash LIKE '%TeacherPass123%'`,
    );

    expect(Number(rows[0]?.count)).toBe(0);

    // Every stored hash looks like a bcrypt hash.
    const all = await query<{ password_hash: string }>('SELECT password_hash FROM users');
    for (const row of all) {
      expect(row.password_hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    }
  });

  it('makes every ledger debit agree with its order total', async () => {
    const rows = await query<{ mismatches: string }>(`
      WITH debits AS (
        SELECT order_id, SUM(amount_paisa) AS total
        FROM budget_ledger
        WHERE entry_type = 'debit'
        GROUP BY order_id
      )
      SELECT count(*)::text AS mismatches
      FROM orders o
      LEFT JOIN debits d ON d.order_id = o.id
      WHERE COALESCE(d.total, 0) <> -o.total_paisa
    `);

    expect(Number(rows[0]?.mismatches)).toBe(0);
  });

  it('makes every order total agree with the sum of its line items', async () => {
    // Reconciled orders are the exception: delivery moves total_paisa to the
    // actual cost, which may differ from the estimated line-item sum.
    const rows = await query<{ mismatches: string }>(`
      WITH sums AS (
        SELECT o.id, o.total_paisa, o.actual_cost_paisa, SUM(i.line_total_paisa) AS line_sum
        FROM orders o
        JOIN order_items i ON i.order_id = o.id
        GROUP BY o.id, o.total_paisa, o.actual_cost_paisa
      )
      SELECT count(*)::text AS mismatches
      FROM sums
      WHERE line_sum <> total_paisa
        AND (actual_cost_paisa IS NULL OR actual_cost_paisa <> total_paisa)
    `);

    expect(Number(rows[0]?.mismatches)).toBe(0);
  });

  it('keeps every teacher inside the configured debt policy', async () => {
    const settings = await query<{ key: string; value: unknown }>(
      `SELECT key, value FROM app_settings
        WHERE key IN ('negative_balance_allowed', 'max_debt_paisa')`,
    );
    const map = new Map(settings.map((row) => [row.key, row.value]));
    const negativeAllowed =
      map.get('negative_balance_allowed') === true ||
      map.get('negative_balance_allowed') === 'true';
    const maxDebtPaisa = Number(map.get('max_debt_paisa') ?? 0);

    const negatives = await query<{ teacher_id: number; balance: string }>(
      `SELECT teacher_id, SUM(amount_paisa)::text AS balance
         FROM budget_ledger GROUP BY teacher_id
        HAVING SUM(amount_paisa) < 0`,
    );

    if (!negativeAllowed) {
      // Debt disabled: nobody may be negative at all.
      expect(negatives).toEqual([]);
      return;
    }

    // Debt enabled: overdraws are allowed up to the configured cap.
    for (const row of negatives) {
      expect(Number(row.balance)).toBeGreaterThanOrEqual(-maxDebtPaisa);
    }
  });

  it('mirrors every allocation with a matching ledger entry', async () => {
    const rows = await query<{ missing: string }>(`
      SELECT count(*)::text AS missing
      FROM budget_allocations a
      WHERE NOT EXISTS (
        SELECT 1 FROM budget_ledger l
        WHERE l.teacher_id = a.teacher_id
          AND l.budget_period_id = a.budget_period_id
          AND l.entry_type = 'allocation'
          AND l.amount_paisa = a.amount_paisa
      )
    `);

    expect(Number(rows[0]?.missing)).toBe(0);
  });

  it('refunds the cancelled order exactly once', async () => {
    const cancelled = await query<{ id: number; total_paisa: number }>(
      `SELECT id, total_paisa FROM orders WHERE status = 'CANCELLED'`,
    );

    expect(cancelled.length).toBeGreaterThan(0);

    for (const order of cancelled) {
      const refunds = await query<{ total: string }>(
        `SELECT SUM(amount_paisa)::text AS total FROM budget_ledger
         WHERE order_id = $1 AND entry_type = 'refund'`,
        [order.id],
      );

      expect(Number(refunds[0]?.total)).toBe(order.total_paisa);
    }
  });

  it('uses only juniv.edu addresses, so no real personal data is seeded', async () => {
    const rows = await query<{ non_example: string }>(
      `SELECT count(*)::text AS non_example FROM users WHERE email NOT LIKE '%@juniv.edu'`,
    );

    expect(Number(rows[0]?.non_example)).toBe(0);
  });

  it('produces identical results when run again', async () => {
    const before = await count('orders');
    const ledgerBefore = await count('budget_ledger');

    await runSeed();

    expect(await count('orders')).toBe(before);
    expect(await count('budget_ledger')).toBe(ledgerBefore);

    // Repeating the seed must still leave the books consistent.
    const rows = await query<{ mismatches: string }>(`
      WITH debits AS (
        SELECT order_id, SUM(amount_paisa) AS total
        FROM budget_ledger WHERE entry_type = 'debit' GROUP BY order_id
      )
      SELECT count(*)::text AS mismatches
      FROM orders o LEFT JOIN debits d ON d.order_id = o.id
      WHERE COALESCE(d.total, 0) <> -o.total_paisa
    `);

    expect(Number(rows[0]?.mismatches)).toBe(0);
  });

  it('preserves migration history across a seed', async () => {
    // The seed truncates demo tables but must never touch schema_migrations,
    // because that would break the next migrate run.
    expect(await count('schema_migrations')).toBeGreaterThan(0);
  });
});
