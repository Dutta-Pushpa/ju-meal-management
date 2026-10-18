import type {
  DailyLocationTotal,
  TeacherBudgetReportRow,
} from '../models/staff-report.model.js';

function money(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return { amountPaisa, amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}` };
}

export function presentDailyReport(result: {
  date: string;
  locations: DailyLocationTotal[];
  dailyTotalPaisa: number;
}) {
  return {
    date: result.date,
    locations: result.locations.map((row) => ({
      location: { id: row.location_id!, name: row.location_name! },
      orderCount: row.order_count,
      total: money(row.total_paisa),
    })),
    dailyTotal: money(result.dailyTotalPaisa),
  };
}

export function presentBudgetReport(rows: TeacherBudgetReportRow[]) {
  return {
    data: rows.map((row) => ({
      teacher: { id: row.teacher_id, fullName: row.teacher_name },
      allocated: money(row.allocated_paisa),
      spent: money(row.spent_paisa),
      refunded: money(row.refunded_paisa),
      adjusted: money(row.adjusted_paisa),
      available: money(row.available_paisa),
    })),
    meta: { total: rows.length },
  };
}
