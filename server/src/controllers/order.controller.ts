import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';
import {
  requireEnum,
  requireInt,
  requireObject,
  requireString,
  ValidationError,
} from '../utils/validation.js';
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
        notes: optionalNotes(line['notes'], `items[${index}].notes`),
      };
    });
    // Optional fallback dish: what the teacher accepts if their first choice is
    // unavailable. Name and price must be provided together.
    let alternativeItemName: string | null = null;
    let alternativeUnitPricePaisa: number | null = null;
    if (body['alternativeItemName'] !== undefined || body['alternativeUnitPricePaisa'] !== undefined) {
      alternativeItemName = requireString(body['alternativeItemName'], 'alternativeItemName', {
        maxLength: 200,
      });
      alternativeUnitPricePaisa = requireInt(
        body['alternativeUnitPricePaisa'],
        'alternativeUnitPricePaisa',
        { min: 1 },
      );
    }
    const result = await placeOrder(deps.db, {
      teacherId: actor.id,
      orderDate: requireBusinessDate(body['orderDate'], 'orderDate'),
      foodLocationId: requireInt(body['foodLocationId'], 'foodLocationId', { min: 1 }),
      idempotencyKey: requireString(body['idempotencyKey'], 'idempotencyKey', { maxLength: 200 }),
      items,
      alternativeItemName,
      alternativeUnitPricePaisa,
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
      status: readStatusQuery(req),
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
    const result = await getMyOrder(db, readId(req), actor.id);
    res.status(200).json({ data: presentOrder(result.order, result.items) });
  };
}

export function cancelOrder(deps: { db: Database }) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    // Role-only access: staff and admin may cancel any order; teachers may
    // cancel their own (enforced in the service). The TEACHER/STAFF/ADMIN role
    // claim is validated at authentication, so no further check is needed.
    const body = requireObject(req.body ?? {}, 'body');
    const reason =
      body['reason'] === undefined
        ? undefined
        : requireString(body['reason'], 'reason', { maxLength: 500 });
    if (actor.role !== 'TEACHER' && reason === undefined) {
      throw badRequest('reason is required for a staff cancellation.');
    }
    const result = await cancelOrderService(deps.db, {
      orderId: readId(req),
      actorId: actor.id,
      actorRole: actor.role,
      reason,
    });
    res.status(200).json({ data: presentOrder(result.order, result.items) });
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

function optionalNotes(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be a string` },
    ]);
  }
  const notes = value.trim();
  if (notes.length > 500) {
    throw new ValidationError([
      { field, issue: 'too_big', message: `${field} must be at most 500 characters` },
    ]);
  }
  return notes || null;
}

function readId(req: Request): number {
  const raw = req.params['id'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest('id must be a positive integer.');
  }
  return requireInt(Number(raw), 'id', { min: 1 });
}

function readDateQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (value === undefined) return undefined;
  return requireBusinessDate(value, key);
}

function readStatusQuery(
  req: Request,
): 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED' | undefined {
  const value = req.query['status'];
  if (value === undefined) return undefined;
  return requireEnum(value, 'status', [
    'CONFIRMED',
    'COLLECTED',
    'DELIVERED',
    'CANCELLED',
  ] as const);
}

function readIntQuery(
  req: Request,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = req.query[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw badRequest(`${key} must be a positive integer.`);
  }
  return requireInt(Number(raw), key, { min, max });
}
