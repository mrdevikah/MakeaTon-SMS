import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Check, FilePlus2, Pause, Pencil, Play, Plus, Receipt, Send, Trash2, Undo2, Zap } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { date, money, periodLabel, today } from '../lib/format.js';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Table, Textarea, cx, useAction } from '../components/ui.jsx';
import { CustomerPicker } from '../components/pickers.jsx';

const STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'closed'];

export const StatusPipeline = ({ status, paused }) => (
  <ol className="flex flex-wrap items-center gap-1 text-xs">
    {STATUSES.map((s, i) => {
      const idx = STATUSES.indexOf(status);
      return (
        <li key={s} className="flex items-center gap-1">
          <span className={cx('rounded-full px-2.5 py-1 font-medium capitalize', i < idx ? 'bg-brand-50 text-brand-600' : i === idx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400')}>
            {s}{s === 'active' && paused && i === idx ? ' · paused' : ''}</span>
          {i < STATUSES.length - 1 && <span className="h-px w-3 bg-slate-300" />}
        </li>);
    })}
  </ol>
);

export function SubscriptionList() {
  const { internal } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [term, setTerm] = useState(sp.get('q') || '');
  const q = useDebounced(term);
  const status = sp.get('status') || '';
  const page = Number(sp.get('page') || 1);
  useEffect(() => { if (q !== (sp.get('q') || '')) setSp((p) => { p.set('q', q); p.delete('page'); return p; }); }, [q]); // eslint-disable-line
  const { data, error, loading } = useApi('/subscriptions' + qs({ status, q, page, pageSize: 20 }));
  const set = (k, v) => setSp((p) => { v ? p.set(k, v) : p.delete(k); if (k !== 'page') p.delete('page'); return p; });

  return (
    <>
      <PageHeader title={internal ? 'Subscriptions' : 'My subscriptions'} subtitle={internal ? 'Quotes and recurring contracts across all customers' : 'Your plans with Brightloop'}
        actions={internal && <Button icon={Plus} onClick={() => nav('/subscriptions/new')}>New subscription</Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {['', ...STATUSES].map((s) => (
            <button key={s} onClick={() => set('status', s)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium capitalize', status === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{s || 'All'}</button>
          ))}
        </div>
        <Input className="sm:max-w-xs" placeholder="Search number or customer…" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <ErrorBanner error={error} />
      <div className="card overflow-hidden">
        <Table loading={loading} rows={data?.rows} onRowClick={(r) => nav(`/subscriptions/${r.id}`)} empty="No subscriptions match these filters" columns={[
          { key: 'number', label: 'Number', render: (r) => <span className="font-medium text-slate-900">{r.number}</span> },
          ...(internal ? [{ key: 'customer_name', label: 'Customer' }] : []),
          { key: 'plan', label: 'Plan', render: (r) => <><div>{r.plan_name}</div><div className="text-xs text-slate-500">{periodLabel(r.billing_period)}</div></> },
          { key: 'status', label: 'Status', render: (r) => <div className="flex gap-1"><Badge status={r.status} />{r.paused ? <Badge status="paused" /> : null}</div> },
          { key: 'start_date', label: 'Start', render: (r) => date(r.start_date) },
          { key: 'next', label: 'Next invoice', render: (r) => (r.status === 'active' && !r.paused ? date(r.next_invoice_date) : r.status === 'quotation' ? <span className="text-xs text-slate-500">Quote valid to {date(r.quote_valid_until)}</span> : '—') },
          { key: 'recurring_total', label: 'Per cycle (incl. tax)', align: 'right', render: (r) => money(r.recurring_total) },
        ]} />
        {data && <Pagination page={page} pageSize={20} total={data.total} onPage={(p) => set('page', p)} />}
      </div>
    </>
  );
}

// ---------------- Editor ----------------
function LineEditor({ line, products, onChange, onRemove, error }) {
  const product = products.find((p) => p.id === Number(line.product_id));
  const unit = product ? product.sales_price + product.attributes.reduce((s, a) => s + (a.values.find((v) => line.variant_value_ids.includes(v.id))?.extra_price || 0), 0) : 0;
  const pickVariant = (attr, valueId) => {
    const others = line.variant_value_ids.filter((id) => !attr.values.some((v) => v.id === id));
    onChange({ ...line, variant_value_ids: valueId ? [...others, Number(valueId)] : others });
  };
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="grid grid-cols-12 gap-3">
        <Field label="Product" className="col-span-12 sm:col-span-6">
          <Select value={line.product_id} onChange={(e) => {
            const p = products.find((x) => x.id === Number(e.target.value));
            onChange({ ...line, product_id: e.target.value, variant_value_ids: p ? p.attributes.map((a) => a.values[0].id) : [] });
          }}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.sales_price)}</option>)}
          </Select>
        </Field>
        <Field label="Qty" className="col-span-4 sm:col-span-2" error={error}><Input type="number" min="1" value={line.quantity} error={error} onChange={(e) => onChange({ ...line, quantity: e.target.value })} /></Field>
        <div className="col-span-6 sm:col-span-3"><span className="mb-1 block text-sm font-medium text-slate-700">Amount</span>
          <div className="py-2 text-sm tabular-nums"><span className="font-medium">{money(unit * (Number(line.quantity) || 0))}</span><span className="ml-1 text-xs text-slate-500">({money(unit)} ea)</span></div></div>
        <div className="col-span-2 flex items-end justify-end sm:col-span-1"><Button type="button" variant="ghost" icon={Trash2} onClick={onRemove} aria-label="Remove line" /></div>
      </div>
      {product?.attributes.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {product.attributes.map((a) => (
            <Field key={a.id} label={a.name}>
              <Select value={a.values.find((v) => line.variant_value_ids.includes(v.id))?.id || ''} onChange={(e) => pickVariant(a, e.target.value)}>
                {a.values.map((v) => <option key={v.id} value={v.id}>{v.value}{v.extra_price ? ` (+${money(v.extra_price)})` : ''}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}

export function SubscriptionForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const products = useApi('/products?withVariants=1').data || [];
  const plans = useApi('/plans?available=1').data || [];
  const templates = useApi('/templates').data || [];
  const existing = useApi(id ? `/subscriptions/${id}` : null).data;
  const [f, setF] = useState({ customer_id: '', plan_id: '', template_id: '', start_date: today(), expiry_date: '', payment_terms_days: 15, notes: '', lines: [{ product_id: '', quantity: 1, variant_value_ids: [] }] });
  const [errs, setErrs] = useState({});
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (existing) setF({ customer_id: existing.customer_id, plan_id: existing.plan_id, template_id: existing.template_id || '', start_date: existing.start_date,
      expiry_date: existing.expiry_date || '', payment_terms_days: existing.payment_terms_days, notes: existing.notes || '',
      lines: existing.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, variant_value_ids: l.variant_value_ids })) });
  }, [existing]);

  const plan = plans.find((p) => p.id === Number(f.plan_id));
  const applyTemplate = (tid) => {
    const t = templates.find((x) => x.id === Number(tid));
    if (!t) return setF({ ...f, template_id: '' });
    setF({ ...f, template_id: t.id, plan_id: t.plan_id || f.plan_id, payment_terms_days: t.payment_terms_days, notes: t.notes || f.notes,
      lines: t.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, variant_value_ids: l.variant_value_ids })) });
  };
  const subtotal = useMemo(() => f.lines.reduce((s, l) => {
    const p = products.find((x) => x.id === Number(l.product_id));
    if (!p) return s;
    return s + (Number(l.quantity) || 0) * (p.sales_price + p.attributes.reduce((a, at) => a + (at.values.find((v) => l.variant_value_ids.includes(v.id))?.extra_price || 0), 0));
  }, 0), [f.lines, products]);

  const submit = async (e) => {
    e.preventDefault();
    const v = {};
    if (!f.customer_id) v.customer_id = 'Choose a customer';
    if (!f.plan_id) v.plan_id = 'Choose a plan';
    if (!f.start_date) v.start_date = 'Required';
    if (f.expiry_date && f.expiry_date <= f.start_date) v.expiry_date = 'Must be after start date';
    if (!f.lines.length || f.lines.some((l) => !l.product_id)) v.lines = 'Every line needs a product';
    f.lines.forEach((l, i) => { if (!(Number(l.quantity) >= (plan?.min_quantity || 1))) v[`lines.${i}.quantity`] = `Min ${plan?.min_quantity || 1}`; });
    setErrs(v); if (Object.keys(v).length) return;
    setErr(null);
    const body = { ...f, template_id: f.template_id || null, expiry_date: f.expiry_date || null,
      lines: f.lines.map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), variant_value_ids: l.variant_value_ids })) };
    try {
      const r = await api(id ? `/subscriptions/${id}` : '/subscriptions', { method: id ? 'PUT' : 'POST', body });
      nav(`/subscriptions/${r.id}`);
    } catch (e2) { setErr(e2); setErrs(e2.fields); }
  };

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={id ? `Edit ${existing?.number || ''}` : 'New subscription'} subtitle="Saved as a draft — send it as a quotation when ready."
        back={<Link to={id ? `/subscriptions/${id}` : '/subscriptions'} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Back</Link>}
        actions={<Button type="submit" loading={busy}>Save draft</Button>} />
      <ErrorBanner error={err} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Line items" actions={<Button type="button" size="sm" variant="secondary" icon={Plus} onClick={() => setF({ ...f, lines: [...f.lines, { product_id: '', quantity: plan?.min_quantity || 1, variant_value_ids: [] }] })}>Add line</Button>}>
            {errs.lines && <p className="mb-3 text-sm text-rose-600">{errs.lines}</p>}
            <div className="space-y-3">
              {f.lines.map((l, i) => (
                <LineEditor key={i} line={l} products={products} error={errs[`lines.${i}.quantity`]}
                  onChange={(nl) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? nl : x)) })}
                  onRemove={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />
              ))}
            </div>
            <div className="mt-4 flex justify-between border-t border-slate-100 pt-4 text-sm"><span className="text-slate-500">Subtotal per cycle (before tax &amp; discounts)</span><span className="font-semibold tabular-nums">{money(subtotal)}</span></div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Details">
            <div className="space-y-4">
              <Field label="Start from template" hint="Pre-fills plan, lines and terms"><Select value={f.template_id} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— None —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              <Field label="Customer" error={errs.customer_id}><CustomerPicker value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} error={errs.customer_id} /></Field>
              <Field label="Plan" error={errs.plan_id} hint={plan && `${periodLabel(plan.billing_period, plan.interval_count)} · min qty ${plan.min_quantity}${plan.duration_cycles ? ` · ${plan.duration_cycles} cycles` : ''}`}>
                <Select value={f.plan_id} error={errs.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })}><option value="">Select plan…</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date" error={errs.start_date}><Input type="date" value={f.start_date} error={errs.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
                <Field label="Expiry" error={errs.expiry_date} hint={!f.expiry_date && plan?.duration_cycles ? 'Auto from plan' : undefined}><Input type="date" value={f.expiry_date} error={errs.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
              </div>
              <Field label="Payment terms (days)" error={errs.payment_terms_days}><Input type="number" min="0" value={f.payment_terms_days} onChange={(e) => setF({ ...f, payment_terms_days: e.target.value })} /></Field>
              <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}

