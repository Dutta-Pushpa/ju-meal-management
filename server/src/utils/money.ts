import type { Money } from '@ju/shared';

/**
 * Money formatting.
 *
 * Money is always integer paisa. One taka is 100 paisa, so ৳150 is `15000`.
 * Floating point is never used for the stored or computed value; it appears
 * only in the display string, which is never meant to be parsed.
 *
 * The sign is placed before the currency symbol, so a negative amount reads
 * `-৳50.00` and not `৳-50.00`.
 */

/** The display string for an amount in paisa, for example `৳150.00`. */
export function formatMoney(amountPaisa: number): string {
  const sign = amountPaisa < 0 ? '-' : '';
  return `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}`;
}

/**
 * The wire shape of an amount: the authoritative integer, and the display
 * string. Clients use `amountPaisa` for arithmetic and never parse
 * `amountFormatted`.
 */
export function presentMoney(amountPaisa: number): Money {
  return { amountPaisa, amountFormatted: formatMoney(amountPaisa) };
}
