import type { Request, Response } from 'express';
import { ORDER_STATUSES } from '@ju/shared';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest, forbidden } from '../utils/errors.js';
import {
  requireInt,
  requireIsoDate,
  requireObject,
  requireOptionalString,
  requireString,
} from '../utils/validation.js';
import { readDateQuery, readEnumQuery, readIntQuery, readPathId } from '../utils/request.js';
import {
  cancelOrder as cancelOrderService,
  getMyOrder,
  getMyOrders,
  placeOrder,
} from '../services/order.service.js';
import type { OrderItemInput } from '../models/order.model.js';
import { presentOrder } from '../views/order.view.js';

const MAX_LINES = 50;

export function createOrder(deps: { db: Database }) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const rawItems = body['items'];
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_LINES) {
      throw badRequest(`items must contain between 1 and ${MAX_LINES} entries.`);
    }
    const items: OrderItemInput[] = rawItems.map((raw, index) => {
      const line = requireObject(raw, `items[${index}]`);
      return {
        menuItemId: requireInt(line['menuItemId'], `items[${index}].menuItemId`, { min: 1 }),
        quantity: requireInt(line['quantity'], `items[${index}].quantity`, { min: 1, max: 100 }),
        notes:
          requireOptionalString(line['notes'], `items[${index}].notes`, { maxLength: 500 }) ?? null,
      };
    });
    const result = await placeOrder(deps.db, {
      teacherId: actor.id,
      orderDate: requireIsoDate(body['orderDate'], 'orderDate'),
      foodLocationId: requireInt(body['foodLocationId'], 'foodLocationId', { min: 1 }),
      idempotencyKey: requireString(body['idempotencyKey'], 'idempotencyKey', { maxLength: 200 }),
      items,
    });
    res
      .status(result.replayed ? 200 : 201)
      .json({ data: presentOrder(result.order, result.items) });
  };
}

export function listMyOrders(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const filters = {
      orderDate: readDateQuery(req, 'orderDate'),
      from: readDateQuery(req, 'from'),
      to: readDateQuery(req, 'to'),
      status: readEnumQuery(req, 'status', ORDER_STATUSES),
    };
    if (filters.from && filters.to && filters.from > filters.to) {
      throw badRequest('from must be on or before to.');
    }
    const page = readIntQuery(req, 'page', 1, 1, 1_000_000);
    const pageSize = readIntQuery(req, 'pageSize', 20, 1, 100);
    const result = await getMyOrders(db, actor.id, filters, page, pageSize);
    res.status(200).json({
      data: result.orders.map(({ row, items }) => presentOrder(row, items)),
      meta: { total: result.total, page, pageSize },
    });
  };
}

export function getMyOrderById(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const result = await getMyOrder(db, readPathId(req), actor.id);
    res.status(200).json({ data: presentOrder(result.order, result.items) });
  };
}

export function cancelOrder(deps: { db: Database }) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    if (
      actor.role !== 'TEACHER' &&
      actor.role !== 'ADMIN' &&
      !(actor.role === 'STAFF' && actor.permissions.includes('orders:cancel'))
    ) {
      throw forbidden('You do not have permission to cancel this order.');
    }
    const body = requireObject(req.body ?? {}, 'body');
    const reason = requireOptionalString(body['reason'], 'reason', { maxLength: 500 });
    if (actor.role !== 'TEACHER' && reason === undefined) {
      throw badRequest('reason is required for a staff cancellation.');
    }
    const result = await cancelOrderService(deps.db, {
      orderId: readPathId(req),
      actorId: actor.id,
      actorRole: actor.role,
      reason,
    });
    res.status(200).json({ data: presentOrder(result.order, result.items) });
  };
}
