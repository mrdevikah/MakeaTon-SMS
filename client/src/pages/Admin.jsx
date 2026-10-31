import { useState } from 'react';
import { Mail, Play, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { check, rules } from '../lib/validate.js';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, PageHeader, Select, Table, Toggle, useAction } from '../components/ui.jsx';
import { CustomerPicker } from '../components/pickers.jsx';
import { PasswordMeter } from './Auth.jsx';

export function Users() {
  const { user: me } = useAuth();
  const list = useApi('/users');
  const { run } = useAction();
  const [f, setF] = useState(null);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = check({ name: [rules.required], email: [rules.required, rules.email], password: [rules.password],
      customer_id: [(x, o) => (o.role === 'customer' && !x ? 'Choose a customer' : null)] }, f);
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try { await api('/users', { method: 'POST', body: { ...f, customer_id: f.role === 'customer' ? Number(f.customer_id) : null } }); setF(null); list.reload(); }
    catch (e) { setErrs({ ...e.fields, _: e.message }); } finally { setBusy(false); }
  };
  const toggle = (u) => run(u.id, async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); list.reload(); }, u.active ? 'User disabled' : 'User enabled');
  return (
    <>
      <PageHeader title="Users & access" subtitle="Admins configure the system; staff run day-to-day billing; customers use the portal"
        actions={<Button icon={Plus} onClick={() => { setErrs({}); setF({ name: '', email: '', password: '', role: 'staff', customer_id: '' }); }}>New user</Button>} />
      <div className="card overflow-hidden">
        <Table loading={list.loading} rows={list.data} columns={[
          { key: 'name', label: 'User', render: (u) => <><div className="font-medium text-slate-900">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div></> },
          { key: 'role', label: 'Role', render: (u) => <Badge status={u.role} /> },
          { key: 'customer_name', label: 'Customer account', render: (u) => u.customer_name || '—' },
          { key: 'active', label: 'Status', render: (u) => <Badge status={u.active ? 'live' : 'inactive'}>{u.active ? 'Active' : 'Disabled'}</Badge> },
          { key: 'x', label: '', align: 'right', render: (u) => u.id !== me.id && <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</Button> },
        ]} />
      </div>
      <Modal open={!!f} onClose={() => setF(null)} title="New user" footer={<><Button variant="secondary" onClick={() => setF(null)}>Cancel</Button><Button onClick={save} loading={busy}>Create user</Button></>}>
        {f && <div className="space-y-4">
          <ErrorBanner error={errs._} />
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="staff">Internal staff</option><option value="admin">Admin</option><option value="customer">Customer (portal)</option></Select></Field>
          {f.role === 'customer' && <Field label="Customer account" error={errs.customer_id}><CustomerPicker value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} error={errs.customer_id} /></Field>}
          <Field label="Full name" error={errs.name}><Input value={f.name} error={errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" error={errs.email}><Input type="email" value={f.email} error={errs.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Initial password" error={errs.password}><Input type="password" value={f.password} error={errs.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><PasswordMeter value={f.password} /></Field>
        </div>}
      </Modal>
    </>
  );
}

export function Operations() {
  const runs = useApi('/billing/runs');
  const outbox = useApi('/outbox');
  const { run, busy } = useAction();
  const [result, setResult] = useState(null);
  const [mail, setMail] = useState(null);
  const bill = () => run('bill', async () => { setResult(await api('/billing/run', { method: 'POST' })); runs.reload(); }, 'Billing run complete');
  return (
    <>
      <PageHeader title="Billing & email" subtitle="The scheduler runs hourly; you can also trigger a run manually. Runs are idempotent." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Batch invoicing" actions={<Button icon={Play} loading={busy === 'bill'} onClick={bill}>Run billing now</Button>} padded={false}>
          {result && <div className="m-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Activated {result.activated} · created {result.invoices_created} invoice(s) · renewed {result.subscriptions_renewed} · closed {result.subscriptions_closed}</div>}
          <Table rows={runs.data} empty="No runs yet" columns={[
            { key: 'started_at', label: 'Started', render: (r) => new Date(r.started_at + 'Z').toLocaleString('en-IN') },
            { key: 'run_date', label: 'As of' },
            { key: 'invoices_created', label: 'Invoices', align: 'right' },
            { key: 'subscriptions_renewed', label: 'Renewed', align: 'right' },
            { key: 'subscriptions_closed', label: 'Closed', align: 'right' },
          ]} />
        </Card>
        <Card title="Email outbox" padded={false} actions={<span className="text-xs text-slate-500">Local log of all sent mail</span>}>
          <Table rows={outbox.data} empty="No emails sent yet" onRowClick={setMail} columns={[
            { key: 'subject', label: 'Subject', render: (m) => <><div className="font-medium text-slate-900">{m.subject}</div><div className="text-xs text-slate-500">{m.to_address}</div></> },
            { key: 'delivered', label: 'SMTP', render: (m) => <Badge status={m.delivered ? 'live' : 'draft'}>{m.delivered ? 'Sent' : 'Logged'}</Badge> },
            { key: 'created_at', label: 'When', render: (m) => new Date(m.created_at + 'Z').toLocaleString('en-IN') },
          ]} />
        </Card>
      </div>
      <Modal wide open={!!mail} onClose={() => setMail(null)} title={mail?.subject}>
        {mail && <iframe title="email" className="h-[60vh] w-full rounded-lg border border-slate-200" sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcDoc={mail.html} />}
      </Modal>
    </>
  );
}
