import type { SettingRow } from '../models/settings.model.js';

/**
 * Setting presenters.
 *
 * Pure functions from a model row to the public JSON shape.
 */
export function presentSetting(row: SettingRow) {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}
