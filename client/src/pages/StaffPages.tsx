import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  apiPage,
  ApiError,
  asMessage,
  currentDhakaMonth,
  formatDhakaDate,
  hasPermission,
  money,
} from '../api';
import { useBusinessDate, useDebounced } from '../hooks';
import type {
  AllocationHistory,
  BulkCollectResult,
  DailyReport,
  GroupedOrders,
  Location,
  Money,
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
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusPill,
  TableWrap,
  Textarea,
} from '../ui';

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 45_000;
const MIN_REFRESH_GAP_MS = 5_000;
/** Largest actual cost accepted for one order; anything above is almost certainly a typo. */
const MAX_ACTUAL_TAKA = 10_000;
const AMOUNT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

type SheetScope = 'toCollect' | 'all';

interface DeliveryConfirmation {
  order: StaffOrder;
  actualPaisa: number;
  alternativeName: string;
}

interface BulkTarget {
  locationId: number;
  name: string;
  count: number;
}

/** Parses "150" or "150.50" into paisa. Anything else (letters, 3 decimals, negatives) is rejected. */
function parseTakaToPaisa(text: string): number | null {
  const trimmed = text.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

function describeSettlement(estimatePaisa: number, actualPaisa: number): string {
  const difference = actualPaisa - estimatePaisa;
  if (difference === 0) return 'The actual cost matches the estimate, so no adjustment is needed.';
  if (difference > 0) return `The teacher will be charged an extra ${money(difference)}.`;
  return `The teacher will be refunded ${money(-difference)}.`;
}

function asMoney(amountPaisa: number): Money {
  return { amountPaisa, amountFormatted: money(amountPaisa) };
}

export function StaffOperations({ token, user }: { token: string; user: User }) {
  const [date, setDate, today] = useBusinessDate();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [scope, setScope] = useState<SheetScope>('toCollect');
  const [expandedLocations, setExpandedLocations] = useState<Set<number>>(() => new Set());

  const [locations, setLocations] = useState<Location[]>([]);
  const [grouped, setGrouped] = useState<GroupedOrders | null>(null);
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deliveringId, setDeliveringId] = useState<number | null>(null);
  const [deliverForm, setDeliverForm] = useState({ actualTaka: '', alternativeName: '' });
  const [deliveryConfirm, setDeliveryConfirm] = useState<DeliveryConfirmation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<StaffOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [bulkTarget, setBulkTarget] = useState<BulkTarget | null>(null);

  // Request bookkeeping: a newer request makes older responses irrelevant.
  const pagesLoaded = useRef(1);
  const summarySeq = useRef(0);
  const ordersSeq = useRef(0);
  const lastRefresh = useRef(0);
  const actionInFlight = useRef(false);

  const canUpdate = hasPermission(user.role, user.permissions, 'orders:manage_status');
  const canCancel = hasPermission(user.role, user.permissions, 'orders:cancel');

  const locationQuery =
    locationFilter === 'ALL' ? '' : `&locationId=${encodeURIComponent(locationFilter)}`;
  // Date and location narrow everything on the page; status and search only the queue.
  const summaryQuery = `date=${encodeURIComponent(date)}${locationQuery}`;
  const ordersQuery =
    summaryQuery +
    (statusFilter === 'ALL' ? '' : `&status=${encodeURIComponent(statusFilter)}`) +
    (debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '');

  const loadSummary = useCallback(async () => {
    const seq = ++summarySeq.current;
    try {
      const [groupData, dailyData] = await Promise.all([
        api<GroupedOrders>(`/staff/orders/grouped?${summaryQuery}`, { token }),
        api<DailyReport>(`/staff/reports/daily?${summaryQuery}`, { token }),
      ]);
      if (seq !== summarySeq.current) return;
      setGrouped(groupData);
      setDaily(dailyData);
    } catch (e) {
      if (seq === summarySeq.current) setError(asMessage(e));
    } finally {
      if (seq === summarySeq.current) setSummaryLoading(false);
    }
  }, [token, summaryQuery]);

  /** Loads the first `pages` pages of the queue (more than one when refreshing a longer list). */
  const loadOrders = useCallback(
    async (pages: number) => {
      const seq = ++ordersSeq.current;
      try {
        let collected: StaffOrder[] = [];
        let total = 0;
        for (let page = 1; page <= pages; page += 1) {
          const result = await apiPage<StaffOrder[]>(
            `/staff/orders?${ordersQuery}&page=${page}&pageSize=${PAGE_SIZE}`,
            { token },
          );
          if (seq !== ordersSeq.current) return;
          collected = collected.concat(result.data);
          total = result.meta.total;
          if (collected.length >= total) break;
        }
        pagesLoaded.current = Math.max(1, Math.ceil(collected.length / PAGE_SIZE));
        setOrders(collected);
        setTotalOrders(total);
      } catch (e) {
        if (seq === ordersSeq.current) setError(asMessage(e));
      } finally {
        if (seq === ordersSeq.current) setOrdersLoading(false);
      }
    },
    [token, ordersQuery],
  );

  // Changing the date or location reloads the summaries; they show a spinner, the rest stays put.
  useEffect(() => {
    setSummaryLoading(true);
    setGrouped(null);
    setDaily(null);
    void loadSummary();
  }, [loadSummary]);

  // Changing any queue filter starts the queue again from the first page.
  useEffect(() => {
    pagesLoaded.current = 1;
    setOrdersLoading(true);
    setOrders([]);
    setTotalOrders(0);
    void loadOrders(1);
  }, [loadOrders]);

  // The location list never changes with the filters, so it is fetched once.
  useEffect(() => {
    let cancelled = false;
    api<Location[]>('/locations', { token })
      .then((data) => {
        if (!cancelled) setLocations(data);
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Re-fetches everything without blanking the page. */
  const refreshAll = useCallback(() => {
    lastRefresh.current = Date.now();
    void loadSummary();
    void loadOrders(pagesLoaded.current);
  }, [loadSummary, loadOrders]);

  // Keep several staff in sync: refresh periodically and whenever the tab regains focus.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' || actionInFlight.current) return;
      if (Date.now() - lastRefresh.current < MIN_REFRESH_GAP_MS) return;
      refreshAll();
    };
    const timer = window.setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [refreshAll]);

  /** Collection sheet data for the chosen scope, derived from the per-order grouping. */
  const sheetGroups = useMemo(() => {
    if (!grouped) return [];
    return grouped.locations
      .map((group) => {
        const orderList = group.orders.filter(
          (order) => scope === 'all' || order.status === 'CONFIRMED',
        );
        const quantities = new Map<string, number>();
        for (const order of orderList) {
          for (const item of order.items) {
            quantities.set(item.name, (quantities.get(item.name) ?? 0) + item.quantity);
          }
        }
        return {
          location: group.location,
          orders: orderList,
          teacherCount: new Set(orderList.map((order) => order.teacherId)).size,
          totalPaisa: orderList.reduce((sum, order) => sum + order.total.amountPaisa, 0),
          itemSummary: [...quantities].map(([name, quantity]) => ({ name, quantity })),
          confirmedCount: group.orders.filter((order) => order.status === 'CONFIRMED').length,
        };
      })
      .filter((group) => group.orders.length > 0);
  }, [grouped, scope]);

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

  function toggleExpanded(locationId: number) {
    setExpandedLocations((current) => {
      const next = new Set(current);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  }

  /** Someone else got there first: say so plainly and show the current state. */
  function handleActionError(e: unknown) {
    if (e instanceof ApiError && e.code === 'INVALID_STATUS_TRANSITION') {
      setError(
        'This order was already updated by someone else, so it could not be changed. The list has been refreshed.',
      );
      setDeliveringId(null);
      setDeliveryConfirm(null);
      setCancelTarget(null);
      refreshAll();
      return;
    }
    setError(asMessage(e));
  }

  /** Updates one order in the list immediately; the follow-up refresh confirms it. */
  function applyLocalChange(orderId: number, status: OrderStatus, patch: Partial<StaffOrder> = {}) {
    const stays = statusFilter === 'ALL' ? status !== 'CANCELLED' : statusFilter === status;
    setOrders((list) =>
      stays
        ? list.map((order) => (order.id === orderId ? { ...order, ...patch, status } : order))
        : list.filter((order) => order.id !== orderId),
    );
    if (!stays) setTotalOrders((total) => Math.max(0, total - 1));
  }

  /** Sends one status change. Returns true when the server accepted it. */
  async function sendStatus(order: StaffOrder, body: Record<string, unknown>): Promise<boolean> {
    actionInFlight.current = true;
    setBusyId(order.id);
    setError('');
    setSuccess('');
    try {
      await api(`/staff/orders/${order.id}/status`, { token, method: 'PATCH', body });
      return true;
    } catch (e) {
      handleActionError(e);
      return false;
    } finally {
      actionInFlight.current = false;
      setBusyId(null);
    }
  }

  async function markCollected(order: StaffOrder) {
    const ok = await sendStatus(order, { status: 'COLLECTED', note: 'Collected by staff' });
    if (!ok) return;
    setSuccess(`Order #${order.id} marked collected.`);
    applyLocalChange(order.id, 'COLLECTED');
    refreshAll();
  }

  function startDelivery(order: StaffOrder) {
    setDeliveringId(order.id);
    setError('');
    setDeliverForm({
      // Default to the estimate the teacher was charged at placement.
      actualTaka: (order.estimatedTotal.amountPaisa / 100).toFixed(2),
      alternativeName: order.alternativeItemName ?? '',
    });
  }

  /** Validates the form; asks for confirmation whenever money will move. */
  function requestDelivery(order: StaffOrder) {
    const actualPaisa = parseTakaToPaisa(deliverForm.actualTaka);
    if (actualPaisa === null) {
      setError('Enter the actual cost as an amount such as 150 or 150.50.');
      return;
    }
    if (actualPaisa > MAX_ACTUAL_TAKA * 100) {
      setError(`The actual cost cannot be more than ${money(MAX_ACTUAL_TAKA * 100)} for one order.`);
      return;
    }
    setError('');
    const alternativeName = deliverForm.alternativeName.trim();
    if (actualPaisa === order.estimatedTotal.amountPaisa) {
      void deliver({ order, actualPaisa, alternativeName });
      return;
    }
    setDeliveryConfirm({ order, actualPaisa, alternativeName });
  }

  async function deliver(confirmation: DeliveryConfirmation) {
    const { order, actualPaisa, alternativeName } = confirmation;
    const ok = await sendStatus(order, {
      status: 'DELIVERED',
      note: 'Delivered to teacher',
      actualCostPaisa: actualPaisa,
      ...(alternativeName ? { alternativeItemName: alternativeName } : {}),
    });
    if (!ok) return;
    setDeliveringId(null);
    setDeliveryConfirm(null);
    setSuccess(`Order #${order.id} delivered at ${money(actualPaisa)}.`);
    applyLocalChange(order.id, 'DELIVERED', {
      actualCost: asMoney(actualPaisa),
      total: asMoney(actualPaisa),
      ...(alternativeName ? { alternativeItemName: alternativeName } : {}),
    });
    refreshAll();
  }

  function openCancel(order: StaffOrder) {
    setCancelTarget(order);
    setCancelReason('');
    setCancelError('');
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelError('A reason is required for staff cancellation.');
      return;
    }
    const order = cancelTarget;
    const ok = await sendStatus(order, { status: 'CANCELLED', note: reason });
    if (!ok) return;
    setCancelTarget(null);
    setSuccess(`Order #${order.id} cancelled and the teacher's budget refunded.`);
    applyLocalChange(order.id, 'CANCELLED');
    refreshAll();
  }

  async function confirmBulkCollect(target: BulkTarget) {
    actionInFlight.current = true;
    setBulkBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api<BulkCollectResult>('/staff/orders/bulk-collect', {
        token,
        method: 'POST',
        body: { date, locationId: target.locationId },
      });
      setBulkTarget(null);
      setSuccess(
        `${result.collected} order${result.collected === 1 ? '' : 's'} at ${target.name} marked collected.`,
      );
      if (result.failed.length) {
        setError(
          `${result.failed.length} order${result.failed.length === 1 ? '' : 's'} could not be updated (${result.failed
            .map((id) => `#${id}`)
            .join(', ')}); someone else may have changed them. The list has been refreshed.`,
        );
      }
      refreshAll();
    } catch (e) {
      setBulkTarget(null);
      handleActionError(e);
    } finally {
      actionInFlight.current = false;
      setBulkBusy(false);
    }
  }

  async function loadMore() {
    const seq = ordersSeq.current;
    setLoadingMore(true);
    try {
      const nextPage = pagesLoaded.current + 1;
      const result = await apiPage<StaffOrder[]>(
        `/staff/orders?${ordersQuery}&page=${nextPage}&pageSize=${PAGE_SIZE}`,
        { token },
      );
      if (seq !== ordersSeq.current) return;
      pagesLoaded.current = nextPage;
      setOrders((list) => {
        const seen = new Set(list.map((order) => order.id));
        return [...list, ...result.data.filter((order) => !seen.has(order.id))];
      });
      setTotalOrders(result.meta.total);
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const isToday = date === today;
  const sheetScopeLabel = scope === 'toCollect' ? 'Orders still to collect' : 'All non-cancelled orders';

  return (
    <>
      <PageHeader
        eyebrow="STAFF OPERATIONS"
        title="Daily operations"
        description="Orders in, in process, delivered and cancelled for the selected date, plus the collection sheets and the order queue to run the day."
        action={
          <Button
            variant="secondary"
            disabled={summaryLoading || ordersLoading}
            onClick={() => refreshAll()}
          >
            ↻ Refresh
          </Button>
        }
      />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      <Card className="filter-card">
        <div className="filter-grid">
          <Field label="Business date" hint={`${formatDhakaDate(date)} (dd/mm/yyyy)`}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Food location" hint="Applies to the numbers, collection sheets and queue.">
            <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="ALL">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order status" hint="Filters the order queue.">
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

      {summaryLoading ? (
        <Loading />
      ) : daily ? (
        <div className="stat-grid stat-grid-three">
          <StatCard
            label={isToday ? 'Orders today' : 'Orders'}
            value={String(daily.statusSummary.total)}
            detail={`For ${formatDhakaDate(daily.date)}`}
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
            detail="Refunded to teachers' budgets"
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
        </div>
      ) : null}

      <div className="content-grid operations-grid">
        <Card>
          <div className="card-heading">
            <div>
              <h2>Location collection summaries</h2>
              <p>Item quantities and per-teacher lists, from persisted orders.</p>
            </div>
            <div className="card-heading-actions">
              <Select
                aria-label="Which orders the collection sheets include"
                value={scope}
                onChange={(e) => setScope(e.target.value as SheetScope)}
              >
                <option value="toCollect">Still to collect</option>
                <option value="all">All non-cancelled</option>
              </Select>
            </div>
          </div>
          {summaryLoading ? (
            <Loading />
          ) : sheetGroups.length ? (
            <div className="location-summaries">
              {sheetGroups.map((group) => {
                const open = expandedLocations.has(group.location.id);
                return (
                  <div
                    className="location-summary"
                    data-print-location={group.location.id}
                    key={group.location.id}
                  >
                    <div className="sheet-heading">
                      <strong>Collection sheet — {group.location.name}</strong>
                      <span>
                        {formatDhakaDate(date)} · {sheetScopeLabel}
                      </span>
                    </div>
                    <div className="location-summary-top">
                      <div>
                        <span className="location-dot">{group.location.name.slice(0, 1)}</span>
                        <strong>{group.location.name}</strong>
                      </div>
                      <strong>{money(group.totalPaisa)}</strong>
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
                    <div className={`sheet-orders ${open ? 'is-open' : ''}`}>
                      {group.orders.map((order) => (
                        <div className="sheet-order-row" key={order.id}>
                          <div>
                            <strong>{order.teacherName}</strong>
                            <small>
                              {order.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}
                              {order.alternativeItemName
                                ? ` · Alternative: ${order.alternativeItemName}`
                                : ''}
                            </small>
                          </div>
                          <div>
                            <StatusPill status={order.status} />
                            <span>{order.total.amountFormatted}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="location-summary-actions">
                      <Button
                        variant="secondary"
                        onClick={() => printLocationSheet(group.location.id)}
                      >
                        Print collection sheet
                      </Button>
                      <Button
                        variant="ghost"
                        aria-expanded={open}
                        onClick={() => toggleExpanded(group.location.id)}
                      >
                        {open ? 'Hide' : 'Show'} per-teacher list
                      </Button>
                      {canUpdate && group.confirmedCount > 0 && (
                        <Button
                          disabled={bulkBusy}
                          onClick={() =>
                            setBulkTarget({
                              locationId: group.location.id,
                              name: group.location.name,
                              count: group.confirmedCount,
                            })
                          }
                        >
                          Mark all collected ({group.confirmedCount})
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : grouped?.locations.length ? (
            <Empty
              title="Nothing left to collect"
              detail="Every order for this date has been collected or delivered. Switch to “All non-cancelled” to see the full sheet."
            />
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
            <span className="record-count">
              {orders.length} of {totalOrders} shown
            </span>
          </div>
          <div className="queue-tools">
            <Input
              type="search"
              aria-label="Search orders by teacher name"
              placeholder="Search by teacher name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {ordersLoading ? (
            <Loading />
          ) : orders.length ? (
            <>
              <div className="queue-list">
                {orders.map((order) => (
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
                        <Field
                          label="Actual delivered cost (৳)"
                          hint={`Estimate was ${order.estimatedTotal.amountFormatted}. Any difference is settled with the teacher's budget.`}
                        >
                          <Input
                            inputMode="decimal"
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
                          <Button
                            disabled={busyId === order.id}
                            onClick={() => requestDelivery(order)}
                          >
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
                              onClick={() => void markCollected(order)}
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
                              onClick={() => openCancel(order)}
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
              {orders.length < totalOrders && (
                <div className="load-more">
                  <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore
                      ? 'Loading…'
                      : `Load more (${totalOrders - orders.length} remaining)`}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Empty
              title="No orders match these filters"
              detail="Try another date, location, status or teacher name."
            />
          )}
          {!canUpdate && (
            <p className="field-hint">
              Your account can view orders but does not have the <code>orders:manage_status</code>{' '}
              permission.
            </p>
          )}
        </Card>
      </div>

      {deliveryConfirm && (
        <Modal
          title="Confirm delivery cost"
          onClose={() => setDeliveryConfirm(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDeliveryConfirm(null)}>
                Go back
              </Button>
              <Button
                disabled={busyId === deliveryConfirm.order.id}
                onClick={() => void deliver(deliveryConfirm)}
              >
                {busyId === deliveryConfirm.order.id ? 'Saving…' : 'Confirm delivery'}
              </Button>
            </>
          }
        >
          <p>
            Order #{deliveryConfirm.order.id} for {deliveryConfirm.order.teacher.fullName}.
            Estimated {deliveryConfirm.order.estimatedTotal.amountFormatted}, actual{' '}
            <strong>{money(deliveryConfirm.actualPaisa)}</strong>.
          </p>
          <p>
            {describeSettlement(
              deliveryConfirm.order.estimatedTotal.amountPaisa,
              deliveryConfirm.actualPaisa,
            )}
          </p>
          {deliveryConfirm.actualPaisa === 0 && (
            <p>
              <strong>The actual cost is ৳0.00</strong>, so the whole estimate goes back to the
              teacher. Check this is right.
            </p>
          )}
          <p>A delivery cannot be changed from this screen once it is saved.</p>
        </Modal>
      )}

      {cancelTarget && (
        <Modal
          title={`Cancel order #${cancelTarget.id}?`}
          onClose={() => setCancelTarget(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setCancelTarget(null)}>
                Keep order
              </Button>
              <Button
                variant="danger"
                disabled={busyId === cancelTarget.id}
                onClick={() => void confirmCancel()}
              >
                {busyId === cancelTarget.id ? 'Cancelling…' : 'Cancel order'}
              </Button>
            </>
          }
        >
          <p>
            {cancelTarget.teacher.fullName}'s order of {cancelTarget.total.amountFormatted} will be
            cancelled and the amount refunded to their budget.
          </p>
          {cancelError && <Alert>{cancelError}</Alert>}
          <Field label="Reason (required)">
            <Textarea
              autoFocus
              rows={3}
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                setCancelError('');
              }}
            />
          </Field>
        </Modal>
      )}

      {bulkTarget && (
        <Modal
          title={`Mark ${bulkTarget.count} order${bulkTarget.count === 1 ? '' : 's'} collected?`}
          onClose={() => setBulkTarget(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setBulkTarget(null)}>
                Go back
              </Button>
              <Button disabled={bulkBusy} onClick={() => void confirmBulkCollect(bulkTarget)}>
                {bulkBusy ? 'Saving…' : 'Mark all collected'}
              </Button>
            </>
          }
        >
          <p>
            Every confirmed order at {bulkTarget.name} for {formatDhakaDate(date)} will be marked
            collected. Orders already collected, delivered or cancelled are left alone.
          </p>
        </Modal>
      )}
    </>
  );
}

export function StaffReports({ token, user }: { token: string; user: User }) {
  const [date, setDate] = useBusinessDate();
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
