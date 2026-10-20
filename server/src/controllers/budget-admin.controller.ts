import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';
import { requireInt, requireIsoDate, requireObject, requireString } from '../utils/validation.js';
import { readIntQuery, requireIntQuery } from '../utils/request.js';
import { currentUser } from '../middleware/auth.js';
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
    const startsOn = requireIsoDate(body['startsOn'], 'startsOn');
    const endsOn = requireIsoDate(body['endsOn'], 'endsOn');

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
        rolledOverTeachers: period.rolledOverTeachers,
        rolledOverAmountPaisa: period.rolledOverAmountPaisa,
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
      periodId: requireInt(body['budgetPeriodId'], 'budgetPeriodId', { min: 1 }),
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
    const teacherId = requireIntQuery(req, 'teacherId', 1, Number.MAX_SAFE_INTEGER);
    const periodId = requireIntQuery(req, 'period', 1, Number.MAX_SAFE_INTEGER);
    const page = readIntQuery(req, 'page', 1, 1, 1_000_000);
    const perPage = readIntQuery(req, 'perPage', 20, 1, 100);
    const result = await getBudgetLedgerService(db, teacherId, periodId, page, perPage);
    res.status(200).json({
      data: result.entries.map(presentBudgetEntry),
      meta: { total: result.total, page, perPage },
    });
  };
}
