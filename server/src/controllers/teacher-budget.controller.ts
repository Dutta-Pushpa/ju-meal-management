import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { forbidden, badRequest } from '../utils/errors.js';
import { readIntQuery, requireIntQuery } from '../utils/request.js';
import { getTeacherBudget, getTeacherLedger } from '../services/teacher-budget.service.js';
import { presentTeacherBudget, presentTeacherLedgerEntry } from '../views/teacher-budget.view.js';

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
    const page = readIntQuery(req, 'page', 1, 1, Number.MAX_SAFE_INTEGER);
    const perPage = readIntQuery(req, 'perPage', 20, 1, MAX_PAGE_SIZE);
    const result = await getTeacherLedger(db, teacherId, periodId, page, perPage);
    res.status(200).json({
      data: result.entries.map(presentTeacherLedgerEntry),
      meta: { total: result.total, page, perPage },
    });
  };
}

/**
 * Resolve whose budget is being read.
 *
 * A teacher may only read their own. Staff and administrators may name any
 * teacher, and default to nobody in particular when they do not.
 */
function readIds(req: Request, actorId: number, role: string) {
  const periodId = requireIntQuery(req, 'period', 1, Number.MAX_SAFE_INTEGER);
  const requestedTeacher = req.query['teacherId'];

  if (role === 'TEACHER') {
    if (
      requestedTeacher !== undefined &&
      requireIntQuery(req, 'teacherId', 1, Number.MAX_SAFE_INTEGER) !== actorId
    ) {
      throw forbidden('Teachers may only view their own budget.');
    }
    return { teacherId: actorId, periodId };
  }

  if (requestedTeacher === undefined) {
    throw badRequest('teacherId is required.');
  }

  return {
    teacherId: requireIntQuery(req, 'teacherId', 1, Number.MAX_SAFE_INTEGER),
    periodId,
  };
}
