import { useCallback, useEffect, useRef, useState } from 'react';
import { todayInDhaka } from './api';

/** Today's date in Dhaka, re-checked every minute so a page left open past midnight rolls over. */
export function useDhakaToday(): string {
  const [today, setToday] = useState(todayInDhaka);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayInDhaka()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

/**
 * The business date a page is showing. It starts on today and keeps following
 * "today" across midnight until the user picks another date. Clearing the date
 * input is ignored, so the page never asks the API for an empty date.
 */
export function useBusinessDate(): [string, (value: string) => void, string] {
  const today = useDhakaToday();
  const [date, setDate] = useState(today);
  const previousToday = useRef(today);

  useEffect(() => {
    if (previousToday.current === today) return;
    const rolledFrom = previousToday.current;
    previousToday.current = today;
    setDate((current) => (current === rolledFrom ? today : current));
  }, [today]);

  const changeDate = useCallback((value: string) => {
    if (value) setDate(value);
  }, []);
  return [date, changeDate, today];
}

/** Returns `value` once it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
