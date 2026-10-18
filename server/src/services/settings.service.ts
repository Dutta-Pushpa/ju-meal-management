import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { writeAudit } from '../models/audit.model.js';
import * as settings from '../models/settings.model.js';
import { notFound } from '../utils/errors.js';

export const SETTING_KEYS = [
  'order_cutoff_time', 'budget_rollover', 'timezone', 'ordering_disabled_dates',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export async function listSettings(db: Database) {
  return settings.listSettings(db);
}

export async function updateSetting(db: Database, key: SettingKey, value: unknown, actorId: number) {
  return withTransaction(db, async (tx) => {
    const updated = await settings.updateSetting(tx, key, value, actorId);
    if (!updated) throw notFound('Setting not found.');
    await writeAudit(tx, {
      actorUserId: actorId,
      action: 'setting.updated',
      entityType: 'app_setting',
      metadata: { key, value },
    });
    return updated;
  });
}
