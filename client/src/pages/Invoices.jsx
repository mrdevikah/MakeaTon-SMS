import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, Mail, Printer, Undo2, Wallet } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { METHODS, date, money, today } from '../lib/format.js';
import { check, rules } from '../lib/validate.js';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Table, Textarea, cx, useAction } from '../components/ui.jsx';
import { Logo } from '../components/Layout.jsx';

const invStatus = (r) => (r.overdue ? 'overdue' : r.status);

export function InvoiceList() {
  const { internal } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [term, setTerm] = useState(sp.get('q') || '');
  const q = useDebounced(term);
  const status = sp.get('status') || '';
  const page = Number(sp.get('page') || 1);
  const set = (k, v) => setSp((p) => { v ? p.set(k, v) : p.delete(k); if (k !== 'page') p.delete('page'); return p; });
  useEffect(() => { if (q !== (sp.get('q') || '')) set('q', q); }, [q]); // eslint-disable-line
  const { data, error, loading } = useApi('/invoices' + qs({ status, q, page, pageSize: 20, from: sp.get('from'), to: sp.get('to') }));
  const tabs = internal ? ['', 'draft', 'confirmed', 'overdue', 'paid', 'cancelled'] : ['', 'confirmed', 'overdue', 'paid'];

  return (
    <>
      <PageHeader title={internal ? 'Invoices' : 'My invoices'} subtitle={internal ? 'Generated automatically on each billing day' : 'Download, print or review what you owe'} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map((s) => <button key={s} onClick={() => set('status', s)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium capitalize', status === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{s || 'All'}</button>)}
        </div>
        <div className="flex flex-1 flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Search number or customer…" value={term} onChange={(e) => setTerm(e.target.value)} />
          <Input type="date" className="w-40" value={sp.get('from') || ''} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
          <Input type="date" className="w-40" value={sp.get('to') || ''} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
        </div>
      </div>
      <ErrorBanner error={error} />
      <div className="card overflow-hidden">
        <Table loading={loading} rows={data?.rows} onRowClick={(r) => nav(`/invoices/${r.id}`)} empty="No invoices match these filters" columns={[
          { key: 'number', label: 'Invoice', render: (r) => <span className="font-medium text-slate-900">{r.number}</span> },
          ...(internal ? [{ key: 'customer_name', label: 'Customer' }] : []),
          { key: 'subscription_number', label: 'Subscription', render: (r) => <span className="text-slate-500">{r.subscription_number || '—'}</span> },
          { key: 'invoice_date', label: 'Date', render: (r) => date(r.invoice_date) },
          { key: 'due_date', label: 'Due', render: (r) => <span className={r.overdue ? 'text-rose-600' : ''}>{date(r.due_date)}</span> },
          { key: 'status', label: 'Status', render: (r) => <Badge status={invStatus(r)} /> },
          { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) },
          { key: 'balance', label: 'Balance', align: 'right', render: (r) => (r.status === 'cancelled' ? '—' : money(r.total - r.amount_paid)) },
        ]} />
        {data && <Pagination page={page} pageSize={20} total={data.total} onPage={(p) => set('page', p)} />}
      </div>
    </>
  );
}

export function PaymentModal({ invoice, open, onClose, onSaved }) {
  const [f, setF] = useState({ method: 'bank_transfer', date: today(), amount: '', notes: '' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ method: 'bank_transfer', date: today(), amount: invoice.balance, notes: '' }); }, [open, invoice]);
  const submit = async (e) => {
    e.preventDefault();
    const v = check({ method: [rules.required], date: [rules.required], amount: [rules.positive, rules.max(invoice.balance)] }, f);
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try { const r = await api('/payments', { method: 'POST', body: { ...f, invoice_id: invoice.id, amount: Number(f.amount) } }); onSaved(r.invoice); onClose(); }
    catch (e2) { setErrs({ ...e2.fields, _: e2.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Record payment · ${invoice.number}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Record payment</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errs._ && <ErrorBanner error={errs._} />}
        <div className="rounded-lg bg-slate-50 p-3 text-sm">Outstanding balance <b className="float-right tabular-nums">{money(invoice.balance)}</b></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method" error={errs.method}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Date" error={errs.date}><Input type="date" value={f.date} max={today()} error={errs.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Amount" error={errs.amount} hint="Partial payments are allowed"><Input type="number" step="0.01" min="0.01" value={f.amount} error={errs.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Notes" error={errs.notes}><Textarea value={f.notes} placeholder="Reference number, cheque no., etc." onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { internal } = useAuth();
  const { data: inv, error, setData } = useApi(`/invoices/${id}`);
  const { run, busy } = useAction();
  const [paying, setPaying] = useState(false);
  if (error) return <ErrorBanner error={error} />;
  if (!inv) return <div className="h-96 animate-pulse rounded-xl bg-white" />;
  const act = (a, msg) => run(a, async () => setData(await api(`/invoices/${id}/${a}`, { method: 'POST' })), msg);
  const status = inv.overdue ? 'overdue' : inv.status;

  return (
    <>
      <PageHeader title={inv.number} subtitle={`${inv.customer_name}${inv.subscription_number ? ` · ${inv.subscription_number}` : ''}`}
        back={<Link to="/invoices" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Invoices</Link>}
        actions={<>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button>
          {internal && inv.status === 'draft' && <Button icon={CheckCircle2} loading={busy === 'confirm'} onClick={() => act('confirm', 'Invoice confirmed')}>Confirm</Button>}
          {internal && ['confirmed', 'paid'].includes(inv.status) && <Button variant="secondary" icon={Mail} loading={busy === 'email'} onClick={() => act('email', `Emailed to ${inv.customer_email}`)}>{inv.emailed_at ? 'Resend email' : 'Email'}</Button>}
          {internal && inv.status === 'confirmed' && inv.balance > 0 && <Button variant="success" icon={Wallet} onClick={() => setPaying(true)}>Record payment</Button>}
          {internal && inv.status === 'confirmed' && inv.amount_paid === 0 && <Button variant="ghost" icon={Undo2} loading={busy === 'reset_draft'} onClick={() => act('reset_draft', 'Moved back to draft')}>To draft</Button>}
          {internal && ['draft', 'confirmed'].includes(inv.status) && inv.amount_paid === 0 && <Button variant="ghost" icon={Ban} className="text-rose-600" loading={busy === 'cancel'} onClick={() => confirm('Cancel this invoice? Any discount usage it consumed will be released.') && act('cancel', 'Invoice cancelled')}>Cancel</Button>}
        </>} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <article className="card print-area p-6 sm:p-10 xl:col-span-2">
          <div className="flex flex-col justify-between gap-6 sm:flex-row">
            <div><Logo className="text-lg text-slate-900" /><p className="mt-2 text-xs leading-relaxed text-slate-500">Brightloop Software Pvt. Ltd.<br />Infopark Phase 2, Kakkanad<br />Kochi, Kerala 682042 · GSTIN 32ABCDE1234F1Z5</p></div>
            <div className="sm:text-right"><div className="text-2xl font-semibold tracking-tight text-slate-900">Invoice</div><div className="mt-1 text-sm text-slate-500">{inv.number}</div><div className="mt-2"><Badge status={status} /></div></div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-6 text-sm sm:grid-cols-4">
            <div className="col-span-2"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Bill to</div><div className="mt-1 font-medium text-slate-900">{inv.customer_name}</div><div className="text-slate-500">{inv.customer_email}</div>{inv.customer_address && <div className="text-slate-500">{inv.customer_address}</div>}</div>
            <div><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Issued</div><div className="mt-1">{date(inv.invoice_date)}</div><div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">Due</div><div className={cx('mt-1', inv.overdue && 'font-medium text-rose-600')}>{date(inv.due_date)}</div></div>
            {inv.period_start && <div><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Service period</div><div className="mt-1">{date(inv.period_start)}<br />to {date(inv.period_end)}</div></div>}
          </div>
          <div className="-mx-6 mt-8 sm:-mx-10">
            <Table rows={inv.lines} columns={[
              { key: 'description', label: 'Description', className: 'sm:pl-10 whitespace-normal min-w-[14rem]', render: (l) => <span className={l.discount_id ? 'text-emerald-700' : 'text-slate-900'}>{l.description}</span> },
              { key: 'quantity', label: 'Qty', align: 'right' },
              { key: 'unit_price', label: 'Unit price', align: 'right', render: (l) => money(l.unit_price) },
              { key: 'tax', label: 'Tax', align: 'right', render: (l) => <span className="text-slate-500">{money(l.tax_amount)} <span className="text-xs">({+l.tax_rate.toFixed(2)}%)</span></span> },
              { key: 'line_total', label: 'Amount', align: 'right', className: 'sm:pr-10', render: (l) => money(l.line_total + l.tax_amount) },
            ]} />
          </div>
          <dl className="ml-auto mt-6 max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{money(inv.subtotal)}</dd></div>
            {inv.discount_total > 0 && <div className="flex justify-between text-emerald-700"><dt>Discounts</dt><dd className="tabular-nums">−{money(inv.discount_total)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="tabular-nums">{money(inv.tax_total)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(inv.total)}</dd></div>
            <div className="flex justify-between text-slate-500"><dt>Paid</dt><dd className="tabular-nums">{money(inv.amount_paid)}</dd></div>
            <div className="flex justify-between rounded-lg bg-slate-50 px-2 py-1.5 font-semibold"><dt>Balance due</dt><dd className="tabular-nums">{money(inv.balance)}</dd></div>
          </dl>
          <p className="mt-10 text-xs text-slate-400">Pay by bank transfer to HDFC Bank A/C ••••6620 (IFSC HDFC0001234) or UPI brightloop@hdfcbank, quoting {inv.number}.</p>
        </article>
        <Card title="Payments" className="no-print h-fit" padded={false}>
          {inv.payments.length ? (
            <ul className="divide-y divide-slate-100">{inv.payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between px-5 py-3 text-sm"><div><div className="font-medium text-slate-800">{METHODS[p.method]}</div><div className="text-xs text-slate-500">{date(p.date)}{p.notes ? ` · ${p.notes}` : ''}</div></div><div className="font-medium tabular-nums text-emerald-700">{money(p.amount)}</div></li>
            ))}</ul>
          ) : <p className="px-5 py-6 text-sm text-slate-500">No payments recorded.</p>}
          {inv.emailed_at && <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Last emailed {new Date(inv.emailed_at + 'Z').toLocaleString('en-IN')}</p>}
        </Card>
      </div>
      {internal && <PaymentModal invoice={inv} open={paying} onClose={() => setPaying(false)} onSaved={setData} />}
    </>
  );
}

export function Payments() {
  const { internal } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ method: '', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q);
  const { data, error, loading } = useApi('/payments' + qs({ ...f, q, page, pageSize: 25 }));
  const upd = (k, v) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title={internal ? 'Payments' : 'Payment history'} subtitle={data ? `${data.total.toLocaleString()} payments · ${money(data.sum)} total` : ' '} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search invoice or customer…" value={f.q} onChange={(e) => upd('q', e.target.value)} />
        <Select className="w-44" value={f.method} onChange={(e) => upd('method', e.target.value)}><option value="">All methods</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input type="date" className="w-40" value={f.from} onChange={(e) => upd('from', e.target.value)} aria-label="From" />
        <Input type="date" className="w-40" value={f.to} onChange={(e) => upd('to', e.target.value)} aria-label="To" />
      </div>
      <ErrorBanner error={error} />
      <div className="card overflow-hidden">
        <Table loading={loading} rows={data?.rows} onRowClick={(r) => nav(`/invoices/${r.invoice_id}`)} columns={[
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'invoice_number', label: 'Invoice', render: (r) => <span className="font-medium text-slate-900">{r.invoice_number}</span> },
          ...(internal ? [{ key: 'customer_name', label: 'Customer' }] : []),
          { key: 'method', label: 'Method', render: (r) => METHODS[r.method] },
          { key: 'notes', label: 'Notes', render: (r) => <span className="text-slate-500">{r.notes || '—'}</span> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-medium text-emerald-700">{money(r.amount)}</span> },
        ]} />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </div>
    </>
  );
}
