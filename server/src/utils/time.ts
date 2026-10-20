/**
 * Time and time zone helpers.
 *
 * The application works in one business time zone, `Asia/Dhaka`, and the cutoff
 * is evaluated against it. A client-supplied clock is never trusted.
 */

/** Whether the string names a time zone the runtime knows about. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Whether the string is a clock time in 24-hour `HH:mm` form. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}
