import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { listSettings, SETTING_KEYS, updateSetting, type SettingKey } from '../services/settings.service.js';
import { badRequest } from '../utils/errors.js';
import { requireBoolean, requireObject, requireString } from '../utils/validation.js';

export function getSettings(db: Database) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listSettings(db);
    res.status(200).json({ data: rows.map(presentSetting) });
  };
}

export function patchSetting(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const key = req.params['key'];
    if (!key || !SETTING_KEYS.includes(key as SettingKey)) throw badRequest('Unsupported setting key.');
    const body = requireObject(req.body ?? {}, 'body');
    if (!Object.hasOwn(body, 'value')) throw badRequest('value is required.');
    const value = validateSetting(key as SettingKey, body['value']);
    const row = await updateSetting(db, key as SettingKey, value, currentUser(req).id);
    res.status(200).json({ data: presentSetting(row) });
  };
}

function validateSetting(key: SettingKey, value: unknown): unknown {
  if (key === 'order_cutoff_time') {
    const time = requireString(value, 'value');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw badRequest('value must be a valid HH:mm time.');
    return time;
  }
  if (key === 'budget_rollover') return requireBoolean(value, 'value');
  if (key === 'timezone') {
    const timezone = requireString(value, 'value');
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
    catch { throw badRequest('value must be a valid IANA timezone.'); }
    return timezone;
  }
  if (!Array.isArray(value) || value.length > 366 || value.some((date) =>
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date,
  )) throw badRequest('value must be an array of valid YYYY-MM-DD dates (up to 366).');
  return [...new Set(value)];
}

function presentSetting(row: { key: string; value: unknown; description: string | null; updated_by: number | null; updated_at: Date }) {
  return { key: row.key, value: row.value, description: row.description, updatedBy: row.updated_by, updatedAt: row.updated_at.toISOString() };
}
