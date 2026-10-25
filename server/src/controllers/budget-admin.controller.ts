import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';
import { requireInt, requireObject, requireString } from '../utils/validation.js';
import {
  adjustBudget,
  allocateBudget,
  createBudgetPeriod,
  getBudgetLedger as getBudgetLedgerService,
} from '../services/budget-admin.service.js';
import { presentAllocation, presentBudgetEntry } from '../views/budget-admin.view.js';

const NAME_MAX_LENGTH = 100;
const REASON_MAX_LENGTH = 500;
const MAX_AMOUNT_PAISA = Number.MAX_SAFE_INTEGER;

export function createPeriod(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const name = requireString(body['name'], 'name', { maxLength: NAME_MAX_LENGTH });
    const startsOn = requireBusinessDate(body['startsOn'], 'startsOn');
    const endsOn = requireBusinessDate(body['endsOn'], 'endsOn');

    if (endsOn < startsOn) throw badRequest('endsOn must be on or after startsOn.');

    const period = await createBudgetPeriod(db, { name, startsOn, endsOn }, actor.id);
    res.status(201).json({
      data: {
        id: period.id,
        name: period.name,
        startsOn: period.starts_on,
        endsOn: period.ends_on,
        isActive: period.is_active,
        createdAt: period.created_at.toISOString(),
        rolledOverBalance: period.rolledOverBalance,
      },
    });
  };
}

export function allocate(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const result = await allocateBudget(db, {
      teacherId: requireInt(body['teacherId'], 'teacherId', { min: 1 }),
      year: requireInt(body['year'], 'year', { min: 2000, max: 2099 }),
      month: requireInt(body['month'], 'month', { min: 1, max: 12 }),
      amountPaisa: requireInt(body['amountPaisa'], 'amountPaisa', {
        min: 1,
        max: MAX_AMOUNT_PAISA,
      }),
      reason: requireString(body['reason'], 'reason', { maxLength: REASON_MAX_LENGTH }),
      actorUserId: actor.id,
    });
    res.status(201).json({ data: presentAllocation(result) });
  };
}

export function adjust(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const amountPaisa = requireInt(body['amountPaisa'], 'amountPaisa', {
      min: -MAX_AMOUNT_PAISA,
      max: MAX_AMOUNT_PAISA,
    });
    if (amountPaisa === 0) throw badRequest('amountPaisa must not be zero.');

    const entry = await adjustBudget(db, {
      teacherId: requireInt(body['teacherId'], 'teacherId', { min: 1 }),
      periodId: requireInt(body['budgetPeriodId'], 'budgetPeriodId', { min: 1 }),
      amountPaisa,
      reason: requireString(body['reason'], 'reason', { maxLength: REASON_MAX_LENGTH }),
      actorUserId: actor.id,
    });
    res.status(201).json({ data: presentBudgetEntry(entry) });
  };
}

export function getBudgetLedger(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const teacherId = readQueryInt(req, 'teacherId');
    const periodId = readQueryInt(req, 'period');
    const page = readOptionalQueryInt(req, 'page', 1, 1_000_000);
    const perPage = readOptionalQueryInt(req, 'perPage', 20, 100);
    const result = await getBudgetLedgerService(db, teacherId, periodId, page, perPage);
    res.status(200).json({
      data: result.entries.map(presentBudgetEntry),
      meta: { total: result.total, page, perPage },
    });
  };
}

function requireBusinessDate(value: unknown, field: string): string {
  const date = requireString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest(`${field} must be a valid date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest(`${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return date;
}

function readQueryInt(req: Request, key: string): number {
  return readOptionalQueryInt(req, key, undefined, Number.MAX_SAFE_INTEGER);
}

function readOptionalQueryInt(
  req: Request,
  key: string,
  fallback: number | undefined,
  max: number,
): number {
  const raw = req.query[key];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest(`${key} must be a positive integer.`);
  }
  return requireInt(Number(raw), key, { min: 1, max });
}
