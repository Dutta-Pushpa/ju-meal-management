import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { requireInt } from '../utils/validation.js';
import { getTeacherBudget, getTeacherLedger } from '../services/teacher-budget.service.js';
import { presentTeacherBudget, presentTeacherLedgerEntry } from '../views/teacher-budget.view.js';
import { listBudgetPeriods } from '../models/budget.model.js';

const MAX_PAGE_SIZE = 100;

export function getBudget(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const { teacherId, periodId } = readIds(req, actor.id, actor.role);
    const summary = await getTeacherBudget(db, teacherId, periodId);
    res.status(200).json({ data: presentTeacherBudget(summary) });
  };
}

export function getLedger(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const { teacherId, periodId } = readIds(req, actor.id, actor.role);
    const page = readQueryInt(req, 'page', 1, 1, Number.MAX_SAFE_INTEGER);
    const perPage = readQueryInt(req, 'perPage', 20, 1, MAX_PAGE_SIZE);
    const result = await getTeacherLedger(db, teacherId, periodId, page, perPage);
    res.status(200).json({
      data: result.entries.map(presentTeacherLedgerEntry),
      meta: { total: result.total, page, perPage },
    });
  };
}

function readIds(req: Request, actorId: number, role: string) {
  const periodId = readQueryInt(req, 'period', undefined, 1, Number.MAX_SAFE_INTEGER);
  const requestedTeacher = req.query['teacherId'];
  if (role === 'TEACHER') {
    if (
      requestedTeacher !== undefined &&
      readQueryInt(req, 'teacherId', undefined, 1, Number.MAX_SAFE_INTEGER) !== actorId
    ) {
      throw forbidden('Teachers may only view their own budget.');
    }
    return { teacherId: actorId, periodId };
  }
  return {
    teacherId: readQueryInt(req, 'teacherId', undefined, 1, Number.MAX_SAFE_INTEGER),
    periodId,
  };
}

function readQueryInt(
  req: Request,
  key: string,
  fallback: number | undefined,
  min: number,
  max: number,
): number {
  const raw = req.query[key];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest(`${key} query parameter must be a positive integer.`);
  }
  return requireInt(Number(raw), key, { min, max });
}

/** GET /api/teacher/budget-periods — safe period choices for all authenticated roles. */
export function getBudgetPeriods(db: Database) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listBudgetPeriods(db);
    res.status(200).json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        isActive: row.is_active,
        createdAt: row.created_at.toISOString(),
      })),
      meta: { total: rows.length },
    });
  };
}
