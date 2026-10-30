import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';

interface OrderingStatusRow {
  server_now: Date;
  closes_at: Date;
  cutoff_time: string;
  disabled: boolean;
}

export function getOrderingStatus(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawDate = req.query['date'];
    if (rawDate !== undefined && typeof rawDate !== 'string') {
      throw badRequest('date must be a valid YYYY-MM-DD date.');
    }
    if (typeof rawDate === 'string') {
      const parsed = new Date(`${rawDate}T00:00:00.000Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ||
        Number.isNaN(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== rawDate
      ) {
        throw badRequest('date must be a valid YYYY-MM-DD date.');
      }
    }
    const { rows } = await db.query<OrderingStatusRow>(
      `WITH settings AS (
         SELECT COALESCE((SELECT value #>> '{}' FROM app_settings WHERE key = 'order_placement_deadline'), '12:30') AS cutoff
       ), business_date AS (
         SELECT COALESCE($1::date, (now() AT TIME ZONE 'Asia/Dhaka')::date) AS date,
                settings.cutoff FROM settings
       )
       SELECT now() AS server_now,
              ((business_date.date + business_date.cutoff::time) AT TIME ZONE 'Asia/Dhaka') AS closes_at,
              business_date.cutoff AS cutoff_time,
              EXISTS (SELECT 1 FROM app_settings
                       WHERE key = 'ordering_disabled_dates'
                         AND value @> to_jsonb(to_char(business_date.date, 'YYYY-MM-DD'))) AS disabled
         FROM business_date`,
      [rawDate ?? null],
    );
    const row = rows[0]!;
    const serverNow = new Date(row.server_now);
    const closesAt = new Date(row.closes_at);
    const closed = serverNow.getTime() >= closesAt.getTime();
    const open = !row.disabled && !closed;
    res.status(200).json({
      data: {
        open,
        closesAt: closesAt.toISOString(),
        secondsRemaining: open
          ? Math.max(0, Math.floor((closesAt.getTime() - serverNow.getTime()) / 1000))
          : 0,
        disabledReason: row.disabled
          ? 'Ordering is disabled for this date.'
          : closed
            ? `Ordering closed at ${formatCutoff(row.cutoff_time)} (Asia/Dhaka).`
            : null,
        serverTime: serverNow.toISOString(),
      },
    });
  };
}

function formatCutoff(value: string): string {
  const [hourPart = '0', minutePart = '00'] = value.split(':');
  const hour = Number(hourPart);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minutePart} ${suffix}`;
}
