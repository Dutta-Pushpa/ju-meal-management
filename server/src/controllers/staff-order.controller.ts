import type { Request, Response } from 'express';
import { ORDER_STATUSES } from '@ju/shared';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import { assertPermission, currentUser } from '../middleware/auth.js';
import { badRequest, unprocessable } from '../utils/errors.js';
import { requireEnum, requireObject, requireOptionalString } from '../utils/validation.js';
import {
  readEnumQuery,
  readIntQuery,
  readOptionalIntQuery,
  readPathId,
  requireDateQuery,
} from '../utils/request.js';
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

/**
 * The states an item may be moved to. `PENDING` is the state an item is
 * created in, never a transition target.
 */
const ITEM_STATUS_TARGETS = ['COLLECTED', 'DELIVERED'] as const;

export function listStaffOrders(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const filters: StaffOrderFilters = {
      date: requireDateQuery(req, 'date'),
      locationId: readOptionalIntQuery(req, 'locationId', 1, Number.MAX_SAFE_INTEGER),
      status: readEnumQuery(req, 'status', ORDER_STATUSES),
      teacherId: readOptionalIntQuery(req, 'teacherId', 1, Number.MAX_SAFE_INTEGER),
    };
    const page = readIntQuery(req, 'page', 1, 1, 1_000_000);
    const pageSize = readIntQuery(req, 'pageSize', 50, 1, 100);
    const result = await getStaffOrders(db, filters, page, pageSize);
    res.status(200).json({
      data: result.orders.map(({ row, items }) => presentStaffOrder(row, items)),
      meta: { total: result.total, page, pageSize },
    });
  };
}

export function groupedStaffOrders(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const date = requireDateQuery(req, 'date');
    const result = await getGroupedStaffOrders(db, date);
    res.status(200).json({ data: presentGroupedOrders(result) });
  };
}

export function patchStaffOrderStatus(deps: { db: Database; config: AppConfig }) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const status = requireEnum(body['status'], 'status', ORDER_STATUSES);
    const note = requireOptionalString(body['note'], 'note', { maxLength: 500 }) ?? null;
    const orderId = readPathId(req);

    if (status === 'CANCELLED') {
      assertPermission(actor, 'orders:cancel');
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

    assertPermission(actor, 'orders:manage_status');
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
    assertPermission(actor, 'orders:manage_status');
    const body = requireObject(req.body ?? {}, 'body');
    const status = requireEnum(body['status'], 'status', ITEM_STATUS_TARGETS);
    const itemId = readPathId(req);
    const result = await changeOrderItemStatus(db, {
      itemId,
      status,
      actorId: actor.id,
      note: requireOptionalString(body['note'], 'note', { maxLength: 500 }) ?? null,
    });
    res.status(200).json({
      data: { id: itemId, oldStatus: result.oldStatus, status: result.status },
    });
  };
}
