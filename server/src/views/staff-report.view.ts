import type { DailyLocationTotal, TeacherBudgetReportRow } from '../models/staff-report.model.js';
import { presentMoney } from '../utils/money.js';

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
      total: presentMoney(row.total_paisa),
    })),
    dailyTotal: presentMoney(result.dailyTotalPaisa),
  };
}

export function presentBudgetReport(rows: TeacherBudgetReportRow[]) {
  return {
    data: rows.map((row) => ({
      teacher: { id: row.teacher_id, fullName: row.teacher_name },
      allocated: presentMoney(row.allocated_paisa),
      spent: presentMoney(row.spent_paisa),
      refunded: presentMoney(row.refunded_paisa),
      adjusted: presentMoney(row.adjusted_paisa),
      available: presentMoney(row.available_paisa),
    })),
    meta: { total: rows.length },
  };
}
