import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import {
  listSettings,
  SETTING_KEYS,
  updateSetting,
  type SettingKey,
} from '../services/settings.service.js';
import { badRequest } from '../utils/errors.js';
import { requireBoolean, requireInt, requireObject, requireString } from '../utils/validation.js';

export function getSettings(db: Database) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listSettings(db);
    res.status(200).json({ data: rows.map(presentSetting) });
  };
}

export function patchSetting(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const key = req.params['key'];
    if (!key || !SETTING_KEYS.includes(key as SettingKey))
      throw badRequest('Unsupported setting key.');
    const body = requireObject(req.body ?? {}, 'body');
    if (!Object.hasOwn(body, 'value')) throw badRequest('value is required.');
    const value = validateSetting(key as SettingKey, body['value']);

    if (key === 'order_cancellation_deadline' || key === 'order_placement_deadline') {
      const allSettings = await listSettings(db);
      const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));
      const configuredPlacement = settingsMap.get('order_placement_deadline');
      const configuredCancellation = settingsMap.get('order_cancellation_deadline');
      const placement =
        key === 'order_placement_deadline'
          ? (value as string)
          : typeof configuredPlacement === 'string'
            ? configuredPlacement
            : '12:30';
      const cancellation =
        key === 'order_cancellation_deadline'
          ? (value as string)
          : typeof configuredCancellation === 'string'
            ? configuredCancellation
            : '13:00';

      if (cancellation < placement) {
        throw badRequest('The cancellation deadline cannot be earlier than the order deadline.');
      }
    }

    const row = await updateSetting(db, key as SettingKey, value, currentUser(req).id);
    res.status(200).json({ data: presentSetting(row) });
  };
}

function validateSetting(key: SettingKey, value: unknown): unknown {
  if (key === 'ordering_disabled_dates') {
    if (!Array.isArray(value) || value.length > 366) {
      throw badRequest('value must be an array of at most 366 YYYY-MM-DD dates.');
    }
    const dates = value.map((item, index) => {
      const date = requireString(item, `value[${index}]`);
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== date
      ) {
        throw badRequest(`value[${index}] must be a valid YYYY-MM-DD date.`);
      }
      return date;
    });
    return [...new Set(dates)].sort();
  }
  if (key === 'order_placement_deadline' || key === 'order_cancellation_deadline') {
    const time = requireString(value, 'value');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw badRequest('value must be a valid HH:mm time in 24-hour format.');
    return time;
  }
  if (key === 'negative_balance_allowed') return requireBoolean(value, 'value');
  if (key === 'max_debt_paisa' || key === 'max_additional_orders') {
    return requireInt(value, 'value', { min: 0 });
  }
  throw badRequest('Unsupported setting key.');
}

function presentSetting(row: {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: number | null;
  updated_at: Date;
}) {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}
