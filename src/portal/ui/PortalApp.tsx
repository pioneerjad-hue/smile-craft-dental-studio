import { useState } from 'react';
import type { FormEvent } from 'react';
import { usePortal } from '../store';
import type { Role } from '../model';
import { needsAction, unreadCount } from '../workflow';
import { Toasts, go, useRoute } from './common';
import { Dashboard } from './Dashboard';
import { CaseList } from './CaseList';
import { CaseWizard } from './CaseWizard';
import { CaseDetail } from './CaseDetail';
import { Inbox } from './Inbox';
import { Billing } from './Billing';
import { Settings } from './Settings';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--brand)" />
      <path
        fill="#fff"
        d="M23 14c-6 0-10 4.5-10 11 0 6.5 3 10 4.5 16 1.4 6 2.8 10 5.7 10s3.6-5.6 5-9.8c.7-2 1.4-2.8 3.8-2.8s3 .8 3.7 2.8c1.5 4.2 2.2 9.8 5 9.8s4.4-4 5.8-10c1.4-6 4.5-9.5 4.5-16 0-6.5-4-11-10-11-3.6 0-5.8 2.2-9 2.2S26.6 14 23 14z"
      />
    </svg>
  );
}

function SignIn() {
  const signIn = usePortal((s) => s.signIn);
  const doctor = usePortal((s) => s.db.doctor);
  const [role, setRole] = useState<Role>('doctor');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn(role);
    go('dashboard');
  };
  return (
    <div className="signin">
      <div className="signin-art" aria-hidden="true">
        <div className="signin-quote">
          <Logo size={44} />
          <h1>Smile Craft Doctor Portal</h1>
          <p>Submit cases, review treatment plans, approve aligners and follow every patient from scan to retention.</p>
          <ul>
            <li>One-page prescription with your saved clinical preferences</li>
            <li>Interactive plan review with tooth-level comments</li>
            <li>Messaging with the planning team on every case</li>
            <li>Refinements, retainers, shipments and invoices in one place</li>
          </ul>
        </div>
      </div>
      <form className="signin-form" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted">Demo mode – data stays in this browser. Any password works.</p>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" defaultValue={role === 'doctor' ? doctor.email : 'planning@smilecraft.dental'} key={role} autoComplete="username" />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" defaultValue="demo-password" autoComplete="current-password" />
        </label>
        <fieldset className="role-pick">
          <legend className="field-label">Sign in as</legend>
          <label className={role === 'doctor' ? 'on' : ''}>
            <input type="radio" name="role" checked={role === 'doctor'} onChange={() => setRole('doctor')} />
            <strong>Doctor</strong>
            <span className="muted small">Submit and manage your patients</span>
          </label>
          <label className={role === 'lab' ? 'on' : ''}>
            <input type="radio" name="role" checked={role === 'lab'} onChange={() => setRole('lab')} />
            <strong>Smile Craft team</strong>
            <span className="muted small">Plan, publish and ship cases</span>
          </label>
        </fieldset>
        <button className="primary big" type="submit">
          Sign in
        </button>
        <p className="small muted">
          Tip: open a second tab as the Smile Craft team to play both sides of a case – tabs stay in sync.
        </p>
      </form>
    </div>
  );
}

const NAV: { path: string; label: string; icon: string }[] = [
  { path: 'dashboard', label: 'Dashboard', icon: '◧' },
  { path: 'cases', label: 'Patients & cases', icon: '☰' },
  { path: 'messages', label: 'Messages', icon: '✉' },
  { path: 'billing', label: 'Billing', icon: '$' },
  { path: 'settings', label: 'Preferences', icon: '⚙' },
];

export function PortalApp() {
  const signedIn = usePortal((s) => s.signedIn);
  const role = usePortal((s) => s.role);
  const cases = usePortal((s) => s.db.cases);
  const doctor = usePortal((s) => s.db.doctor);
  const setRole = usePortal((s) => s.setRole);
  const signOut = usePortal((s) => s.signOut);
  const route = useRoute();
  const [menu, setMenu] = useState(false);

  if (!signedIn) {
    return (
      <>
        <SignIn />
        <Toasts />
      </>
    );
  }

  const unread = cases.reduce((n, c) => n + unreadCount(c, role), 0);
  const todo = cases.filter((c) => needsAction(c, role)).length;
  const [page, id, sub] = route;

  let body;
  if (page === 'cases' && id === 'new') body = <CaseWizard />;
  else if (page === 'cases' && id && sub === 'edit') body = <CaseWizard caseId={id} />;
  else if (page === 'cases' && id) body = <CaseDetail caseId={id} tab={sub} />;
  else if (page === 'cases') body = <CaseList />;
  else if (page === 'messages') body = <Inbox />;
  else if (page === 'billing') body = <Billing />;
  else if (page === 'settings') body = <Settings />;
  else body = <Dashboard />;

  return (
    <div className={`shell role-${role}`}>
      <aside className={`nav${menu ? ' open' : ''}`}>
        <a className="nav-brand" href="#/dashboard" onClick={() => setMenu(false)}>
          <Logo />
          <span>
            Smile Craft
            <small>{role === 'doctor' ? 'Doctor Portal' : 'Lab Console'}</small>
          </span>
        </a>
        {role === 'doctor' && (
          <button className="primary nav-cta" onClick={() => (setMenu(false), go('cases/new'))}>
            + New case
          </button>
        )}
        <nav>
          {NAV.filter((n) => role === 'doctor' || n.path !== 'settings').map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={page === n.path || (n.path === 'dashboard' && !page) ? 'on' : ''} onClick={() => setMenu(false)}>
              <span className="nav-ic" aria-hidden="true">
                {n.icon}
              </span>
              {n.label}
              {n.path === 'dashboard' && todo > 0 && <span className="pill">{todo}</span>}
              {n.path === 'messages' && unread > 0 && <span className="pill">{unread}</span>}
            </a>
          ))}
        </nav>
        <div className="nav-foot">
          <a href="./index.html" className="nav-studio" title="Open the 3D treatment planning studio">
            ⬡ Open 3D studio
          </a>
          <div className="role-switch" role="radiogroup" aria-label="Demo role">
            <span className="small muted">Demo view</span>
            <div className="segmented">
              <button role="radio" aria-checked={role === 'doctor'} className={role === 'doctor' ? 'on' : ''} onClick={() => setRole('doctor')}>
                Doctor
              </button>
              <button role="radio" aria-checked={role === 'lab'} className={role === 'lab' ? 'on' : ''} onClick={() => setRole('lab')}>
                Smile Craft
              </button>
            </div>
          </div>
          <div className="who">
            <div className="avatar" aria-hidden="true">
              {role === 'doctor' ? doctor.name.replace(/^Dr\.?\s*/, '').slice(0, 1) : 'S'}
            </div>
            <div className="grow">
              <strong>{role === 'doctor' ? doctor.name : 'Planning team'}</strong>
              <div className="small muted">{role === 'doctor' ? doctor.practice : 'Smile Craft'}</div>
            </div>
            <button className="ghost small" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <button className="ghost icon menu-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu">
            ☰
          </button>
          <span className="topbar-brand">
            <Logo size={22} /> Smile Craft
          </span>
        </header>
        <main className="page">{body}</main>
      </div>
      {menu && <div className="nav-scrim" onClick={() => setMenu(false)} />}
      <Toasts />
    </div>
  );
}
