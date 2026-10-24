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
}
export interface Order {
  id: number;
  orderDate: string;
  foodLocation: { id: number; name: string };
  status: OrderStatus;
  total: Money;
  items: OrderItem[];
  confirmedAt: string;
}
export interface BudgetSummary {
  period: BudgetPeriod;
  allocated: Money;
  spent: Money;
  refunded: Money;
  adjusted: Money;
  available: Money;
}
export interface LedgerEntry {
  id: number;
  teacherId: number;
  budgetPeriodId: number;
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
  items: Array<{ name: string; quantity: number }>;
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
      items: Array<{ name: string; quantity: number }>;
      total: Money;
    }>;
  }>;
  dailyTotal: Money;
}
export interface DailyReport {
  date: string;
  locations: Array<{ location: { id: number; name: string }; orderCount: number; total: Money }>;
  dailyTotal: Money;
}
export interface BudgetReportRow {
  teacher: { id: number; fullName: string };
  allocated: Money;
  spent: Money;
  refunded: Money;
  adjusted: Money;
  available: Money;
}
export interface AppSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: number | null;
  updatedAt: string;
}
