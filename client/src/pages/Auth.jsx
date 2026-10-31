import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, CheckCircle2, MailCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { check, passwordChecks, rules } from '../lib/validate.js';
import { Button, Card, ErrorBanner, Field, Input, PageHeader, cx, useToast } from '../components/ui.jsx';
import { Logo } from '../components/Layout.jsx';

function Shell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[44%] flex-col justify-between bg-gradient-to-br from-brand-900 via-brand-700 to-brand-600 p-12 text-white lg:flex">
        <Logo className="text-white [&_circle]:stroke-white" />
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Recurring revenue,<br />on autopilot.</h2>
          <p className="mt-4 max-w-sm text-brand-100">Quotes, subscriptions, invoicing, tax and discounts — one loop, billed on time, every cycle.</p>
          <ul className="mt-8 space-y-2 text-sm text-brand-100">
            {['Automated billing with zero double-charges', 'Rule-based tax & discount engine', 'Self-service customer portal'].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-300" />{t}</li>))}
          </ul>
        </div>
        <p className="text-xs text-brand-200">© Brightloop Software</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 text-slate-900 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function PasswordMeter({ value }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
      {passwordChecks(value).map((c) => (
        <li key={c.label} className={cx('flex items-center gap-1.5 text-xs', c.ok ? 'text-emerald-600' : 'text-slate-400')}>
          <CheckCircle2 className="h-3.5 w-3.5" />{c.label}
        </li>))}
    </ul>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [errs, setErrs] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const v = check({ email: [rules.required, rules.email], password: [rules.required] }, f);
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true); setErr(null);
    try { await login(f.email, f.password); nav('/'); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  const demo = (email, password) => setF({ email, password });
  return (
    <Shell title="Sign in" subtitle="Welcome back to Brightloop billing." footer={<>New customer? <Link to="/signup" className="font-medium text-brand-600 hover:underline">Create an account</Link></>}>
      <ErrorBanner error={err} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={errs.email}><Input type="email" autoComplete="email" value={f.email} error={errs.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={<span className="flex justify-between">Password<Link to="/forgot-password" className="font-normal text-brand-600 hover:underline">Forgot?</Link></span>} error={errs.password}>
          <Input type="password" autoComplete="current-password" value={f.password} error={errs.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      </form>
      <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-3">
        <div className="mb-2 text-xs font-medium text-slate-500">Demo accounts</div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => demo('admin@brightloop.io', 'Admin@12345')}>Admin</Button>
          <Button size="sm" variant="secondary" onClick={() => demo('staff@brightloop.io', 'Staff@12345')}>Staff</Button>
          <Button size="sm" variant="secondary" onClick={() => demo('priya@acmeretail.in', 'Customer@123')}>Customer</Button>
        </div>
      </div>
    </Shell>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errs, setErrs] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const v = check({ name: [rules.required], email: [rules.required, rules.email], password: [rules.password],
      confirm: [(x) => (x !== f.password ? 'Passwords do not match' : null)] }, f);
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true); setErr(null);
    try { await signup({ name: f.name, email: f.email, password: f.password }); nav('/'); }
    catch (e2) { setErr(e2); setErrs(e2.fields); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create your account" subtitle="Access your subscriptions and invoices." footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></>}>
      <ErrorBanner error={err} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Company or full name" error={errs.name}><Input value={f.name} error={errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" error={errs.email}><Input type="email" value={f.email} error={errs.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" error={errs.password}><Input type="password" autoComplete="new-password" value={f.password} error={errs.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><PasswordMeter value={f.password} /></Field>
        <Field label="Confirm password" error={errs.confirm}><Input type="password" value={f.confirm} error={errs.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const m = rules.email(email); if (m) return setError(m);
    setBusy(true); setError(null);
    try { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setSent(true); }
    catch (e2) { setError(e2.message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Reset your password" subtitle="We'll email you a secure link that expires in 60 minutes." footer={<Link to="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <MailCheck className="mb-2 h-5 w-5" />If <b>{email}</b> is registered, a reset link is on its way.
          <p className="mt-2 text-xs text-emerald-700">Local dev: without SMTP configured, admins can read the email under Billing &amp; email → Outbox.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" error={error}><Input type="email" value={email} error={error} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ password: '', confirm: '' });
  const [errs, setErrs] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const token = params.get('token');
  const submit = async (e) => {
    e.preventDefault();
    const v = check({ password: [rules.password], confirm: [(x) => (x !== f.password ? 'Passwords do not match' : null)] }, f);
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true); setErr(null);
    try { await api('/auth/reset-password', { method: 'POST', body: { token, password: f.password } }); toast('Password updated — please sign in'); nav('/login'); }
    catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Shell title="Choose a new password" footer={<Link to="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link>}>
      {!token ? <ErrorBanner error="This reset link is missing its token." /> : (
        <>
          <ErrorBanner error={err} />
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="New password" error={errs.password}><Input type="password" value={f.password} error={errs.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><PasswordMeter value={f.password} /></Field>
            <Field label="Confirm password" error={errs.confirm}><Input type="password" value={f.confirm} error={errs.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
            <Button type="submit" className="w-full" loading={busy}>Update password</Button>
          </form>
        </>
      )}
    </Shell>
  );
}

export function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const v = check({ currentPassword: [rules.required], newPassword: [rules.password] }, f);
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try { await api('/auth/change-password', { method: 'POST', body: f }); toast('Password changed'); setF({ currentPassword: '', newPassword: '' }); }
    catch (e2) { setErrs(e2.fields); toast(e2.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Account" subtitle={`${user.name} · ${user.email}`} />
      <Card title="Change password" className="max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Current password" error={errs.currentPassword}><Input type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
          <Field label="New password" error={errs.newPassword}><Input type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /><PasswordMeter value={f.newPassword} /></Field>
          <Button type="submit" loading={busy}>Update password</Button>
        </form>
      </Card>
    </>
  );
}