// ---------------- Detail ----------------
const ACTION_META = {
  send_quote: { label: 'Send quotation', icon: Send, variant: 'primary' },
  confirm: { label: 'Confirm', icon: Check, variant: 'primary' },
  revert_draft: { label: 'Back to draft', icon: Undo2, variant: 'secondary' },
  activate: { label: 'Activate', icon: Zap, variant: 'success' },
  invoice_now: { label: 'Invoice next cycle', icon: FilePlus2, variant: 'secondary' },
  pause: { label: 'Pause', icon: Pause, variant: 'secondary' },
  resume: { label: 'Resume', icon: Play, variant: 'success' },
  close: { label: 'Close', icon: Ban, variant: 'danger' },
};

export function SubscriptionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, internal } = useAuth();
  const { data: s, error, reload, setData } = useApi(`/subscriptions/${id}`);
  const { run, busy } = useAction();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');

  if (error) return <ErrorBanner error={error} />;
  if (!s) return <div className="h-64 animate-pulse rounded-xl bg-white" />;

  const customerActions = { quotation: ['confirm'], active: ['pause', 'resume', 'close'] }[s.status] || [];
  const actions = s.actions.filter((a) => internal || customerActions.includes(a));
  const act = (a, body) => run(a, async () => setData(await api(`/subscriptions/${id}/${a}`, { method: 'POST', body })), `${ACTION_META[a].label} — done`);

  return (
    <>
      <PageHeader title={s.number} subtitle={internal ? `${s.customer_name} · ${s.customer_email}` : s.plan_name}
        back={<Link to="/subscriptions" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Subscriptions</Link>}
        actions={<>
          {internal && s.status === 'draft' && <Button variant="secondary" icon={Pencil} onClick={() => nav(`/subscriptions/${id}/edit`)}>Edit</Button>}
          {actions.map((a) => {
            const m = ACTION_META[a];
            const label = !internal && a === 'confirm' ? 'Accept quotation' : m.label;
            return <Button key={a} variant={m.variant} icon={m.icon} loading={busy === a} onClick={() => (a === 'close' ? setClosing(true) : act(a))}>{label}</Button>;
          })}
        </>} />

      <div className="card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <StatusPipeline status={s.status} paused={s.paused} />
        {s.status === 'quotation' && <span className="text-sm text-slate-500">Quotation valid until <b className="text-slate-800">{date(s.quote_valid_until)}</b></span>}
        {s.status === 'closed' && <span className="text-sm text-slate-500">Closed · {s.closed_reason}</span>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Line items" padded={false}>
            <Table rows={[...s.pricing.lines, ...s.pricing.discountLines]} columns={[
              { key: 'description', label: 'Product', className: 'whitespace-normal min-w-[14rem]', render: (l) => <span className={l.discount_id ? 'text-emerald-700' : 'font-medium text-slate-900'}>{l.description}</span> },
              { key: 'quantity', label: 'Qty', align: 'right' },
              { key: 'unit_price', label: 'Unit price', align: 'right', render: (l) => money(l.unit_price) },
              { key: 'tax', label: 'Tax', align: 'right', render: (l) => <span className="text-slate-500">{money(l.tax_amount)}{l.tax_name ? <span className="ml-1 text-xs">({l.tax_rate}%)</span> : ''}</span> },
              { key: 'total', label: 'Line total', align: 'right', render: (l) => <span className={l.discount_id ? 'text-emerald-700' : ''}>{money(l.amount + l.tax_amount)}</span> },
            ]} />
            <dl className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{money(s.pricing.subtotal)}</dd></div>
              {s.pricing.discount_total > 0 && <div className="flex justify-between text-emerald-700"><dt>Discounts</dt><dd className="tabular-nums">−{money(s.pricing.discount_total)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="tabular-nums">{money(s.pricing.tax_total)}</dd></div>
              <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total per cycle</dt><dd className="tabular-nums">{money(s.pricing.total)}</dd></div>
            </dl>
            {s.pricing.discountLines.length > 0 && <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Discounts shown are those currently eligible; they're applied automatically on each invoice while valid and within usage limits.</p>}
          </Card>
          <Card title="Invoices" padded={false}>
            <Table rows={s.invoices.filter((i) => internal || i.status !== 'draft')} onRowClick={(r) => nav(`/invoices/${r.id}`)} empty="No invoices yet — they're generated on each billing day." columns={[
              { key: 'number', label: 'Invoice', render: (r) => <span className="font-medium text-slate-900">{r.number}</span> },
              { key: 'period', label: 'Period', render: (r) => `${date(r.period_start)} – ${date(r.period_end)}` },
              { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
              { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) },
            ]} />
          </Card>
        </div>
        <Card title="Summary">
          <dl className="space-y-3 text-sm">
            {[
              ['Customer', s.customer_name], ['Plan', s.plan_name], ['Billing', periodLabel(s.billing_period, s.interval_count)],
              ['Start date', date(s.start_date)], ['Expiry date', s.expiry_date ? date(s.expiry_date) : 'Open-ended'],
              ['Next invoice', s.status === 'active' && !s.paused ? date(s.next_invoice_date) : '—'], ['Cycles billed', s.cycles_billed],
              ['Payment terms', `${s.payment_terms_days} days`], ['Template', s.template_name || '—'],
            ].map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800">{v}</dd></div>)}
          </dl>
          <div className="mt-5 flex flex-wrap gap-1.5 border-t border-slate-100 pt-4">
            {s.renewable ? <Badge status="active">Auto-renews</Badge> : null}
            {s.auto_close && !s.renewable ? <Badge status="draft">Auto-closes at end</Badge> : null}
            {s.pausable ? <Badge status="paused">Pausable</Badge> : null}
            {!s.closable ? <Badge status="cancelled">No early closure</Badge> : null}
          </div>
          {s.notes && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{s.notes}</p>}
        </Card>
      </div>

      <Modal open={closing} onClose={() => setClosing(false)} title={`Close ${s.number}?`} footer={<>
        <Button variant="secondary" onClick={() => setClosing(false)}>Keep it</Button>
        <Button variant="danger" loading={busy === 'close'} onClick={async () => { await act('close', { reason: reason || undefined }); setClosing(false); }}>Close subscription</Button></>}>
        <p className="text-sm text-slate-600">{s.status === 'active' ? 'Billing stops immediately. Already-issued invoices remain payable.' : 'This cancels the quote.'}</p>
        {!s.closable && s.status === 'active' && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">This plan doesn't allow early closure{user.role === 'admin' ? ' — you can override as admin.' : '.'}</p>}
        <Field label="Reason (optional)" className="mt-4"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
