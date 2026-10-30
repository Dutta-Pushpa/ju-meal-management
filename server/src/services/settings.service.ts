import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { writeAudit } from '../models/audit.model.js';
import * as settings from '../models/settings.model.js';
import { notFound } from '../utils/errors.js';

export const SETTING_KEYS = [
  'order_placement_deadline',
  'order_cancellation_deadline',
  'ordering_disabled_dates',
  'negative_balance_allowed',
  'max_debt_paisa',
  'max_additional_orders',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export async function listSettings(db: Database) {
  return settings.listSettings(db);
}

export async function updateSetting(
  db: Database,
  key: SettingKey,
  value: unknown,
  actorId: number,
) {
  return withTransaction(db, async (tx) => {
    const updated = await settings.updateSetting(tx, key, value, actorId);
    if (!updated) throw notFound('Setting not found.');
    await writeAudit(tx, {
      actorUserId: actorId,
      action: 'setting.updated',
      entityType: 'app_setting',
      entityId: undefined,
      metadata: { key, value },
    });
    return updated;
  });
}

/** Default values for policy settings, used when a setting has no stored row. */
export const POLICY_DEFAULTS: Record<SettingKey, unknown> = {
  order_placement_deadline: '12:30',
  order_cancellation_deadline: '13:00',
  ordering_disabled_dates: [],
  negative_balance_allowed: false,
  max_debt_paisa: 0,
  max_additional_orders: 0,
};
