import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, asMessage, hasPermission } from './api';
import type { Permission, User } from './types';
import {
  AdminBudget,
  AdminLocations,
  AdminMenus,
  AdminSettings,
  AdminUsers,
} from './pages/AdminPages';
import { StaffOperations, StaffReports } from './pages/StaffPages';
import { TeacherBudget, TeacherMeals, TeacherOrders, TeacherOverview } from './pages/TeacherPages';
import { Alert, Button, Field, Input, Mark } from './ui';

type ViewId =
  | 'overview'
  | 'meals'
  | 'orders'
  | 'budget'
  | 'operations'
  | 'reports'
  | 'locations'
  | 'menus'
  | 'users'
  | 'admin-budget'
  | 'settings';
interface NavigationItem {
  id: ViewId;
  label: string;
  symbol: string;
  section: string;
  permission?: Permission;
  anyPermissions?: Permission[];
  roles?: User['role'][];
}
const NAVIGATION: NavigationItem[] = [
  { id: 'overview', label: 'Overview', symbol: '⌂', section: 'MY SPACE', roles: ['TEACHER'] },
  { id: 'meals', label: 'Order a meal', symbol: '＋', section: 'MY SPACE', roles: ['TEACHER'] },
  { id: 'orders', label: 'My orders', symbol: '≡', section: 'MY SPACE', roles: ['TEACHER'] },
  { id: 'budget', label: 'My budget', symbol: '৳', section: 'MY SPACE', roles: ['TEACHER'] },
  {
    id: 'operations',
    label: 'Daily operations',
    symbol: '▦',
    section: 'OPERATIONS',
    roles: ['STAFF', 'ADMIN'],
  },
  {
    id: 'reports',
    label: 'Reports',
    symbol: '▤',
    section: 'OPERATIONS',
    roles: ['STAFF', 'ADMIN'],
  },
  {
    id: 'locations',
    label: 'Food locations',
    symbol: '⌂',
    section: 'MANAGEMENT',
    permission: 'locations:manage',
  },
  {
    id: 'menus',
    label: 'Menus & prices',
    symbol: '◈',
    section: 'MANAGEMENT',
    permission: 'menu_items:manage',
  },
  {
    id: 'admin-budget',
    label: 'Budgets & ledger',
    symbol: '৳',
    section: 'MANAGEMENT',
    anyPermissions: ['budgets:allocate', 'budgets:adjust', 'budgets:view'],
  },
  {
    id: 'users',
    label: 'Users & access',
    symbol: '♙',
    section: 'MANAGEMENT',
    anyPermissions: ['users:manage', 'users:create'],
  },
  {
    id: 'settings',
    label: 'Policy settings',
    symbol: '⚙',
    section: 'MANAGEMENT',
    permission: 'settings:manage',
  },
];

interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: User;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [view, setView] = useState<ViewId>('overview');
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [globalNotice, setGlobalNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/health')
      .then((response) => {
        if (!cancelled) setHealth(response.ok ? 'online' : 'offline');
      })
      .catch(() => {
        if (!cancelled) setHealth('offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableNavigation = useMemo(
    () =>
      user
        ? NAVIGATION.filter((item) => {
            if (item.roles && !item.roles.includes(user.role)) return false;
            if (item.permission && !hasPermission(user.role, user.permissions, item.permission))
              return false;
            if (
              item.anyPermissions &&
              !item.anyPermissions.some((p) => hasPermission(user.role, user.permissions, p))
            )
              return false;
            return true;
          })
        : [],
    [user],
  );

  useEffect(() => {
    if (availableNavigation.length && !availableNavigation.some((item) => item.id === view))
      setView(availableNavigation[0]!.id);
  }, [availableNavigation, view]);

  async function signIn(email: string, password: string) {
    setGlobalNotice('');
    const response = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(response.accessToken);
    setUser(response.user);
    setView(response.user.role === 'TEACHER' ? 'overview' : 'operations');
    setAuthMode('login');
  }
  async function signOut() {
    if (token) {
      try {
        await api('/auth/logout', { token, method: 'POST', body: {} });
      } catch {
        /* Clearing in-memory credentials remains the safe local action. */
      }
    }
    setToken(null);
    setUser(null);
    setView('overview');
    setGlobalNotice('You have been signed out.');
  }

  if (!token || !user) {
    return (
      <AuthScreen
        mode={authMode}
        onModeChange={setAuthMode}
        onLogin={signIn}
        notice={globalNotice}
        onDismissNotice={() => setGlobalNotice('')}
      />
    );
  }

  const currentNav = availableNavigation.find((item) => item.id === view);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <span>JU</span>
            <i>•</i>
          </div>
          <div>
            <strong>JU Meals</strong>
            <small>CSE · Meal Management</small>
          </div>
        </div>
        <div className="department-label">
          <span className="live-dot" /> CAMPUS MEALS PLATFORM
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {(['MY SPACE', 'OPERATIONS', 'MANAGEMENT'] as const).map((section) => {
            const items = availableNavigation.filter((item) => item.section === section);
            if (!items.length) return null;
            return (
              <div className="nav-section" key={section}>
                <span className="nav-section-label">{section}</span>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`nav-item ${view === item.id ? 'active' : ''}`}
                    onClick={() => setView(item.id)}
                  >
                    <Mark>{item.symbol}</Mark>
                    <span>{item.label}</span>
                    {view === item.id && <i className="nav-active-dot" />}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="health-line">
            <span className={`health-dot health-${health}`} />
            <span>
              {health === 'online'
                ? 'API connected'
                : health === 'offline'
                  ? 'API unavailable'
                  : 'Checking API…'}
            </span>
            <span className="health-detail">{health === 'online' ? '●' : '○'}</span>
          </div>
          <div className="sidebar-help">
            <span className="help-symbol">?</span>
            <span>
              <strong>Need help?</strong>
              <small>Contact your department meal coordinator.</small>
            </span>
          </div>
          <button className="user-profile" onClick={() => void signOut()} title="Sign out">
            <span className="avatar">{user.fullName.trim().slice(0, 1).toUpperCase()}</span>
            <span className="profile-text">
              <strong>{user.fullName}</strong>
              <small>
                {user.role === 'ADMIN'
                  ? 'Administrator'
                  : user.role === 'STAFF'
                    ? 'Meal staff'
                    : 'CSE teacher'}
              </small>
            </span>
            <span className="profile-menu">↪</span>
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>JU CSE</span>
            <span className="crumb-separator">/</span>
            <strong>{currentNav?.label ?? 'Dashboard'}</strong>
          </div>
          <div className="topbar-right">
            <span className="today-label">
              {new Intl.DateTimeFormat('en', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                timeZone: 'Asia/Dhaka',
              }).format(new Date())}
            </span>
            <span className="topbar-divider" />
            <span className="user-chip">
              <span className="avatar avatar-tiny">{user.fullName.slice(0, 1).toUpperCase()}</span>
              {user.fullName.split(' ')[0]}
            </span>
            <Button variant="ghost" className="signout-button" onClick={() => void signOut()}>
              Sign out ↗
            </Button>
          </div>
        </header>
        <div className="page-wrap" key={view}>
          {view === 'overview' && user.role === 'TEACHER' && (
            <TeacherOverview token={token} user={user} onNavigate={(v) => setView(v as ViewId)} />
          )}
          {view === 'meals' && user.role === 'TEACHER' && (
            <TeacherMeals token={token} onOrderPlaced={() => undefined} />
          )}
          {view === 'orders' && user.role === 'TEACHER' && (
            <TeacherOrders token={token} onChanged={() => undefined} />
          )}
          {view === 'budget' && user.role === 'TEACHER' && <TeacherBudget token={token} />}
          {view === 'operations' && (user.role === 'STAFF' || user.role === 'ADMIN') && (
            <StaffOperations token={token} user={user} />
          )}
          {view === 'reports' && (user.role === 'STAFF' || user.role === 'ADMIN') && (
            <StaffReports token={token} user={user} />
          )}
          {view === 'locations' &&
            hasPermission(user.role, user.permissions, 'locations:manage') && (
              <AdminLocations token={token} />
            )}
          {view === 'menus' && hasPermission(user.role, user.permissions, 'menu_items:manage') && (
            <AdminMenus token={token} />
          )}
          {view === 'admin-budget' &&
            ['budgets:allocate', 'budgets:adjust', 'budgets:view'].some((p) =>
              hasPermission(user.role, user.permissions, p),
            ) && <AdminBudget token={token} user={user} />}
          {view === 'users' &&
            ['users:manage', 'users:create'].some((p) =>
              hasPermission(user.role, user.permissions, p),
            ) && <AdminUsers token={token} sessionUser={user} />}
          {view === 'settings' && hasPermission(user.role, user.permissions, 'settings:manage') && (
            <AdminSettings token={token} />
          )}
          <footer className="page-footer">
            <span>
              JU Meals <b>·</b> Department of CSE, Jahangirnagar University
            </span>
            <span>
              Data is loaded from the live API <i className="footer-green-dot" />
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function AuthScreen({
  mode,
  onModeChange,
  onLogin,
  notice,
  onDismissNotice,
}: {
  mode: 'login' | 'register';
  onModeChange: (mode: 'login' | 'register') => void;
  onLogin: (email: string, password: string) => Promise<void>;
  notice: string;
  onDismissNotice: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        await api<User>('/auth/register', {
          method: 'POST',
          body: { fullName: fullName.trim(), email: email.trim(), password, role: 'TEACHER' },
        });
        setSuccess('Account created. Sign in with the email and password you registered.');
        setPassword('');
        setConfirmPassword('');
        onModeChange('login');
      } else {
        await onLogin(email.trim(), password);
      }
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <section className="auth-visual">
        <div className="auth-visual-overlay" />
        <div className="auth-brand">
          <div className="brand-mark brand-mark-large">
            <span>JU</span>
            <i>•</i>
          </div>
          <span>
            Jahangirnagar University
            <br />
            <strong>Department of CSE</strong>
          </span>
        </div>
        <div className="auth-hero-copy">
          <div className="eyebrow auth-eyebrow">A BETTER WAY TO BREAK FOR LUNCH</div>
          <h1>
            Campus meals,
            <br />
            <em>made simple.</em>
          </h1>
          <p>
            One place to plan your meals, manage your weekly budget, and make campus food runs a
            little easier.
          </p>
          <div className="auth-feature-list">
            <div>
              <span>✓</span>
              <span>
                <strong>Order in a few clicks</strong>
                <small>Menus and prices from campus locations</small>
              </span>
            </div>
            <div>
              <span>✓</span>
              <span>
                <strong>Know your balance</strong>
                <small>Clear weekly budget and ledger history</small>
              </span>
            </div>
            <div>
              <span>✓</span>
              <span>
                <strong>Less waiting, more eating</strong>
                <small>Staff-coordinated collection updates</small>
              </span>
            </div>
          </div>
        </div>
        <div className="auth-visual-foot">
          <span>Designed for JU CSE teachers</span>
          <span>·</span>
          <span>Asia/Dhaka</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-top">
          <span>JU MEALS PORTAL</span>
          <span className="secure-label">⌑ Secure access</span>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-icon">{mode === 'login' ? '↗' : '＋'}</div>
          <div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</div>
          <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your teacher account'}</h2>
          <p className="auth-subtitle">
            {mode === 'login'
              ? 'Use your university account to continue.'
              : 'Register with your details to access meal ordering.'}
          </p>
          {notice && (
            <Alert tone="success" onClose={onDismissNotice}>
              {notice}
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}
          <form className="auth-form" onSubmit={(e) => void submit(e)}>
            {mode === 'register' && (
              <Field label="Full name">
                <Input
                  autoComplete="name"
                  required
                  maxLength={200}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              </Field>
            )}
            <Field label="University email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@juniv.edu"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 12 : 1}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 12 characters' : 'Enter your password'}
              />
            </Field>
            {mode === 'register' && (
              <Field label="Confirm password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={72}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                />
              </Field>
            )}
            <Button block type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}{' '}
              <span>→</span>
            </Button>
          </form>
          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                New to JU Meals?{' '}
                <button
                  onClick={() => {
                    setError('');
                    setSuccess('');
                    onModeChange('register');
                  }}
                >
                  Create a teacher account
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button
                  onClick={() => {
                    setError('');
                    setSuccess('');
                    onModeChange('login');
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </div>
          <div className="auth-demo-note">
            <strong>Demo environment</strong>
            <p>
              Use the fictional accounts in the repository README after running the database seed.
              Open registration is enabled only outside production.
            </p>
          </div>
        </div>
        <div className="auth-panel-foot">
          © {new Date().getFullYear()} JU Meals <span>·</span> Meal management platform
        </div>
      </section>
    </div>
  );
}
