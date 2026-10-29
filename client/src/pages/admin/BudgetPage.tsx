// Monthly budget planning for administrators.
//
// Replaces the legacy "budget periods" admin page. The admin plans budgets per
// calendar month: every active teacher appears in the table with the budget
// allocated to them for the selected month and the remaining balance (which
// includes carry-forward from previous months shown in red when it is
// negative). Each row has an edit action to increase or decrease the budget.
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, asMessage, currentDhakaMonth, hasPermission, money } from '../../api';
import type {
  BudgetRequest,
  LedgerEntry,
  MonthTransaction,
  MonthlyBudgetRow,
  User,
} from '../../types';
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
  TableWrap,
} from '../../ui';

interface TeacherListItem {
  id: number;
  fullName: string;
  email: string;
}

const MONTH_NAMES = [
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

function splitMonth(monthValue: string): { year: number; month: number } {
  const [year, month] = monthValue.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0 };
}

function moneyCell(value: number): number {
  return Math.round(value);
}

function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[Math.min(Math.max(month, 1), 12) - 1] ?? ''} ${year}`;
}

export function AdminBudget({ token, user }: { token: string; user: User }) {
  const [monthValue, setMonthValue] = useState(currentDhakaMonth());
  const [rows, setRows] = useState<MonthlyBudgetRow[]>([]);
  const [transactions, setTransactions] = useState<MonthTransaction[]>([]);
  const [teachers, setTeachers] = useState<TeacherListItem[]>([]);
  const [transactionTeacher, setTransactionTeacher] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ amountTaka: '', reason: '' });
  const [allocateForm, setAllocateForm] = useState({
    teacherId: '',
    amountTaka: '',
    reason: 'Monthly meal budget allocation',
  });
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [detailTeacherId, setDetailTeacherId] = useState<number | null>(null);
  const [detailLedger, setDetailLedger] = useState<LedgerEntry[]>([]);
  const [detailTransactions, setDetailTransactions] = useState<MonthTransaction[]>([]);

  const canAllocate = hasPermission(user.role, user.permissions, 'budgets:allocate');
  const canAdjust = hasPermission(user.role, user.permissions, 'budgets:adjust');
  const canView = hasPermission(user.role, user.permissions, 'budgets:view');

  const { year, month } = splitMonth(monthValue);

  // Drill-down data for the selected teacher profile card.
  useEffect(() => {
    if (detailTeacherId === null || !year || !month) return;
    let cancelled = false;
    Promise.all([
      api<LedgerEntry[]>(
        `/staff/budgets/ledger?teacherId=${detailTeacherId}&year=${year}&month=${month}&perPage=100`,
        { token },
      ),
      api<MonthTransaction[]>(
        `/staff/budgets/transactions?teacherId=${detailTeacherId}&year=${year}&month=${month}&perPage=100`,
        { token },
      ),
    ])
      .then(([ledgerRows, transactionRows]) => {
        if (cancelled) return;
        setDetailLedger(ledgerRows);
        setDetailTransactions(transactionRows);
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, detailTeacherId, year, month]);

  const loadAll = useCallback(async () => {
    if (!year || !month) return;
    setError('');
    try {
      const [budgetRows, transactionRows] = await Promise.all([
        canView
          ? api<MonthlyBudgetRow[]>(`/staff/budgets/monthly?year=${year}&month=${month}`, { token })
          : Promise.resolve([] as MonthlyBudgetRow[]),
        canView
          ? api<MonthTransaction[]>(
              `/staff/budgets/transactions?year=${year}&month=${month}${transactionTeacher ? `&teacherId=${transactionTeacher}` : ''}&perPage=100`,
              { token },
            )
          : Promise.resolve([] as MonthTransaction[]),
      ]);
      setRows(budgetRows);
      setTransactions(transactionRows);
      if (!teachers.length) {
        setTeachers(
          budgetRows.map((row) => ({
            id: row.teacher.id,
            fullName: row.teacher.fullName,
            email: row.teacher.email,
          })),
        );
        if (budgetRows[0]) {
          setAllocateForm((f) => ({ ...f, teacherId: f.teacherId || String(budgetRows[0]!.teacher.id) }));
        }
      }
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }, [token, year, month, canView, transactionTeacher, teachers.length]);

  useEffect(() => {
    setLoading(true);
    void loadAll();
  }, [loadAll]);

  const loadRequests = useCallback(async () => {
    if (!canView) return;
    try {
      setRequests(await api<BudgetRequest[]>('/staff/budget-requests?status=pending&perPage=50', { token }));
    } catch (e) {
      setError(asMessage(e));
    }
  }, [token, canView]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function decideRequest(id: number, decision: 'approved' | 'rejected') {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api(`/staff/budget-requests/${id}/decision`, {
        token,
        method: 'POST',
        body: { decision },
      });
      setSuccess(
        decision === 'approved'
          ? 'Request approved. The budget or debt allowance was updated.'
          : 'Request rejected.',
      );
      await loadRequests();
      await loadAll();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function allocate(e: FormEvent) {
    e.preventDefault();
    const amount = Number(allocateForm.amountTaka);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Allocation must be a positive amount.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api('/staff/budgets/allocations', {
        token,
        method: 'POST',
        body: {
          teacherId: Number(allocateForm.teacherId),
          year,
          month,
          amountPaisa: Math.round(amount * 100),
          reason: allocateForm.reason.trim() || 'Monthly allocation',
        },
      });
      setSuccess(
        `Allocated ${money(Math.round(amount * 100))} for ${formatMonthLabel(year, month)}.`,
      );
      setAllocateForm((f) => ({ ...f, amountTaka: '' }));
      await loadAll();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(id: number) {
    setError('');
    setSuccess('');
    setEditingId(id);
    setEditForm({ amountTaka: '', reason: '' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({ amountTaka: '', reason: '' });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    const delta = Number(editForm.amountTaka);
    if (!Number.isFinite(delta) || delta === 0) {
      setError('Enter an amount to increase or decrease. Use a minus sign to decrease.');
      return;
    }
    if (!editForm.reason.trim()) {
      setError('A reason is required when editing a teacher budget.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api('/staff/budgets/adjustments', {
        token,
        method: 'POST',
        body: {
          teacherId: editingId,
          year,
          month,
          amountPaisa: Math.round(delta * 100),
          reason: editForm.reason.trim(),
        },
      });
      setSuccess(
        `Budget for ${rows.find((r) => r.teacher.id === editingId)?.teacher.fullName ?? 'teacher'} updated by ${money(Math.round(delta * 100))}.`,
      );
      cancelEdit();
      await loadAll();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const totalAllocated = rows.reduce(
    (sum, row) => sum + moneyCell(row.allocated.amountPaisa) + moneyCell(row.adjusted.amountPaisa),
    0,
  );
  const totalRemaining = rows.reduce((sum, row) => sum + moneyCell(row.remaining.amountPaisa), 0);
  const negativeCount = rows.filter((row) => row.remaining.amountPaisa < 0).length;

  return (
    <>
      <PageHeader
        eyebrow="BUDGET ADMINISTRATION"
        title="Monthly budget planning"
        description="Allocate and edit each teacher's budget for the selected month. The six-month allocation history lives in the Reports section."
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      <Card className="filter-card">
        <Field label="Budget month">
          <Input
            type="month"
            required
            value={monthValue}
            onChange={(e) => {
              setMonthValue(e.target.value);
              cancelEdit();
            }}
          />
        </Field>
        <span className="field-hint">{formatMonthLabel(year, month)}</span>
      </Card>
      {loading ? (
        <Loading />
      ) : (
        <>
          {canView && (
            <div className="stat-grid">
              <StatCard
                label="Total allocated"
                value={money(totalAllocated)}
                detail="All teachers this month"
                tone="violet"
                symbol="↗"
              />
              <StatCard
                label="Total remaining"
                value={money(totalRemaining)}
                detail="Including carry-forward"
                tone="green"
                symbol="৳"
              />
              <StatCard
                label="Teachers over budget"
                value={String(negativeCount)}
                detail="Deducted from next month"
                tone="orange"
                symbol="↘"
              />
            </div>
          )}

          {canView && (
            <>
              <div className="profile-grid">
                {rows.map((row) => (
                  <Card
                    key={row.teacher.id}
                    className={`teacher-profile ${detailTeacherId === row.teacher.id ? 'selected' : ''}`}
                  >
                    <div className="profile-head">
                      <span className="avatar">
                        {row.teacher.fullName.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span className="profile-name">
                        <strong>{row.teacher.fullName}</strong>
                        <small>{row.teacher.email}</small>
                      </span>
                    </div>
                    <div className="profile-figures">
                      <span>
                        <small>Remaining</small>
                        <strong
                          className={row.remaining.amountPaisa < 0 ? 'amount-negative' : ''}
                        >
                          {row.remaining.amountPaisa < 0
                            ? `−${money(Math.abs(row.remaining.amountPaisa))}`
                            : money(row.remaining.amountPaisa)}
                        </strong>
                      </span>
                      <span>
                        <small>Allocated</small>
                        <strong>
                          {moneyCell(row.allocated.amountPaisa) + moneyCell(row.adjusted.amountPaisa) >
                          0
                            ? money(
                                moneyCell(row.allocated.amountPaisa) +
                                  moneyCell(row.adjusted.amountPaisa),
                              )
                            : '—'}
                        </strong>
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setDetailTeacherId(
                          detailTeacherId === row.teacher.id ? null : row.teacher.id,
                        )
                      }
                    >
                      {detailTeacherId === row.teacher.id ? 'Close details' : 'View details'}
                    </Button>
                  </Card>
                ))}
              </div>

              {detailTeacherId !== null && (
                <Card>
                  <div className="card-heading">
                    <div>
                      <h2>
                        {rows.find((r) => r.teacher.id === detailTeacherId)?.teacher.fullName ??
                          'Teacher'}{' '}
                        — {formatMonthLabel(year, month)}
                      </h2>
                      <p>Ledger entries and meal orders for this teacher in the selected month.</p>
                    </div>
                    <Button variant="ghost" onClick={() => setDetailTeacherId(null)}>
                      ✕ Close
                    </Button>
                  </div>
                  <div className="card-heading">
                    <div>
                      <h3>Budget ledger</h3>
                    </div>
                    <span className="record-count">{detailLedger.length} entries</span>
                  </div>
                  {detailLedger.length ? (
                    <TableWrap>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Date</th>
                          <th>Reference</th>
                          <th>Reason</th>
                          <th className="align-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLedger.map((entry) => (
                          <tr key={entry.id}>
                            <td>
                              <span className={`ledger-type ledger-${entry.entryType}`}>
                                {entry.entryType}
                              </span>
                            </td>
                            <td>{new Date(entry.createdAt).toLocaleString()}</td>
                            <td>
                              {entry.orderId ? `Order #${entry.orderId}` : `Entry #${entry.id}`}
                            </td>
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
                  ) : (
                    <Empty
                      title="No ledger activity this month"
                      detail="Allocations, edits, orders and refunds will appear here."
                    />
                  )}
                  <div className="card-heading">
                    <div>
                      <h3>Meal orders</h3>
                    </div>
                    <span className="record-count">{detailTransactions.length} orders</span>
                  </div>
                  {detailTransactions.length ? (
                    <TableWrap>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Transaction ID</th>
                          <th className="align-right">Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailTransactions.map((txn) => (
                          <tr key={txn.id}>
                            <td>{txn.orderDate}</td>
                            <td>
                              <code>{txn.transactionId}</code>
                            </td>
                            <td className="align-right">{money(txn.amount.amountPaisa)}</td>
                            <td>{txn.status.toLowerCase()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </TableWrap>
                  ) : (
                    <Empty title="No orders this month" detail="Meal orders appear here." />
                  )}
                </Card>
              )}
            </>
          )}

          {canView && requests.length > 0 && (
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Budget requests</h2>
                  <p>
                    Teacher requests waiting for review. Approving a budget increase adds it to
                    the teacher's current month; approving a debt allowance raises their personal
                    debt limit.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => void loadRequests()}>
                  ↻ Refresh
                </Button>
              </div>
              <TableWrap>
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Type</th>
                    <th className="align-right">Amount</th>
                    <th>Reason</th>
                    <th>Submitted</th>
                    {canAdjust && <th className="align-right">Decision</th>}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <strong>{request.teacher.fullName}</strong>
                      </td>
                      <td>
                        {request.requestType === 'budget_increase'
                          ? 'Budget increase'
                          : 'Debt allowance'}
                      </td>
                      <td className="align-right">{request.amount.amountFormatted}</td>
                      <td>{request.reason}</td>
                      <td>{new Date(request.createdAt).toLocaleString()}</td>
                      {canAdjust && (
                        <td className="align-right">
                          <span className="toolbar">
                            <Button
                              disabled={busy}
                              onClick={() => void decideRequest(request.id, 'approved')}
                            >
                              ✓ Approve
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void decideRequest(request.id, 'rejected')}
                            >
                              ✕ Reject
                            </Button>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          )}

          {canAllocate && (
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Allocate monthly budget</h2>
                  <p>
                    Creates the allocation for {formatMonthLabel(year, month)} in one transaction.
                    Teachers already allocated this month can be edited from the table below.
                  </p>
                </div>
              </div>
              <form className="form-stack" onSubmit={(e) => void allocate(e)}>
                <Field label="Teacher">
                  <Select
                    required
                    value={allocateForm.teacherId}
                    onChange={(e) =>
                      setAllocateForm({ ...allocateForm, teacherId: e.target.value })
                    }
                  >
                    <option value="">Select teacher</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName} · {t.email}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount (৳)">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={allocateForm.amountTaka}
                    onChange={(e) =>
                      setAllocateForm({ ...allocateForm, amountTaka: e.target.value })
                    }
                    placeholder="1,200.00"
                  />
                </Field>
                <Field label="Reason">
                  <Input
                    required
                    maxLength={500}
                    value={allocateForm.reason}
                    onChange={(e) =>
                      setAllocateForm({ ...allocateForm, reason: e.target.value })
                    }
                  />
                </Field>
                <Button type="submit" disabled={busy || !allocateForm.teacherId}>
                  {busy ? 'Saving…' : 'Allocate budget'}
                </Button>
              </form>
            </Card>
          )}

          {canView && (
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Teacher budgets — {formatMonthLabel(year, month)}</h2>
                  <p>
                    Remaining balance includes carry-forward from previous months. A negative
                    remaining balance is shown in red and is deducted from next month's budget.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => void loadAll()}>
                  ↻ Refresh
                </Button>
              </div>
              {rows.length ? (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Teacher</th>
                      <th>Allocated</th>
                      <th>Carry-forward</th>
                      <th>Spent</th>
                      <th className="align-right">Remaining</th>
                      {canAdjust && <th className="align-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const editing = canAdjust && editingId === row.teacher.id;
                      return (
                        <Fragment key={row.teacher.id}>
                        <tr>
                          <td>
                            <strong>{row.teacher.fullName}</strong>
                            <small className="table-subtitle">{row.teacher.email}</small>
                          </td>
                              <td>
                                {moneyCell(row.allocated.amountPaisa) +
                                  moneyCell(row.adjusted.amountPaisa) >
                                0 ? (
                                  <span>
                                    {money(
                                      moneyCell(row.allocated.amountPaisa) +
                                        moneyCell(row.adjusted.amountPaisa),
                                    )}
                                  </span>
                                ) : (
                                  <span className="table-subtitle">Not allocated</span>
                                )}
                              </td>
                              <td
                                className={
                                  row.carryForward.amountPaisa < 0 ? 'amount-negative' : ''
                                }
                              >
                                {money(row.carryForward.amountPaisa)}
                              </td>
                              <td>{money(row.spent.amountPaisa)}</td>
                              <td
                                className={`align-right ${
                                  row.remaining.amountPaisa < 0 ? 'amount-negative' : ''
                                }`}
                              >
                                <strong>
                                  {row.remaining.amountPaisa < 0
                                    ? `−${money(Math.abs(row.remaining.amountPaisa))}`
                                    : money(row.remaining.amountPaisa)}
                                </strong>
                              </td>
                              {canAdjust && (
                                <td className="align-right">
                                  {editing ? (
                                    <Button variant="ghost" onClick={cancelEdit}>
                                      Cancel
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      onClick={() => startEdit(row.teacher.id)}
                                    >
                                      ✎ Edit budget
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                            {editing ? (
                              <tr className="budget-edit-row">
                                <td colSpan={canAdjust ? 6 : 5}>
                                  <form
                                    className="budget-edit-form"
                                    onSubmit={(e) => void saveEdit(e)}
                                  >
                                    <label>
                                      <span className="budget-edit-label">Change (৳) — use − to decrease</span>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={editForm.amountTaka}
                                        onChange={(e) =>
                                          setEditForm({ ...editForm, amountTaka: e.target.value })
                                        }
                                        placeholder="e.g. 200.00 or -150.00"
                                        aria-label="Budget change in taka"
                                      />
                                    </label>
                                    <label>
                                      <span className="budget-edit-label">Reason</span>
                                      <Input
                                        required
                                        maxLength={500}
                                        value={editForm.reason}
                                        onChange={(e) =>
                                          setEditForm({ ...editForm, reason: e.target.value })
                                        }
                                        placeholder="Reason for the change"
                                        aria-label="Reason"
                                      />
                                    </label>
                                    <Button type="submit" disabled={busy}>
                                      {busy ? 'Saving…' : 'Save'}
                                    </Button>
                                    <Button type="button" variant="ghost" onClick={cancelEdit}>
                                      Cancel
                                    </Button>
                                  </form>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <th>{money(totalAllocated)}</th>
                      <th
                        className={
                          rows.reduce((s, r) => s + moneyCell(r.carryForward.amountPaisa), 0) < 0
                            ? 'amount-negative'
                            : ''
                        }
                      >
                        {money(
                          rows.reduce((s, r) => s + moneyCell(r.carryForward.amountPaisa), 0),
                        )}
                      </th>
                      <th>{money(rows.reduce((s, r) => s + moneyCell(r.spent.amountPaisa), 0))}</th>
                      <th className="align-right">{money(totalRemaining)}</th>
                      {canAdjust && <th />}
                    </tr>
                  </tfoot>
                </TableWrap>
              ) : (
                <Empty
                  title="No teachers found"
                  detail="Create teacher accounts to start planning monthly budgets."
                />
              )}
            </Card>
          )}

          {canView && (
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Order records — {formatMonthLabel(year, month)}</h2>
                  <p>
                    Every successfully completed meal order of this budget month, with date,
                    amount and transaction id.
                  </p>
                </div>
                <div className="toolbar">
                  <Select
                    value={transactionTeacher}
                    onChange={(e) => setTransactionTeacher(e.target.value)}
                    aria-label="Filter transactions by teacher"
                  >
                    <option value="">All teachers</option>
                    {rows.map((row) => (
                      <option key={row.teacher.id} value={row.teacher.id}>
                        {row.teacher.fullName}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {transactions.length ? (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Teacher</th>
                      <th>Transaction ID</th>
                      <th className="align-right">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((txn) => (
                      <tr key={txn.id}>
                        <td>{txn.orderDate}</td>
                        <td>{txn.teacher.fullName}</td>
                        <td>
                          <code>{txn.transactionId}</code>
                        </td>
                        <td className="align-right">{money(txn.amount.amountPaisa)}</td>
                        <td>{txn.status.toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3}>Month total</th>
                      <th className="align-right">
                        {money(
                          transactions.reduce(
                            (sum, txn) => sum + moneyCell(txn.amount.amountPaisa),
                            0,
                          ),
                        )}
                      </th>
                      <th />
                    </tr>
                  </tfoot>
                </TableWrap>
              ) : (
                <Empty
                  title="No completed orders this month"
                  detail="Transactions appear here as teachers place and receive meals.
                 "
                />
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
