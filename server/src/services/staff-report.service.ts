import type { Database } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import * as reports from '../models/staff-report.model.js';
import * as budgets from '../models/budget.model.js';

export async function getDailyReport(db: Database, date: string) {
  const totals = await reports.getDailyTotals(db, date);
  const grandTotal = totals.find((row) => row.is_total === 1);
  const locations = totals.filter((row) => row.location_id !== null);
  const statusCounts = await reports.getDailyStatusCounts(db, date);
  const count = (statuses: string[]) =>
    statusCounts
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row.count, 0);
  const delivered = statusCounts.find((row) => row.status === 'DELIVERED');
  return {
    date,
    locations,
    dailyTotalPaisa: grandTotal?.total_paisa ?? 0,
    statusSummary: {
      total: statusCounts.reduce((sum, row) => sum + row.count, 0),
      // Pending = placed and awaiting collection; processing = collected but
      // not yet delivered. Orders are created as CONFIRMED, so CONFIRMED must
      // be counted as pending (PENDING/ACCEPTED are legacy statuses).
      pending: count(['PENDING', 'ACCEPTED', 'CONFIRMED']),
      processing: count(['COLLECTED']),
      delivered: count(['DELIVERED']),
      cancelled: count(['CANCELLED']),
      spendingOnDeliveredPaisa: delivered?.total_paisa ?? 0,
    },
  };
}

export async function getBudgetReport(db: Database, periodId: number) {
  if (!(await budgets.budgetPeriodExists(db, periodId))) throw notFound('Budget period not found.');
  return reports.listTeacherBudgetReport(db, periodId);
}

export interface MonthlyTeacherReportMonth {
  year: number;
  month: number;
  label: string;
  teachers: Array<{
    teacherId: number;
    teacherName: string;
    allocatedPaisa: number;
    adjustedPaisa: number;
    carryForwardPaisa: number;
    spentPaisa: number;
    refundedPaisa: number;
    remainingPaisa: number;
    totalOrders: number;
    pendingOrders: number;
    processingOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    deliveredSpendingPaisa: number;
  }>;
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Monthly teacher report for the six months ending at the anchor month: budget
 * state (allocation, adjustments, carry-forward, spending, remaining/debt)
 * combined with order counts by status per teacher per month.
 */
export async function getMonthlyTeacherReport(
  db: Database,
  anchorYear: number,
  anchorMonth: number,
): Promise<MonthlyTeacherReportMonth[]> {
  const months: Array<{ year: number; month: number; label: string }> = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const year = anchorMonth - offset < 1 ? anchorYear - 1 : anchorYear;
    const month = ((anchorMonth - offset - 1 + 12) % 12) + 1;
    months.push({
      year,
      month,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
    });
  }

  const stats = await reports.getMonthlyOrderStats(db, anchorYear, anchorMonth);
  const statsByKey = new Map<string, reports.MonthlyOrderStatsRow>();
  for (const row of stats) statsByKey.set(`${row.ym}:${row.teacher_id}`, row);

  const result: MonthlyTeacherReportMonth[] = [];
  for (const window of months) {
    const balances = await budgets.findMonthlyTeacherBalances(db, window.year, window.month);
    const ym = `${window.year}-${String(window.month).padStart(2, '0')}`;
    result.push({
      year: window.year,
      month: window.month,
      label: window.label,
      teachers: balances.map((balance) => {
        const stat = statsByKey.get(`${ym}:${balance.teacher_id}`);
        return {
          teacherId: balance.teacher_id,
          teacherName: balance.teacher_name,
          allocatedPaisa: Number(balance.allocated_paisa),
          adjustedPaisa: Number(balance.adjusted_paisa),
          carryForwardPaisa: Number(balance.carry_forward_paisa),
          spentPaisa: Number(balance.spent_paisa),
          refundedPaisa: Number(balance.refunded_paisa),
          remainingPaisa: Number(balance.available_paisa),
          totalOrders: stat?.total_orders ?? 0,
          pendingOrders: stat?.pending_orders ?? 0,
          processingOrders: stat?.processing_orders ?? 0,
          deliveredOrders: stat?.delivered_orders ?? 0,
          cancelledOrders: stat?.cancelled_orders ?? 0,
          deliveredSpendingPaisa: Number(stat?.delivered_spent_paisa ?? 0),
        };
      }),
    });
  }
  return result;
}
