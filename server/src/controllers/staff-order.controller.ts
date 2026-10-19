import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest, forbidden, unprocessable } from '../utils/errors.js';
import {
  requireEnum,
  requireInt,
  requireObject,
  requireString,
  ValidationError,
} from '../utils/validation.js';
import { cancelOrder as cancelOrderService } from '../services/order.service.js';
import {
  changeOrderItemStatus,
  changeOrderStatus,
  getGroupedStaffOrders,
  getStaffOrders,
} from '../services/staff-order.service.js';
import { presentGroupedOrders, presentStaffOrder } from '../views/staff-order.view.js';
import type { StaffOrderFilters } from '../models/staff-order.model.js';
import { presentOrder } from '../views/order.view.js';

const ORDER_STATUSES = ['CONFIRMED', 'COLLECTED', 'DELIVERED', 'CANCELLED'] as const;

export function listStaffOrders(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const filters: StaffOrderFilters = {
      date: readBusinessDate(req.query['date'], 'date'),
      locationId: readOptionalInt(req, 'locationId'),
      status: readOptionalStatus(req),
      teacherId: readOptionalInt(req, 'teacherId'),
    };
    const page = readIntQuery(req, 'page', 1, 1_000_000);
    const pageSize = readIntQuery(req, 'pageSize', 50, 100);
    const result = await getStaffOrders(db, filters, page, pageSize);
    res.status(200).json({
      data: result.orders.map(({ row, items }) => presentStaffOrder(row, items)),
      meta: { total: result.total, page, pageSize },
    });
  };
}

export function groupedStaffOrders(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const date = readBusinessDate(req.query['date'], 'date');
    const result = await getGroupedStaffOrders(db, date);
    res.status(200).json({ data: presentGroupedOrders(result) });
  };
}

export function patchStaffOrderStatus(deps: { db: Database; config: AppConfig }) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const status = requireEnum(body['status'], 'status', ORDER_STATUSES);
    const note = optionalNote(body['note']);
    const orderId = readPathId(req);

    if (status === 'CANCELLED') {
      requirePermission(actor.role, actor.permissions, 'orders:cancel');
      if (!note) throw badRequest('note is required when cancelling an order.');
      const result = await cancelOrderService(deps.db, {
        orderId,
        actorId: actor.id,
        actorRole: actor.role,
        reason: note,
      });
      res.status(200).json({ data: presentOrder(result.order, result.items) });
      return;
    }

    requirePermission(actor.role, actor.permissions, 'orders:manage_status');
    if (status === 'CONFIRMED') {
      throw unprocessable('INVALID_STATUS_TRANSITION', 'Orders cannot be moved back to confirmed.');
    }
    const result = await changeOrderStatus(deps.db, {
      orderId,
      status,
      actorId: actor.id,
      note,
    });
    res
      .status(200)
      .json({ data: { id: orderId, oldStatus: result.oldStatus, status: result.status } });
  };
}

export function patchStaffOrderItemStatus(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    requirePermission(actor.role, actor.permissions, 'orders:manage_status');
    const body = requireObject(req.body ?? {}, 'body');
    const status = requireEnum(body['status'], 'status', ['COLLECTED', 'DELIVERED'] as const);
    const itemId = readPathId(req);
    const result = await changeOrderItemStatus(db, {
      itemId,
      status,
      actorId: actor.id,
      note: optionalNote(body['note']),
    });
    res.status(200).json({
      data: { id: itemId, oldStatus: result.oldStatus, status: result.status },
    });
  };
}

function readBusinessDate(value: unknown, field: string): string {
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

function readOptionalInt(req: Request, key: string): number | undefined {
  const raw = req.query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest(`${key} must be a positive integer.`);
  }
  return requireInt(Number(raw), key, { min: 1, max: Number.MAX_SAFE_INTEGER });
}

function readOptionalStatus(req: Request): StaffOrderFilters['status'] {
  const raw = req.query['status'];
  if (raw === undefined) return undefined;
  return requireEnum(raw, 'status', ORDER_STATUSES);
}

function readIntQuery(req: Request, key: string, fallback: number, max: number): number {
  const raw = req.query[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest(`${key} must be a positive integer.`);
  }
  return requireInt(Number(raw), key, { min: 1, max });
}

function readPathId(req: Request): number {
  const raw = req.params['id'];
  if (!raw || !/^\d+$/.test(raw)) throw badRequest('id must be a positive integer.');
  return requireInt(Number(raw), 'id', { min: 1 });
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError([
      { field: 'note', issue: 'invalid_type', message: 'note must be a string' },
    ]);
  }
  const note = value.trim();
  if (note.length > 500) {
    throw new ValidationError([
      { field: 'note', issue: 'too_big', message: 'note must be at most 500 characters' },
    ]);
  }
  return note || null;
}

function requirePermission(
  role: 'TEACHER' | 'STAFF' | 'ADMIN',
  permissions: readonly string[],
  permission: 'orders:cancel' | 'orders:manage_status',
): void {
  if (role !== 'ADMIN' && (role !== 'STAFF' || !permissions.includes(permission))) {
    throw forbidden('You do not have permission to perform this action.');
  }
}
