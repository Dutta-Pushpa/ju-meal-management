import type { Queryable } from '../db/pool.js';

export interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: number | null;
  updated_at: Date;
}

export async function listSettings(db: Queryable): Promise<SettingRow[]> {
  const { rows } = await db.query<SettingRow>(
    `SELECT key, value, description, updated_by, updated_at
       FROM app_settings ORDER BY key`,
  );
  return rows;
}

export async function updateSetting(
  db: Queryable,
  key: string,
  value: unknown,
  actorId: number,
): Promise<SettingRow | undefined> {
  const { rows } = await db.query<SettingRow>(
    `UPDATE app_settings SET value = $2::jsonb, updated_by = $3, updated_at = now()
      WHERE key = $1
      RETURNING key, value, description, updated_by, updated_at`,
    [key, JSON.stringify(value), actorId],
  );
  return rows[0];
}
