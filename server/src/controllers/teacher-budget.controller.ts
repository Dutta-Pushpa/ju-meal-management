import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { requireInt } from '../utils/validation.js';
import { getTeacherBudget, getTeacherLedger } from '../services/teacher-budget.service.js';
import { presentTeacherBudget, presentTeacherLedgerEntry } from '../views/teacher-budget.view.js';
import { listBudgetPeriods } from '../models/budget.model.js';
import { currentDhakaMonth } from '../utils/dhaka-month.js';
import type { LedgerFilters } from '../models/budget.model.js';

const MAX_PAGE_SIZE = 20;

export function getBudget(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const { teacherId, year, month } = readIds(req, actor.id, actor.role);
    const summary = await getTeacherBudget(db, teacherId, year, month);
    res.status(200).json({ data: presentTeacherBudget(summary, year, month) });
  };
}

export function getLedger(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const { teacherId, year, month } = readIds(req, actor.id, actor.role);
    const page = readQueryInt(req, 'page', 1, 1, Number.MAX_SAFE_INTEGER);
    const perPage = readQueryInt(req, 'perPage', 20, 1, MAX_PAGE_SIZE);
    const filters = readLedgerFilters(req);
    const result = await getTeacherLedger(db, teacherId, year, month, page, perPage, filters);
    res.status(200).json({
      data: result.entries.map(presentTeacherLedgerEntry),
      meta: { total: result.total, page, perPage },
    });
  };
}

function readLedgerFilters(req: Request): LedgerFilters {
  const from = readOptionalDate(req, 'from');
  const to = readOptionalDate(req, 'to');
  if (from && to && from > to) throw badRequest('from must be on or before to.');
  const status = req.query['status'];
  if (status === undefined) return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  if (
    typeof status !== 'string' ||
    !['allocation', 'debit', 'refund', 'adjustment'].includes(status)
  ) {
    throw badRequest('status must be allocation, debit, refund, or adjustment.');
  }
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    status: status as NonNullable<LedgerFilters['status']>,
  };
}

function readOptionalDate(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${key} must be a valid date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${key} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

function readIds(req: Request, actorId: number, role: string) {
  const dhaka = currentDhakaMonth();
  const year = readQueryInt(req, 'year', dhaka.year, 1999, 2099);
  const month = readQueryInt(req, 'month', dhaka.month, 1, 12);
  const requestedTeacher = req.query['teacherId'];
  if (role === 'TEACHER') {
    if (
      requestedTeacher !== undefined &&
      readQueryInt(req, 'teacherId', undefined, 1, Number.MAX_SAFE_INTEGER) !== actorId
    ) {
      throw forbidden('Teachers may only view their own budget.');
    }
    return { teacherId: actorId, year, month };
  }
  return {
    teacherId: readQueryInt(req, 'teacherId', undefined, 1, Number.MAX_SAFE_INTEGER),
    year,
    month,
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
