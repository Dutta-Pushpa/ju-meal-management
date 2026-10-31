import { useEffect, useMemo, useState } from 'react';
import { api, asMessage, currentDhakaMonth, hasPermission, money, todayInDhaka } from '../api';
import type {
  AllocationHistory,
  DailyReport,
  GroupedOrders,
  Location,
  MonthlyReportMonth,
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
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deliveringId, setDeliveringId] = useState<number | null>(null);
  const [deliverForm, setDeliverForm] = useState({ actualTaka: '', alternativeName: '' });
  const canUpdate = hasPermission(user.role, user.permissions, 'orders:manage_status');
  const canCancel = hasPermission(user.role, user.permissions, 'orders:cancel');

  async function load() {
    setLoading(true);
    setError('');
    setGrouped(null);
    setDaily(null);
    setOrders([]);
    setLocations([]);
    try {
      const [groupData, orderData, locationData, dailyData] = await Promise.all([
        api<GroupedOrders>(`/staff/orders/grouped?date=${encodeURIComponent(date)}`, { token }),
        api<StaffOrder[]>(
          `/staff/orders?date=${encodeURIComponent(date)}&pageSize=100${statusFilter !== 'ALL' ? `&status=${encodeURIComponent(statusFilter)}` : ''}`,
          { token },
        ),
        api<Location[]>('/locations', { token }),
        // The daily report drives the overview numbers on this page.
        api<DailyReport>(`/staff/reports/daily?date=${encodeURIComponent(date)}`, { token }),
      ]);
      setGrouped(groupData);
      setOrders(orderData);
      setLocations(locationData);
      setDaily(dailyData);
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

  async function changeStatus(
    order: StaffOrder,
    status: OrderStatus,
    reconciliation?: { actualCostPaisa?: number; alternativeItemName?: string },
  ) {
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
          ...(status === 'DELIVERED' && reconciliation?.actualCostPaisa !== undefined
            ? { actualCostPaisa: reconciliation.actualCostPaisa }
            : {}),
          ...(status === 'DELIVERED' && reconciliation?.alternativeItemName
            ? { alternativeItemName: reconciliation.alternativeItemName }
            : {}),
        },
      });
      setSuccess(`Order #${order.id} updated to ${status.toLowerCase()}.`);
      setDeliveringId(null);
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  function startDelivery(order: StaffOrder) {
    setDeliveringId(order.id);
    setDeliverForm({
      // Default to the estimate the teacher was charged at placement.
      actualTaka: (order.estimatedTotal.amountPaisa / 100).toFixed(2),
      alternativeName: order.alternativeItemName ?? '',
    });
  }

  async function confirmDelivery(order: StaffOrder) {
    const taka = Number.parseFloat(deliverForm.actualTaka);
    if (!Number.isFinite(taka) || taka < 0) {
      setError('Enter the actual delivered cost in taka (0 or more).');
      return;
    }
    await changeStatus(order, 'DELIVERED', {
      actualCostPaisa: Math.round(taka * 100),
      alternativeItemName: deliverForm.alternativeName.trim() || undefined,
    });
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
        title="Daily operations"
        description="Today's overview at a glance — orders in, in process, delivered and cancelled — plus the collection summaries and order queue to run the day."
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
            {daily ? (
              <>
                <StatCard
                  label="Orders today"
                  value={String(daily.statusSummary.total)}
                  detail={`For ${daily.date}`}
                  tone="violet"
                  symbol="≡"
                />
                <StatCard
                  label="Pending"
                  value={String(daily.statusSummary.pending)}
                  detail="Confirmed, awaiting collection"
                  tone="orange"
                  symbol="◔"
                />
                <StatCard
                  label="In process"
                  value={String(daily.statusSummary.processing)}
                  detail="Collected, awaiting delivery"
                  tone="blue"
                  symbol="▦"
                />
                <StatCard
                  label="Delivered"
                  value={String(daily.statusSummary.delivered)}
                  detail={`Spending ${daily.statusSummary.spendingOnDelivered.amountFormatted}`}
                  tone="green"
                  symbol="✓"
                />
                <StatCard
                  label="Cancelled"
                  value={String(daily.statusSummary.cancelled)}
                  detail={`${daily.statusSummary.total} orders in total`}
                  tone="orange"
                  symbol="✕"
                />
                <StatCard
                  label="Daily transactions"
                  value={daily.dailyTotal.amountFormatted}
                  detail="Total value excluding cancellations"
                  tone="green"
                  symbol="৳"
                />
              </>
            ) : grouped ? (
              <>
                <StatCard
                  label="Active orders"
                  value={String(grouped.orderCount)}
                  detail={`Non-cancelled orders for ${date}`}
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
              </>
            ) : null}
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
                      {order.alternativeItemName && (
                        <div className="queue-items">
                          <span className="table-subtitle">
                            Teacher's alternative: {order.alternativeItemName}
                            {order.alternativeUnitPrice
                              ? ` (${order.alternativeUnitPrice.amountFormatted})`
                              : ''}
                          </span>
                        </div>
                      )}
                      {order.actualCost &&
                        order.actualCost.amountPaisa !== order.estimatedTotal.amountPaisa && (
                          <div className="queue-items">
                            <span className="table-subtitle">
                              Estimated {order.estimatedTotal.amountFormatted} · Actual{' '}
                              {order.actualCost.amountFormatted}
                            </span>
                          </div>
                        )}
                      {deliveringId === order.id ? (
                        <div className="delivery-form">
                          <Field label="Actual delivered cost (৳)" hint="Deducted from the teacher's budget; differences from the estimate are settled automatically.">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={deliverForm.actualTaka}
                              onChange={(e) =>
                                setDeliverForm({ ...deliverForm, actualTaka: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Alternative item delivered (optional)">
                            <Input
                              value={deliverForm.alternativeName}
                              onChange={(e) =>
                                setDeliverForm({ ...deliverForm, alternativeName: e.target.value })
                              }
                              placeholder="What was actually served"
                            />
                          </Field>
                          <div className="button-row">
                            <Button disabled={busyId === order.id} onClick={() => void confirmDelivery(order)}>
                              {busyId === order.id ? 'Saving…' : 'Confirm delivery'}
                            </Button>
                            <Button variant="ghost" onClick={() => setDeliveringId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
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
                                onClick={() => startDelivery(order)}
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
                      )}
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
  const [month, setMonth] = useState(currentDhakaMonth());
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportMonth[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [history, setHistory] = useState<AllocationHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'daily' | 'monthly' | 'budget'>('daily');
  const canViewBudget = hasPermission(user.role, user.permissions, 'budgets:view');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDaily(null);
    api<DailyReport>(`/staff/reports/daily?date=${date}`, { token })
      .then((report) => {
        if (!cancelled) setDaily(report);
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
    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber || !canViewBudget) {
      setMonthlyReport([]);
      setHistory(null);
      return;
    }
    let cancelled = false;
    if (tab === 'monthly') {
      // The API answers with `{ data: { months: [...] } }`; the per-teacher
      // rows for every month of the window are inside.
      setMonthlyLoading(true);
      api<{ months: MonthlyReportMonth[] }>(
        `/staff/reports/monthly?year=${year}&month=${monthNumber}`,
        { token },
      )
        .then((report) => {
          if (!cancelled) setMonthlyReport(report.months ?? []);
        })
        .catch((e) => {
          if (!cancelled) setError(asMessage(e));
        })
        .finally(() => {
          if (!cancelled) setMonthlyLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (tab === 'budget') {
      // Allocation history for the six months ending at the anchor month.
      setHistoryLoading(true);
      setHistory(null);
      api<AllocationHistory>(`/staff/budgets/history?year=${year}&month=${monthNumber}`, {
        token,
      })
        .then((data) => {
          if (!cancelled) setHistory(data);
        })
        .catch((e) => {
          if (!cancelled) setError(asMessage(e));
        })
        .finally(() => {
          if (!cancelled) setHistoryLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [token, month, canViewBudget, tab]);

  return (
    <>
      <PageHeader
        eyebrow="REPORTS"
        title="Reports & reconciliation"
        description="Daily totals, monthly teacher summaries and the six-month allocation history are calculated by the API from database records."
      />
      {error && <Alert>{error}</Alert>}
      <div className="tab-switch">
        <button className={tab === 'daily' ? 'active' : ''} onClick={() => setTab('daily')}>
          Daily report
        </button>
        <button className={tab === 'monthly' ? 'active' : ''} onClick={() => setTab('monthly')}>
          Monthly report
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
                    label="Locations active"
                    value={String(daily.locations.length)}
                    detail="With transactions this date"
                    tone="blue"
                    symbol="⌂"
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
      ) : tab === 'monthly' ? (
        <>
          {!canViewBudget ? (
            <Alert tone="info">
              Your account needs the <code>budgets:view</code> permission to view monthly reports.
            </Alert>
          ) : (
            <>
              <Card className="filter-card">
                <Field label="Report month (six months ending here)">
                  <Input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </Field>
              </Card>
              {monthlyLoading ? (
                <Loading />
              ) : monthlyReport.length ? (
                monthlyReport.map((m) => (
                  <Card key={`${m.year}-${m.month}`}>
                    <div className="card-heading">
                      <div>
                        <h2>{m.label} — teacher report</h2>
                        <p>
                          Order counts by status and budget state for every teacher. Carry-forward
                          and remaining include activity from all previous months.
                        </p>
                      </div>
                    </div>
                    {m.teachers.length ? (
                      <TableWrap>
                        <thead>
                          <tr>
                            <th>Teacher</th>
                            <th>Orders</th>
                            <th>Pending</th>
                            <th>Processing</th>
                            <th>Delivered</th>
                            <th>Cancelled</th>
                            <th className="align-right">Delivered spending</th>
                            <th className="align-right">Allocated</th>
                            <th className="align-right">Remaining</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.teachers.map((teacher) => (
                            <tr key={teacher.teacher.id}>
                              <td>
                                <strong>{teacher.teacher.fullName}</strong>
                                <small className="table-subtitle">ID {teacher.teacher.id}</small>
                              </td>
                              <td>{teacher.orders.total}</td>
                              <td>{teacher.orders.pending}</td>
                              <td>{teacher.orders.processing}</td>
                              <td>{teacher.orders.delivered}</td>
                              <td>{teacher.orders.cancelled}</td>
                              <td className="align-right">
                                {teacher.orders.deliveredSpending.amountFormatted}
                              </td>
                              <td className="align-right">{teacher.allocated.amountFormatted}</td>
                              <td className="align-right">
                                <strong
                                  className={
                                    teacher.remaining.amountPaisa < 0 ? 'amount-negative' : ''
                                  }
                                >
                                  {money(teacher.remaining.amountPaisa)}
                                </strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </TableWrap>
                    ) : (
                      <Empty
                        title="No teacher data for this month"
                        detail="Monthly allocations create rows here."
                      />
                    )}
                  </Card>
                ))
              ) : (
                <Empty
                  title="No monthly report data"
                  detail="Months appear here once teachers are in the reporting window."
                />
              )}
            </>
          )}
        </>
      ) : (
        <>
          {!canViewBudget ? (
            <Alert tone="info">
              Your account needs the <code>budgets:view</code> permission to view the allocation
              history.
            </Alert>
          ) : (
            <>
              <Card className="filter-card">
                <Field label="Six months ending in">
                  <Input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </Field>
              </Card>
              {historyLoading ? (
                <Loading />
              ) : history ? (
                <>
                  <div className="stat-grid">
                    <StatCard
                      label="Total allocated — last six months"
                      value={history.grandTotal.amountFormatted}
                      detail={`${history.months[0]?.label ?? ''} → ${history.months[history.months.length - 1]?.label ?? ''}`}
                      tone="violet"
                      symbol="৳"
                    />
                    <StatCard
                      label="Months with allocations"
                      value={`${history.months.filter((m) => m.totalAllocated.amountPaisa > 0).length} / ${history.months.length}`}
                      detail="In the selected window"
                      tone="green"
                      symbol="▤"
                    />
                    <StatCard
                      label="Average per month"
                      value={
                        history.months.length
                          ? money(Math.round(history.grandTotal.amountPaisa / history.months.length))
                          : '—'
                      }
                      detail="Across all six months"
                      tone="blue"
                      symbol="↘"
                    />
                  </div>
                  <Card>
                    <div className="card-heading">
                      <div>
                        <h2>Total allocated budget — {history.months[0]?.label ?? ''} to {history.months[history.months.length - 1]?.label ?? ''}</h2>
                        <p>
                          Effective monthly allocations (base allocation plus admin edits) across
                          the six months ending at the month you selected. Manage the current
                          month from the monthly budget planning section.
                        </p>
                      </div>
                    </div>
                    {history.months.length ? (
                      <TableWrap>
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th className="align-right">Total allocated</th>
                            <th className="align-right">Teachers allocated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.months.map((m) => (
                            <tr key={`${m.year}-${m.month}`}>
                              <td>
                                <strong>{m.label}</strong>
                              </td>
                              <td className="align-right">{m.totalAllocated.amountFormatted}</td>
                              <td className="align-right">
                                {m.teachers.filter((t) => t.allocated.amountPaisa > 0).length}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <th>Six-month total</th>
                            <th className="align-right">{history.grandTotal.amountFormatted}</th>
                            <th />
                          </tr>
                        </tfoot>
                      </TableWrap>
                    ) : (
                      <Empty title="No allocation data in this window" />
                    )}
                  </Card>
                </>
              ) : (
                <Empty
                  title="No allocation history found"
                  detail="The six-month totals appear here after budgets are allocated."
                />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
