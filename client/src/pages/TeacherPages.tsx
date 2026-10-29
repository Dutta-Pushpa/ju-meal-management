import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, asMessage, currentDhakaMonth, todayInDhaka } from '../api';
import type {
  BudgetRequest,
  BudgetSummary,
  LedgerEntry,
  Location,
  MenuItem,
  Order,
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
  Textarea,
} from '../ui';

/** Split 'YYYY-MM' (from a month input) into numeric year and month. */
function splitMonth(monthValue: string): { year: number; month: number } {
  const [year, month] = monthValue.split('-').map(Number);
  return { year: year ?? new Date().getFullYear(), month: month ?? new Date().getMonth() + 1 };
}

/** Balances below this (100 taka) trigger the low-balance warning. */
const LOW_BALANCE_PAISA = 10000;

export function TeacherOverview({
  token,
  user,
  onNavigate,
}: {
  token: string;
  user: User;
  onNavigate: (view: string) => void;
}) {
  const [budget, setBudget] = useState<BudgetSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        // The monthly summary defaults to the current Dhaka month on the API.
        const [orderData, budgetData] = await Promise.all([
          api<Order[]>('/orders/mine?pageSize=5', { token }),
          api<BudgetSummary>('/teacher/budget', { token }),
        ]);
        if (!cancelled) {
          setOrders(orderData);
          setBudget(budgetData);
        }
      } catch (e) {
        if (!cancelled) setError(asMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <>
      <PageHeader
        eyebrow="TEACHER PORTAL"
        title={`Good ${getGreeting()}, ${user.fullName.split(' ')[0]}`}
        description="Your monthly meals, budget and recent orders in one place."
        action={<Button onClick={() => onNavigate('meals')}>＋ Order a meal</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {!loading &&
        budget &&
        budget.available.amountPaisa >= 0 &&
        budget.available.amountPaisa < LOW_BALANCE_PAISA && (
          <Alert>
            ⚠ Low balance: you have {budget.available.amountFormatted} remaining for{' '}
            {budget.period.name}. Requests above this amount may be declined unless debt is
            allowed by policy.
          </Alert>
        )}
      {!loading && budget && budget.available.amountPaisa < 0 && (
        <Alert>
          ⚠ Outstanding debt: your balance is {budget.available.amountFormatted}. Further orders
          may be blocked by policy until the balance is restored.
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Available balance"
              value={budget?.available.amountFormatted ?? '—'}
              detail={budget ? `${budget.period.name} · remaining to spend` : 'No monthly budget yet'}
              tone={budget && budget.available.amountPaisa < 0 ? 'orange' : 'violet'}
              symbol="৳"
            />
            <StatCard
              label="Allocated this month"
              value={budget?.allocated.amountFormatted ?? '—'}
              detail="Monthly allocation (may include edits)"
              tone="blue"
              symbol="↗"
            />
            <StatCard
              label="Carried forward"
              value={budget?.carryForward.amountFormatted ?? '—'}
              detail="From previous months"
              tone={budget && budget.carryForward.amountPaisa < 0 ? 'orange' : 'blue'}
              symbol="↺"
            />
            <StatCard
              label="Spent this month"
              value={budget?.spent.amountFormatted ?? '—'}
              detail="Confirmed meal orders"
              tone="orange"
              symbol="↘"
            />
            <StatCard
              label="Recent orders"
              value={String(orders.length)}
              detail="Latest orders from your history"
              tone="green"
              symbol="≡"
            />
          </div>
          <div className="content-grid content-grid-home">
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Recent orders</h2>
                  <p>Your latest meal requests</p>
                </div>
                <Button variant="ghost" onClick={() => onNavigate('orders')}>
                  View all ↗
                </Button>
              </div>
              {orders.length ? (
                <div className="order-list">
                  {orders.slice(0, 5).map((order) => (
                    <div className="order-row" key={order.id}>
                      <div className="order-icon">🍽</div>
                      <div className="order-main">
                        <strong>{order.foodLocation.name}</strong>
                        <span>
                          Order #{order.id} · {order.orderDate}
                        </span>
                      </div>
                      <div className="order-side">
                        <strong>{order.total.amountFormatted}</strong>
                        <StatusPill status={order.status} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No orders yet" detail="Your meal orders will appear here." />
              )}
            </Card>
            <Card className="quick-card">
              <div className="card-heading">
                <div>
                  <h2>Quick actions</h2>
                  <p>Everything you need for today</p>
                </div>
              </div>
              <button className="quick-action" onClick={() => onNavigate('meals')}>
                <span className="quick-icon quick-icon-violet">＋</span>
                <span>
                  <strong>Browse today’s menu</strong>
                  <small>Choose meals from campus locations</small>
                </span>
                <b>→</b>
              </button>
              <button className="quick-action" onClick={() => onNavigate('budget')}>
                <span className="quick-icon quick-icon-green">৳</span>
                <span>
                  <strong>Check budget history</strong>
                  <small>Review spending, refunds and allocations</small>
                </span>
                <b>→</b>
              </button>
              <button className="quick-action" onClick={() => onNavigate('orders')}>
                <span className="quick-icon quick-icon-orange">≡</span>
                <span>
                  <strong>Manage my orders</strong>
                  <small>Track or cancel eligible orders</small>
                </span>
                <b>→</b>
              </button>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

export function TeacherMeals({
  token,
  onOrderPlaced,
}: {
  token: string;
  onOrderPlaced: () => void;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [alternativeName, setAlternativeName] = useState('');
  const [alternativePrice, setAlternativePrice] = useState('');
  const [budget, setBudget] = useState<BudgetSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<BudgetSummary>('/teacher/budget', { token })
      .then((data) => {
        if (!cancelled) setBudget(data);
      })
      .catch(() => {
        /* A missing budget should not block ordering; the API enforces limits. */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    api<Location[]>('/locations', { token })
      .then((data) => {
        if (cancelled) return;
        setLocations(data);
        if (data[0]) setLocationId(String(data[0].id));
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
  }, [token]);

  useEffect(() => {
    if (!locationId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setItems([]);
    setCart({});
    setNotes({});
    setError('');
    api<{ location: { id: number; name: string }; items: MenuItem[] }>(
      `/locations/${locationId}/menu`,
      { token },
    )
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, locationId]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) =>
        `${item.name} ${item.description ?? ''} ${item.category ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [items, search],
  );
  const cartItems = items.filter((item) => (cart[item.id] ?? 0) > 0);
  const totalPaisa = cartItems.reduce(
    (sum, item) => sum + item.price.amountPaisa * cart[item.id]!,
    0,
  );
  const setQuantity = (id: number, next: number) =>
    setCart((old) => ({ ...old, [id]: Math.min(100, Math.max(0, next)) }));

  async function submitOrder() {
    if (!locationId || !cartItems.length) return;
    const alternativeTaka = Number.parseFloat(alternativePrice);
    if (alternativeName.trim() && (!Number.isFinite(alternativeTaka) || alternativeTaka <= 0)) {
      setError('Enter a positive price for the alternative item, or leave it blank.');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ju-meal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const order = await api<Order>('/orders', {
        token,
        method: 'POST',
        body: {
          orderDate: todayInDhaka(),
          foodLocationId: Number(locationId),
          idempotencyKey,
          items: cartItems.map((item) => ({
            menuItemId: item.id,
            quantity: cart[item.id],
            notes: notes[item.id] || undefined,
          })),
          ...(alternativeName.trim() && Number.isFinite(alternativeTaka) && alternativeTaka > 0
            ? {
                alternativeItemName: alternativeName.trim(),
                alternativeUnitPricePaisa: Math.round(alternativeTaka * 100),
              }
            : {}),
        },
      });
      setSuccess(`Order #${order.id} confirmed. Total: ${order.total.amountFormatted}.`);
      setCart({});
      setNotes({});
      setAlternativeName('');
      setAlternativePrice('');
      onOrderPlaced();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="MEAL ORDERING"
        title="Order your meal"
        description="Browse live menus and prices from participating campus locations."
        action={<span className="date-chip">Today · {todayInDhaka()}</span>}
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {budget &&
        budget.available.amountPaisa >= 0 &&
        budget.available.amountPaisa < LOW_BALANCE_PAISA && (
          <Alert>
            ⚠ Low balance: only {budget.available.amountFormatted} remains for{' '}
            {budget.period.name}.
          </Alert>
        )}
      {budget && budget.available.amountPaisa < 0 && (
        <Alert>
          ⚠ Outstanding debt: your balance is {budget.available.amountFormatted}.
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : locations.length === 0 ? (
        <Empty
          title="No locations available"
          detail="There are currently no active campus food locations."
        />
      ) : (
        <div className="meal-layout">
          <div className="meal-main">
            <div className="location-tabs" role="tablist" aria-label="Food locations">
              {locations.map((location) => (
                <button
                  className={`location-tab ${String(location.id) === locationId ? 'active' : ''}`}
                  key={location.id}
                  onClick={() => setLocationId(String(location.id))}
                >
                  <span className="location-dot">{location.name.slice(0, 1)}</span>
                  <span>
                    <strong>{location.name}</strong>
                    <small>{location.nameBn || 'Campus food location'}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="menu-heading">
              <div>
                <h2>Available menu</h2>
                <p>
                  {locations.find((l) => String(l.id) === locationId)?.description ||
                    'Fresh choices from your selected location.'}
                </p>
              </div>
              <Input
                aria-label="Search menu"
                placeholder="Search menu…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {items.length === 0 ? (
              <Empty
                title="No available menu items"
                detail="This location has not published any available items."
              />
            ) : visibleItems.length === 0 ? (
              <Empty title="No matching dishes" detail="Try another search term." />
            ) : (
              <div className="menu-grid">
                {visibleItems.map((item) => (
                  <Card className="menu-card" key={item.id}>
                    <div className="food-art">
                      <span>{foodSymbol(item.category)}</span>
                      <em>{item.category || 'Campus favourite'}</em>
                    </div>
                    <div className="menu-card-body">
                      <div className="menu-item-title">
                        <h3>{item.name}</h3>
                        <strong>{item.price.amountFormatted}</strong>
                      </div>
                      <p>{item.description || 'Prepared fresh by the food location.'}</p>
                      <div className="menu-card-bottom">
                        <small>Price per serving</small>
                        <div className="quantity-stepper">
                          <button
                            aria-label={`Remove one ${item.name}`}
                            onClick={() => setQuantity(item.id, (cart[item.id] ?? 0) - 1)}
                            disabled={!cart[item.id]}
                          >
                            −
                          </button>
                          <span>{cart[item.id] ?? 0}</span>
                          <button
                            aria-label={`Add one ${item.name}`}
                            onClick={() => setQuantity(item.id, (cart[item.id] ?? 0) + 1)}
                            disabled={(cart[item.id] ?? 0) >= 100}
                          >
                            ＋
                          </button>
                        </div>
                      </div>
                      {(cart[item.id] ?? 0) > 0 && (
                        <Input
                          aria-label={`Notes for ${item.name}`}
                          placeholder="Notes for this item (optional)"
                          value={notes[item.id] ?? ''}
                          onChange={(e) =>
                            setNotes((old) => ({ ...old, [item.id]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <aside className="cart-panel">
            <div className="cart-title">
              <div>
                <h2>Your order</h2>
                <p>{cartItems.reduce((sum, item) => sum + cart[item.id]!, 0)} item(s) selected</p>
              </div>
              <span className="cart-glyph">⌑</span>
            </div>
            {cartItems.length ? (
              <div className="cart-lines">
                {cartItems.map((item) => (
                  <div className="cart-line" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.price.amountFormatted} × {cart[item.id]}
                      </small>
                    </div>
                    <strong>{`৳${((item.price.amountPaisa * cart[item.id]!) / 100).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`}</strong>
                    <button
                      className="remove-item"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => setQuantity(item.id, 0)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cart-empty">
                <span>＋</span>
                <strong>Your cart is empty</strong>
                <small>Select a dish and use + to add it here.</small>
              </div>
            )}
            <div className="cart-total">
              <span>Estimated total</span>
              <strong>{`৳${(totalPaisa / 100).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`}</strong>
            </div>
            <div className="alternative-fields">
              <Field label="Alternative item (optional)">
                <Input
                  value={alternativeName}
                  onChange={(e) => setAlternativeName(e.target.value)}
                  placeholder="If your first choice is unavailable"
                  aria-label="Alternative item name"
                />
              </Field>
              <Field label="Alternative price (৳)">
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={alternativePrice}
                  onChange={(e) => setAlternativePrice(e.target.value)}
                  placeholder="e.g. 80"
                  aria-label="Alternative item price in taka"
                />
              </Field>
            </div>
            <p className="cart-note">
              Final prices and available balance are verified by the server at checkout. Ordering
              cutoff rules are enforced by the API. The actual cost is settled at delivery.
            </p>
            <Button
              block
              disabled={!cartItems.length || submitting}
              onClick={() => void submitOrder()}
            >
              {submitting
                ? 'Submitting order…'
                : 'Confirm order · ' + `৳${(totalPaisa / 100).toFixed(2)}`}
            </Button>
          </aside>
        </div>
      )}
    </>
  );
}

export function TeacherOrders({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('ALL');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [success, setSuccess] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    setOrders([]);
    try {
      setOrders(await api<Order[]>('/orders/mine?pageSize=100', { token }));
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [token]);
  async function cancelOrder(id: number) {
    setBusyId(id);
    setError('');
    setSuccess('');
    try {
      await api<Order>(`/orders/${id}/cancel`, {
        token,
        method: 'POST',
        body: cancelReason.trim() ? { reason: cancelReason.trim() } : {},
      });
      setCancelId(null);
      setCancelReason('');
      setSuccess(`Order #${id} cancelled. Any eligible refund is recorded in your budget ledger.`);
      await load();
      onChanged();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusyId(null);
    }
  }
  const filtered = status === 'ALL' ? orders : orders.filter((o) => o.status === status);
  return (
    <>
      <PageHeader
        eyebrow="YOUR ACTIVITY"
        title="My orders"
        description="Review order details and cancel confirmed orders when the cutoff policy permits."
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
      <Card>
        <div className="toolbar">
          <div>
            <h2>Order history</h2>
            <p>{orders.length} order(s) loaded from your account</p>
          </div>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter order status"
          >
            <option value="ALL">All statuses</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="COLLECTED">Collected</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>
        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <Empty
            title="No orders found"
            detail="Orders placed through the menu will appear here."
          />
        ) : (
          <div className="order-history">
            {filtered.map((order) => (
              <div className="history-card" key={order.id}>
                <div className="history-main">
                  <div className="order-icon">🍽</div>
                  <div>
                    <div className="history-title">
                      <strong>Order #{order.id}</strong>
                      <StatusPill status={order.status} />
                    </div>
                    <p>
                      {order.foodLocation.name} · {order.orderDate}
                    </p>
                    <div className="history-items">
                      {order.items.map((item) => (
                        <span key={item.id}>
                          {item.name} <b>×{item.quantity}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="history-side">
                  <strong>{order.total.amountFormatted}</strong>
                  <small>Placed {new Date(order.confirmedAt).toLocaleString()}</small>
                  {order.status === 'CONFIRMED' && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setCancelId(order.id);
                        setCancelReason('');
                      }}
                    >
                      Cancel order
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {cancelId !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-heading">
            <div className="modal-header">
              <h2 id="cancel-heading">Cancel order #{cancelId}?</h2>
              <button className="icon-button" aria-label="Close" onClick={() => setCancelId(null)}>
                ×
              </button>
            </div>
            <p>
              Cancellation is subject to the university’s cutoff rules. The API will determine
              whether a refund is permitted.
            </p>
            <Field label="Reason (optional)">
              <Textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Add a note for your records"
              />
            </Field>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setCancelId(null)}>
                Keep order
              </Button>
              <Button
                variant="danger"
                disabled={busyId === cancelId}
                onClick={() => void cancelOrder(cancelId)}
              >
                {busyId === cancelId ? 'Cancelling…' : 'Confirm cancellation'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function TeacherBudget({ token }: { token: string }) {
  const [month, setMonth] = useState(currentDhakaMonth());
  const [budget, setBudget] = useState<BudgetSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const { year, month: monthNumber } = splitMonth(month);
  useEffect(() => {
    if (!month) {
      setBudget(null);
      setLedger([]);
      return;
    }
    let cancelled = false;
    setLoadingData(true);
    setError('');
    setBudget(null);
    setLedger([]);
    Promise.all([
      api<BudgetSummary>(`/teacher/budget?year=${year}&month=${monthNumber}`, { token }),
      api<LedgerEntry[]>(
        `/teacher/budget/ledger?year=${year}&month=${monthNumber}&perPage=100`,
        { token },
      ),
    ])
      .then(([summary, entries]) => {
        if (!cancelled) {
          setBudget(summary);
          setLedger(entries);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, month, year, monthNumber]);
  return (
    <>
      <PageHeader
        eyebrow="BUDGET & LEDGER"
        title="My meal budget"
        description="All amounts are retrieved from the budget ledger maintained by the server."
        action={
          <Input
            type="month"
            max={currentDhakaMonth()}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Choose budget month"
          />
        }
      />
      {error && <Alert>{error}</Alert>}
      {loadingData ? (
        <Loading />
      ) : budget ? (
        <>
          {budget && !budget.hasAllocation && (
            <Alert tone="info">
              No budget has been allocated to you for {budget.period.name} yet. Ask an
              administrator to allocate your monthly meal budget.
            </Alert>
          )}
          <div className="stat-grid">
            <StatCard
              label="Available"
              value={budget.available.amountFormatted}
              detail={budget.period.name}
              tone={budget.available.amountPaisa < 0 ? 'orange' : 'green'}
              symbol="৳"
            />
            <StatCard
              label="Allocated"
              value={budget.allocated.amountFormatted}
              detail={budget.allocated.amountPaisa === 0 ? 'Not allocated yet' : 'Budget assigned'}
              tone="violet"
              symbol="↗"
            />
            <StatCard
              label="Carried forward"
              value={budget.carryForward.amountFormatted}
              detail="From previous months"
              tone={budget.carryForward.amountPaisa < 0 ? 'orange' : 'blue'}
              symbol="↺"
            />
            <StatCard
              label="Spent"
              value={budget.spent.amountFormatted}
              detail="Confirmed meal orders"
              tone="orange"
              symbol="↘"
            />
          </div>
          <Card>
            <div className="card-heading">
              <div>
                <h2>Budget ledger</h2>
                <p>{budget.period.name} activity</p>
              </div>
              <span className="record-count">{ledger.length} entries</span>
            </div>
            {ledger.length === 0 ? (
              <Empty
                title="No transactions in this month"
                detail="Allocations, meal orders and refunds will appear here."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Reason</th>
                    <th className="align-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <span className={`ledger-type ledger-${entry.entryType}`}>
                          {entry.entryType}
                        </span>
                      </td>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td>{entry.orderId ? `Order #${entry.orderId}` : `Entry #${entry.id}`}</td>
                      <td>{entry.reason || '—'}</td>
                      <td
                        className={`align-right amount-${entry.amount.amountPaisa >= 0 ? 'positive' : 'negative'}`}
                      >
                        {entry.amount.amountFormatted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </>
      ) : (
        <Empty
          title="No budget data yet"
          detail="Once a budget is allocated to you, the ledger and balance appear here."
        />
      )}
      {!loadingData && <TeacherBudgetRequests token={token} />}
    </>
  );
}

/** Request a budget increase or extra debt allowance, and track the decision. */
export function TeacherBudgetRequests({ token }: { token: string }) {
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [requestType, setRequestType] = useState<'budget_increase' | 'debt_allowance'>(
    'budget_increase',
  );
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    try {
      setRequests(await api<BudgetRequest[]>('/teacher/budget-requests?perPage=20', { token }));
    } catch (e) {
      setError(asMessage(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const taka = Number.parseFloat(amount);
    if (!Number.isFinite(taka) || taka <= 0) {
      setError('Enter a valid positive amount in taka.');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api('/teacher/budget-requests', {
        token,
        method: 'POST',
        body: {
          requestType,
          amountPaisa: Math.round(taka * 100),
          reason,
        },
      });
      setSuccess('Request submitted. An administrator will review it soon.');
      setAmount('');
      setReason('');
      await load();
    } catch (err) {
      setError(asMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="card-heading">
        <div>
          <h2>Budget requests</h2>
          <p>Ask for more budget or permission to go into debt</p>
        </div>
        <span className="record-count">{requests.length} requests</span>
      </div>
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      <form className="request-form" onSubmit={(e) => void submit(e)}>
        <Field label="Request type">
          <Select value={requestType} onChange={(e) => setRequestType(e.target.value as typeof requestType)}>
            <option value="budget_increase">Budget increase (adds to this month's budget)</option>
            <option value="debt_allowance">Debt allowance (extra permitted debt)</option>
          </Select>
        </Field>
        <Field label="Amount (৳)">
          <Input
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
            required
          />
        </Field>
        <Field label="Reason">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why do you need this?"
            rows={2}
            required
          />
        </Field>
        <Button disabled={submitting}>
          <span>{submitting ? 'Submitting…' : 'Submit request'}</span>
        </Button>
      </form>
      {requests.length === 0 ? (
        <Empty title="No requests yet" detail="Submitted requests and their status appear here." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>
                  {request.requestType === 'budget_increase' ? 'Budget increase' : 'Debt allowance'}
                </td>
                <td>{request.amount.amountFormatted}</td>
                <td>{request.reason}</td>
                <td>
                  <StatusPill status={request.status.toUpperCase()} />
                </td>
                <td>{new Date(request.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

function getGreeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Dhaka',
    }).format(new Date()),
  );
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}
function foodSymbol(category: string | null | undefined) {
  const value = (category || '').toLowerCase();
  if (value.includes('drink') || value.includes('beverage')) return '◉';
  if (value.includes('snack') || value.includes('breakfast')) return '✦';
  return '◒';
}
