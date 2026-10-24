import { useEffect, useMemo, useState } from 'react';
import { api, asMessage, hasPermission, todayInDhaka } from '../api';
import type {
  BudgetPeriod,
  BudgetReportRow,
  DailyReport,
  GroupedOrders,
  Location,
  OrderStatus,
  StaffOrder,
  User,
} from '../types';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  StatCard,
  StatusPill,
  TableWrap,
} from '../ui';

export function StaffOperations({ token, user }: { token: string; user: User }) {
  const [date, setDate] = useState(todayInDhaka());
  const [grouped, setGrouped] = useState<GroupedOrders | null>(null);
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const canUpdate = hasPermission(user.role, user.permissions, 'orders:manage_status');
  const canCancel = hasPermission(user.role, user.permissions, 'orders:cancel');

  async function load() {
    setLoading(true);
    setError('');
    setGrouped(null);
    setOrders([]);
    setLocations([]);
    try {
      const [groupData, orderData, locationData] = await Promise.all([
        api<GroupedOrders>(`/staff/orders/grouped?date=${encodeURIComponent(date)}`, { token }),
        api<StaffOrder[]>(
          `/staff/orders?date=${encodeURIComponent(date)}&pageSize=100${statusFilter !== 'ALL' ? `&status=${encodeURIComponent(statusFilter)}` : ''}`,
          { token },
        ),
        api<Location[]>('/locations', { token }),
      ]);
      setGrouped(groupData);
      setOrders(orderData);
      setLocations(locationData);
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [token, date, statusFilter]);
  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          (statusFilter === 'ALL' || order.status === statusFilter) &&
          (locationFilter === 'ALL' || String(order.foodLocation.id) === locationFilter),
      ),
    [orders, statusFilter, locationFilter],
  );

  function printLocationSheet(locationId: number) {
    const target = document.querySelector<HTMLElement>(`[data-print-location="${locationId}"]`);
    if (!target) return;
    target.classList.add('print-location-target');
    document.body.classList.add('printing-location-sheet');
    const cleanup = () => {
      target.classList.remove('print-location-target');
      document.body.classList.remove('printing-location-sheet');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
  }

  async function changeStatus(order: StaffOrder, status: OrderStatus) {
    setBusyId(order.id);
    setError('');
    setSuccess('');
    try {
      await api(`/staff/orders/${order.id}/status`, {
        token,
        method: 'PATCH',
        body: {
          status,
          note: status === 'COLLECTED' ? 'Collected by staff' : 'Delivered to teacher',
        },
      });
      setSuccess(`Order #${order.id} updated to ${status.toLowerCase()}.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusyId(null);
    }
  }
  async function cancel(order: StaffOrder) {
    const reason = window.prompt(`Reason for cancelling order #${order.id}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError('A reason is required for staff cancellation.');
      return;
    }
    setBusyId(order.id);
    setError('');
    setSuccess('');
    try {
      await api(`/staff/orders/${order.id}/status`, {
        token,
        method: 'PATCH',
        body: { status: 'CANCELLED', note: reason.trim() },
      });
      setSuccess(`Order #${order.id} cancelled; the server recorded the cancellation and refund.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="STAFF OPERATIONS"
        title="Daily meal operations"
        description="Review actual orders from the database, grouped by food location for preparation and collection."
        action={
          <Button variant="secondary" onClick={() => void load()}>
            ↻ Refresh
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      <Card className="filter-card">
        <div className="filter-grid">
          <Field label="Business date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Food location">
            <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="ALL">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="ALL">All current orders</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="COLLECTED">Collected</option>
              <option value="DELIVERED">Delivered</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
        </div>
      </Card>
      {loading ? (
        <Loading />
      ) : grouped ? (
        <>
          <div className="stat-grid">
            <StatCard
              label="Active orders"
              value={String(grouped.orderCount)}
              detail={`For ${date}`}
              tone="violet"
              symbol="≡"
            />
            <StatCard
              label="Daily order value"
              value={grouped.dailyTotal.amountFormatted}
              detail="Excludes cancelled orders"
              tone="green"
              symbol="৳"
            />
            <StatCard
              label="Food locations"
              value={String(grouped.locations.length)}
              detail="With non-cancelled order activity"
              tone="blue"
              symbol="⌂"
            />
            <StatCard
              label="Orders matching filters"
              value={String(visibleOrders.length)}
              detail="Selected date, location and status"
              tone="orange"
              symbol="◷"
            />
          </div>
          <div className="content-grid operations-grid">
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Location collection summaries</h2>
                  <p>Item quantities are aggregated from persisted orders.</p>
                </div>
              </div>
              {grouped?.locations.length ? (
                <div className="location-summaries">
                  {grouped.locations.map((group) => (
                    <div
                      className="location-summary"
                      data-print-location={group.location.id}
                      key={group.location.id}
                    >
                      <div className="location-summary-top">
                        <div>
                          <span className="location-dot">{group.location.name.slice(0, 1)}</span>
                          <strong>{group.location.name}</strong>
                        </div>
                        <strong>{group.total.amountFormatted}</strong>
                      </div>
                      <div className="summary-meta">
                        {group.teacherCount} teachers · {group.orders.length} orders
                      </div>
                      <div className="item-sum-list">
                        {group.itemSummary.map((item) => (
                          <div key={item.name}>
                            <span>{item.name}</span>
                            <b>× {item.quantity}</b>
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => printLocationSheet(group.location.id)}
                      >
                        Print collection sheet
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No non-cancelled orders for this date"
                  detail="When teachers confirm meal orders, location summaries will appear here."
                />
              )}
            </Card>
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Order queue</h2>
                  <p>Update orders as meals are prepared and handed over.</p>
                </div>
                <span className="record-count">{visibleOrders.length} shown</span>
              </div>
              {visibleOrders.length ? (
                <div className="queue-list">
                  {visibleOrders.map((order) => (
                    <div className="queue-row" key={order.id}>
                      <div className="queue-head">
                        <div>
                          <strong>
                            #{order.id} · {order.teacher.fullName}
                          </strong>
                          <span>{order.foodLocation.name}</span>
                        </div>
                        <StatusPill status={order.status} />
                      </div>
                      <div className="queue-items">
                        {order.items.map((item, index) => (
                          <span key={`${item.name}-${index}`}>
                            {item.name} × {item.quantity}
                          </span>
                        ))}
                      </div>
                      <div className="queue-bottom">
                        <strong>{order.total.amountFormatted}</strong>
                        <div className="button-row">
                          {canUpdate && order.status === 'CONFIRMED' && (
                            <Button
                              disabled={busyId === order.id}
                              onClick={() => void changeStatus(order, 'COLLECTED')}
                            >
                              Mark collected
                            </Button>
                          )}
                          {canUpdate && order.status === 'COLLECTED' && (
                            <Button
                              disabled={busyId === order.id}
                              onClick={() => void changeStatus(order, 'DELIVERED')}
                            >
                              Mark delivered
                            </Button>
                          )}
                          {canCancel && order.status === 'CONFIRMED' && (
                            <Button
                              variant="danger"
                              disabled={busyId === order.id}
                              onClick={() => void cancel(order)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No orders match these filters"
                  detail="Try another date, location or status."
                />
              )}
              {!canUpdate && (
                <p className="field-hint">
                  Your account can view orders but does not have the{' '}
                  <code>orders:manage_status</code> permission.
                </p>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Empty
          title="Order data unavailable"
          detail="The API did not return an order summary. Check the error above and refresh after the backend/database is available."
        />
      )}
    </>
  );
}

export function StaffReports({ token, user }: { token: string; user: User }) {
  const [date, setDate] = useState(todayInDhaka());
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [budgetRows, setBudgetRows] = useState<BudgetReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'daily' | 'budget'>('daily');
  const canViewBudget = hasPermission(user.role, user.permissions, 'budgets:view');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDaily(null);
    Promise.all([
      api<BudgetPeriod[]>('/teacher/budget-periods', { token }),
      api<DailyReport>(`/staff/reports/daily?date=${date}`, { token }),
    ])
      .then(([periodList, report]) => {
        if (cancelled) return;
        setPeriods(periodList);
        const active = periodList.find((p) => p.isActive) ?? periodList[0];
        if (active) setPeriodId(String(active.id));
        setDaily(report);
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, date]);
  useEffect(() => {
    if (!periodId || !canViewBudget) {
      setBudgetRows([]);
      return;
    }
    let cancelled = false;
    setBudgetRows([]);
    api<BudgetReportRow[]>(`/staff/reports/budget?period=${periodId}`, { token })
      .then((rows) => {
        if (!cancelled) setBudgetRows(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, periodId, canViewBudget]);

  return (
    <>
      <PageHeader
        eyebrow="REPORTS"
        title="Reports & reconciliation"
        description="Daily totals and teacher budget summaries are calculated by the API from database records."
      />
      {error && <Alert>{error}</Alert>}
      <div className="tab-switch">
        <button className={tab === 'daily' ? 'active' : ''} onClick={() => setTab('daily')}>
          Daily report
        </button>
        <button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>
          Budget report
        </button>
      </div>
      {tab === 'daily' ? (
        <>
          <Card className="filter-card">
            <Field label="Business date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </Card>
          {loading ? (
            <Loading />
          ) : (
            daily && (
              <>
                <div className="stat-grid">
                  <StatCard
                    label="Daily total"
                    value={daily.dailyTotal.amountFormatted}
                    detail={daily.date}
                    tone="green"
                    symbol="৳"
                  />
                  <StatCard
                    label="Food locations"
                    value={String(daily.locations.length)}
                    detail="Locations with orders"
                    tone="violet"
                    symbol="⌂"
                  />
                  <StatCard
                    label="Non-cancelled orders"
                    value={String(daily.locations.reduce((n, l) => n + l.orderCount, 0))}
                    detail="Aggregated from the order table"
                    tone="blue"
                    symbol="≡"
                  />
                </div>
                <Card>
                  <div className="card-heading">
                    <div>
                      <h2>Daily totals by location</h2>
                      <p>Cancelled orders are excluded by the backend report query.</p>
                    </div>
                    <Button variant="secondary" onClick={() => window.print()}>
                      Print report
                    </Button>
                  </div>
                  {daily.locations.length ? (
                    <TableWrap>
                      <thead>
                        <tr>
                          <th>Food location</th>
                          <th>Orders</th>
                          <th className="align-right">Total value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daily.locations.map((row) => (
                          <tr key={row.location.id}>
                            <td>
                              <strong>{row.location.name}</strong>
                            </td>
                            <td>{row.orderCount}</td>
                            <td className="align-right">{row.total.amountFormatted}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th>Daily total</th>
                          <th>{daily.locations.reduce((n, l) => n + l.orderCount, 0)}</th>
                          <th className="align-right">{daily.dailyTotal.amountFormatted}</th>
                        </tr>
                      </tfoot>
                    </TableWrap>
                  ) : (
                    <Empty title="No transactions for this date" />
                  )}
                </Card>
              </>
            )
          )}
        </>
      ) : (
        <>
          {!canViewBudget ? (
            <Alert tone="info">
              Your account needs the <code>budgets:view</code> permission to view budget reports.
            </Alert>
          ) : (
            <>
              <Card className="filter-card">
                <Field label="Budget period">
                  <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                    <option value="">Select period</option>
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.name} · {period.startsOn} – {period.endsOn}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Card>
              <Card>
                <div className="card-heading">
                  <div>
                    <h2>Teacher balances</h2>
                    <p>Allocation, spending, refunds and adjustments by teacher.</p>
                  </div>
                  <span className="record-count">{budgetRows.length} teachers</span>
                </div>
                {!periodId ? (
                  <Empty title="No budget period selected" />
                ) : budgetRows.length ? (
                  <TableWrap>
                    <thead>
                      <tr>
                        <th>Teacher</th>
                        <th>Allocated</th>
                        <th>Spent</th>
                        <th>Refunded</th>
                        <th>Adjusted</th>
                        <th className="align-right">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetRows.map((row) => (
                        <tr key={row.teacher.id}>
                          <td>
                            <strong>{row.teacher.fullName}</strong>
                            <small className="table-subtitle">ID {row.teacher.id}</small>
                          </td>
                          <td>{row.allocated.amountFormatted}</td>
                          <td>{row.spent.amountFormatted}</td>
                          <td>{row.refunded.amountFormatted}</td>
                          <td>{row.adjusted.amountFormatted}</td>
                          <td className="align-right">
                            <strong>{row.available.amountFormatted}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                ) : (
                  <Empty
                    title="No ledger activity for this period"
                    detail="Teacher balances appear here after allocations or transactions are recorded."
                  />
                )}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
