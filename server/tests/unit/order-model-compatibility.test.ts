import { describe, expect, it } from 'vitest';
import type { Queryable } from '../../src/db/pool.js';
import {
  findItemsForOrders,
  findOrder,
  findOrderItems,
  findTeacherOrder,
  listTeacherOrders,
} from '../../src/models/order.model.js';

describe('order reads on schemas awaiting additive migrations', () => {
  it('reads optional cancellation and alternative fields without direct column references', async () => {
    const statements: string[] = [];
    const db: Queryable = {
      query<R>(text: string) {
        statements.push(text);
        return Promise.resolve({ rows: [] as R[], rowCount: 0 });
      },
    };

    await findOrder(db, 1);
    await findTeacherOrder(db, 1, 1);
    await listTeacherOrders(db, 1, {}, 20, 0);
    await findOrderItems(db, 1);
    await findItemsForOrders(db, [1]);

    const orderReads = statements.slice(0, 3);
    for (const sql of orderReads) {
      expect(sql).toContain("to_jsonb(o)->>'cancel_reason'");
      expect(sql).toContain("to_jsonb(o)->>'cancelled_by'");
      expect(sql).not.toMatch(/\bo\.(?:cancel_reason|cancelled_by)\b/);
    }

    const itemReads = statements.slice(3);
    for (const sql of itemReads) {
      expect(sql).toContain("to_jsonb(oi)->>'alternative_menu_item_id'");
      expect(sql).not.toMatch(/\boi\.alternative_menu_item_id\b/);
    }
  });
});
