export type Role = 'TEACHER' | 'STAFF' | 'ADMIN';
export type Permission =
  | 'locations:manage'
  | 'menu_items:manage'
  | 'budgets:view'
  | 'budgets:allocate'
  | 'budgets:adjust'
  | 'orders:cancel'
  | 'orders:manage_status'
  | 'users:create'
  | 'users:manage'
  | 'settings:manage';
export type OrderStatus = 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED';

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  designation?: string | null;
  permissions: Permission[];
  isActive: boolean;
  createdAt: string;
}
export interface Money {
  amountPaisa: number;
  amountFormatted: string;
}
export interface Location {
  id: number;
  name: string;
  nameBn: string | null;
  description: string | null;
  isActive: boolean;
  availableMenuItemCount?: number;
}
export interface BudgetPeriod {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  createdAt?: string;
}
export interface MenuItem {
  id: number;
  foodLocationId: number;
  name: string;
  description: string | null;
  category: string | null;
  price: Money;
  isAvailable: boolean;
  isSoldOut?: boolean;
  isActive?: boolean;
  location?: { id: number; name: string };
}
export interface OrderItem {
  id: number;
  menuItemId?: number | null;
  name: string;
  quantity: number;
  unitPrice?: Money;
  lineTotal?: Money;
  notes?: string | null;
  alternativeMenuItemId?: number | null;
  alternativeMenuItemName?: string | null;
}
export interface Order {
  id: number;
  orderDate: string;
  foodLocation: { id: number; name: string };
  status: OrderStatus;
  total: Money;
  items: OrderItem[];
  confirmedAt: string;
  canCancel?: boolean;
  cancelBlockedReason?: string | null;
  cancelDeadline?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  refundAmount?: Money;
  actualCost?: Money | null;
}
export interface BudgetSummary {
  year: number;
  month: number;
  period: { id: string; name: string; startsOn: string; endsOn: string };
  hasAllocation: boolean;
  allocated: Money;
  adjusted: Money;
  carryForward: Money;
  spent: Money;
  refunded: Money;
  available: Money;
}
export interface LedgerEntry {
  id: number;
  teacherId: number;
  budgetPeriodId: number | null;
  year: number | null;
  month: number | null;
  entryType: string;
  amount: Money;
  orderId: number | null;
  reason: string | null;
  createdBy: number;
  createdAt: string;
}
export interface StaffOrder {
  id: number;
  teacher: { id: number; fullName: string };
  foodLocation: { id: number; name: string };
  orderDate: string;
  status: OrderStatus;
  total: Money;
  /** The fallback dish the teacher declared when ordering, if any. */
  alternativeItemName: string | null;
  alternativeUnitPrice: Money | null;
  items: Array<{ name: string; quantity: number; notes?: string | null }>;
  confirmedAt: string;
}
export interface GroupedOrders {
  date: string;
  orderCount: number;
  locations: Array<{
    location: { id: number; name: string };
    teacherCount: number;
    total: Money;
    itemSummary: Array<{ name: string; quantity: number }>;
    orders: Array<{
      id: number;
      teacherName: string;
      items: Array<{ name: string; quantity: number; notes?: string | null }>;
      total: Money;
    }>;
  }>;
  dailyTotal: Money;
}
export interface DailyReport {
  date: string;
  statusSummary: {
    total: number;
    pending: number;
    processing: number;
    delivered: number;
    cancelled: number;
    spendingOnDelivered: Money;
  };
  locations: Array<{ location: { id: number; name: string }; orderCount: number; total: Money }>;
  dailyTotal: Money;
}
export interface BudgetRequest {
  id: number;
  teacher: { id: number; fullName: string };
  requestType: 'budget_increase' | 'debt_allowance';
  amount: Money;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: { id: number; fullName: string | null } | null;
  decidedAt: string | null;
  createdAt: string;
}
export interface MonthlyReportTeacher {
  teacher: { id: number; fullName: string };
  allocated: Money;
  adjusted: Money;
  carryForward: Money;
  spent: Money;
  refunded: Money;
  remaining: Money;
  orders: {
    total: number;
    pending: number;
    processing: number;
    delivered: number;
    cancelled: number;
    deliveredSpending: Money;
  };
}
export interface MonthlyReportMonth {
  year: number;
  month: number;
  label: string;
  teachers: MonthlyReportTeacher[];
}
/** One teacher in the monthly budget planning table. */
export interface MonthlyBudgetRow {
  teacher: { id: number; fullName: string; email: string };
  hasAllocation: boolean;
  /** Base allocation for the month. */
  allocated: Money;
  /** Net admin adjustments recorded for the month (increase or decrease). */
  adjusted: Money;
  /** Budget carried into the month from all previous months (may be negative). */
  carryForward: Money;
  spent: Money;
  refunded: Money;
  /** allocated + adjusted + carry - spent. Negative when the teacher overdrew. */
  remaining: Money;
}

/** A successful (non-cancelled) order of one budget month. */
export interface MonthTransaction {
  id: number;
  transactionId: string;
  teacher: { id: number; fullName: string };
  orderDate: string;
  amount: Money;
  status: string;
}

export interface AllocationHistoryMonth {
  year: number;
  month: number;
  label: string;
  totalAllocated: Money;
  teachers: Array<{ teacherId: number; fullName: string; allocated: Money }>;
}

export interface AllocationHistory {
  anchor: { year: number; month: number };
  months: AllocationHistoryMonth[];
  grandTotal: Money;
}
export interface AppSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: number | null;
  updatedAt: string;
}
