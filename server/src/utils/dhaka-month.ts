import { TIMEZONE } from '../routes/location.routes.js';

/** Current Dhaka business month as {year, month}. */
export function currentDhakaMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(values['year']), month: Number(values['month']) };
}
