import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';
import { requireEnum, requireInt, requireObject, requireString } from '../utils/validation.js';
import {
  createBudgetRequest,
  decideBudgetRequest,
  listBudgetRequests,
} from '../services/budget-request.service.js';
import { presentBudgetRequest } from '../views/budget-request.view.js';

const REQUEST_TYPES = ['budget_increase', 'debt_allowance'] as const;
const MAX_PAGE_SIZE = 100;

/** POST /teacher/budget-requests — a teacher asks for a budget increase or
 * extra debt allowance. */
export function createRequest(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const requestType = requireEnum(body['requestType'], 'requestType', REQUEST_TYPES);
    const amountPaisa = requireInt(body['amountPaisa'], 'amountPaisa', {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const reason = requireString(body['reason'], 'reason', { maxLength: 1000 });
    const row = await createBudgetRequest(db, {
      teacherId: actor.id,
      requestType,
      amountPaisa,
      reason,
    });
    res.status(201).json({ data: presentBudgetRequest(row) });
  };
}

/** GET /teacher/budget-requests — the signed-in teacher's own requests. */
export function listMyRequests(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const page = readQueryInt(req, 'page', 1);
    const perPage = readQueryInt(req, 'perPage', 20);
    const result = await listBudgetRequests(
      db,
      { teacherId: actor.id, status: readStatus(req) },
      page,
      perPage,
    );
    res.status(200).json({
      data: result.rows.map(presentBudgetRequest),
      meta: { total: result.total, page, perPage },
    });
  };
}

/** GET /staff/budget-requests?status=&teacherId= — admin request inbox. */
export function staffListRequests(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const page = readQueryInt(req, 'page', 1);
    const perPage = readQueryInt(req, 'perPage', 50, MAX_PAGE_SIZE);
    const teacherIdRaw = req.query['teacherId'];
    const teacherId = teacherIdRaw === undefined ? undefined : readQueryInt(req, 'teacherId', 1);
    const result = await listBudgetRequests(
      db,
      { status: readStatus(req), teacherId },
      page,
      perPage,
    );
    res.status(200).json({
      data: result.rows.map(presentBudgetRequest),
      meta: { total: result.total, page, perPage },
    });
  };
}

/** POST /staff/budget-requests/:id/decision — approve or reject. */
export function decideRequest(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const id = requireInt(Number(req.params['id']), 'id', { min: 1 });
    const body = requireObject(req.body ?? {}, 'body');
    const decision = requireEnum(body['decision'], 'decision', ['approved', 'rejected'] as const);
    const note =
      typeof body['note'] === 'string' && body['note'].trim() ? body['note'].trim() : undefined;
    const result = await decideBudgetRequest(db, {
      requestId: id,
      decision,
      note,
      actorUserId: actor.id,
    });
    res.status(200).json({ data: presentBudgetRequest(result.request) });
  };
}

function readStatus(req: Request): string | undefined {
  const raw = req.query['status'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !['pending', 'approved', 'rejected'].includes(raw)) {
    throw badRequest("status must be 'pending', 'approved' or 'rejected'.");
  }
  return raw;
}

function readQueryInt(
  req: Request,
  key: string,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = req.query[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest(`${key} query parameter must be a positive integer.`);
  }
  return requireInt(Number(raw), key, { min: 1, max });
}
