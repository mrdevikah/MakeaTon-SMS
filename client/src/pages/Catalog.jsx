import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { date, money, periodLabel, titleCase } from '../lib/format.js';
import { check, rules } from '../lib/validate.js';
import { Badge, Button, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Table, Textarea, Toggle, useToast } from '../components/ui.jsx';
import { PasswordMeter } from './Auth.jsx';

/** Shared create/edit modal state: validates client-side, maps server field errors back onto inputs. */
function useEditor(blank, { path, spec, toBody = (x) => x, onSaved }) {
  const toast = useToast();
  const [item, setItem] = useState(null);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const open = (x) => { setErrs({}); setItem(x ? { ...blank, ...x } : { ...blank }); };
  const set = (k, v) => setItem((i) => ({ ...i, [k]: v }));
  const save = async () => {
    const v = spec ? check(spec, item) : {};
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await api(item.id ? `${path}/${item.id}` : path, { method: item.id ? 'PUT' : 'POST', body: toBody(item) });
      toast(item.id ? 'Saved' : 'Created'); setItem(null); onSaved();
    } catch (e) { setErrs({ ...e.fields, _: e.message }); } finally { setBusy(false); }
  };
  return { item, errs, busy, open, set, save, close: () => setItem(null) };
}

const nullIfEmpty = (o, keys) => ({ ...o, ...Object.fromEntries(keys.map((k) => [k, o[k] === '' || o[k] === undefined ? null : o[k]])) });
const Footer = ({ ed, label = 'Save' }) => <><Button variant="secondary" onClick={ed.close}>Cancel</Button><Button onClick={ed.save} loading={ed.busy}>{label}</Button></>;

// ---------------- Customers ----------------
export function Customers() {
  const [term, setTerm] = useState(''); const q = useDebounced(term);
  const [page, setPage] = useState(1);
  const list = useApi('/customers' + qs({ q, page, pageSize: 25 }));
  const ed = useEditor({ name: '', email: '', phone: '', address: '', create_login: false, password: '' }, {
    path: '/customers', onSaved: list.reload,
    spec: { name: [rules.required], email: [rules.required, rules.email], password: [(v, o) => (o.create_login && !o.id ? rules.password(v) : null)] },
    toBody: (c) => ({ ...c, password: c.create_login ? c.password : undefined }),
  });
  return (
    <>
      <PageHeader title="Customers" subtitle="Accounts billed by Brightloop" actions={<Button icon={Plus} onClick={() => ed.open()}>New customer</Button>} />
      <Input className="mb-4 max-w-xs" placeholder="Search name or email…" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} />
      <div className="card overflow-hidden">
        <Table loading={list.loading} rows={list.data?.rows} onRowClick={(r) => ed.open(r)} columns={[
          { key: 'name', label: 'Name', render: (r) => <><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.email}</div></> },
          { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
          { key: 'active_subscriptions', label: 'Active subs', align: 'right' },
          { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => <span className={r.outstanding > 0 ? 'text-amber-700' : 'text-slate-400'}>{money(r.outstanding)}</span> },
          { key: 'has_login', label: 'Portal', render: (r) => (r.has_login ? <Badge status="active">Login</Badge> : <span className="text-xs text-slate-400">—</span>) },
        ]} />
        {list.data && <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />}
      </div>
      <Modal open={!!ed.item} onClose={ed.close} title={ed.item?.id ? 'Edit customer' : 'New customer'} footer={<Footer ed={ed} />}>
        {ed.item && <div className="space-y-4">
          <ErrorBanner error={ed.errs._} />
          <Field label="Name" error={ed.errs.name}><Input value={ed.item.name} error={ed.errs.name} onChange={(e) => ed.set('name', e.target.value)} /></Field>
          <Field label="Billing email" error={ed.errs.email}><Input type="email" value={ed.item.email} error={ed.errs.email} onChange={(e) => ed.set('email', e.target.value)} /></Field>
          <Field label="Phone" error={ed.errs.phone}><Input value={ed.item.phone || ''} onChange={(e) => ed.set('phone', e.target.value)} /></Field>
          <Field label="Address"><Textarea value={ed.item.address || ''} onChange={(e) => ed.set('address', e.target.value)} /></Field>
          {!ed.item.id && <>
            <Toggle checked={ed.item.create_login} onChange={(v) => ed.set('create_login', v)} label="Create customer-portal login" hint="Lets the customer view their subscriptions and invoices" />
            {ed.item.create_login && <Field label="Initial password" error={ed.errs.password}><Input type="password" value={ed.item.password} error={ed.errs.password} onChange={(e) => ed.set('password', e.target.value)} /><PasswordMeter value={ed.item.password} /></Field>}
          </>}
        </div>}
      </Modal>
    </>
  );
}

// ---------------- Products ----------------
export function Products() {
  const { can } = useAuth();
  const admin = can('admin');
  const list = useApi('/products?active=all&withVariants=1');
  const taxes = useApi(admin ? '/taxes' : null).data || [];
  const ed = useEditor({ name: '', type: 'software', sales_price: '', cost_price: 0, notes: '', tax_id: '', active: true, attributes: [] }, {
    path: '/products', onSaved: list.reload,
    spec: { name: [rules.required], sales_price: [rules.min(0)], cost_price: [rules.min(0)] },
    toBody: (p) => ({ ...nullIfEmpty(p, ['tax_id']), attributes: p.attributes.map((a) => ({ name: a.name, values: a.values.map((v) => ({ value: v.value, extra_price: Number(v.extra_price) || 0 })) })) }),
  });
  const attrs = ed.item?.attributes || [];
  const setAttrs = (a) => ed.set('attributes', a);
  return (
    <>
      <PageHeader title="Products" subtitle="Sellable items with variant-based pricing" actions={admin && <Button icon={Plus} onClick={() => ed.open()}>New product</Button>} />
      <div className="card overflow-hidden">
        <Table loading={list.loading} rows={list.data} onRowClick={admin ? (r) => ed.open(r) : undefined} columns={[
          { key: 'name', label: 'Product', className: 'whitespace-normal', render: (r) => <><div className="font-medium text-slate-900">{r.name}</div>{r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}</> },
          { key: 'type', label: 'Type', render: (r) => titleCase(r.type) },
          { key: 'variants', label: 'Variants', className: 'whitespace-normal', render: (r) => (r.attributes.length ? <div className="flex flex-wrap gap-1">{r.attributes.flatMap((a) => a.values.filter((v) => v.extra_price).map((v) => <span key={v.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{v.value} +{money(v.extra_price)}</span>))}</div> : <span className="text-slate-400">—</span>) },
          { key: 'tax', label: 'Tax', render: (r) => r.tax_name || <span className="text-xs text-slate-400">By rule</span> },
          { key: 'cost_price', label: 'Cost', align: 'right', render: (r) => money(r.cost_price) },
          { key: 'sales_price', label: 'Price', align: 'right', render: (r) => <span className="font-medium">{money(r.sales_price)}</span> },
          { key: 'active', label: '', render: (r) => (!r.active ? <Badge status="inactive">Archived</Badge> : null) },
        ]} />
      </div>
      <Modal wide open={!!ed.item} onClose={ed.close} title={ed.item?.id ? 'Edit product' : 'New product'} footer={<Footer ed={ed} />}>
        {ed.item && <div className="space-y-4">
          <ErrorBanner error={ed.errs._} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" error={ed.errs.name}><Input value={ed.item.name} error={ed.errs.name} onChange={(e) => ed.set('name', e.target.value)} /></Field>
            <Field label="Type"><Select value={ed.item.type} onChange={(e) => ed.set('type', e.target.value)}><option value="software">Software</option><option value="service">Service</option><option value="goods">Goods</option></Select></Field>
            <Field label="Sales price" error={ed.errs.sales_price}><Input type="number" step="0.01" value={ed.item.sales_price} error={ed.errs.sales_price} onChange={(e) => ed.set('sales_price', e.target.value)} /></Field>
            <Field label="Cost price" error={ed.errs.cost_price}><Input type="number" step="0.01" value={ed.item.cost_price} error={ed.errs.cost_price} onChange={(e) => ed.set('cost_price', e.target.value)} /></Field>
            <Field label="Tax" hint="Leave as 'by rule' to use the tax rule for this product type, or the default"><Select value={ed.item.tax_id || ''} onChange={(e) => ed.set('tax_id', e.target.value)}><option value="">By rule</option>{taxes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <div className="flex items-end pb-2"><Toggle checked={!!ed.item.active} onChange={(v) => ed.set('active', v)} label="Active" /></div>
          </div>
          <Field label="Notes"><Textarea value={ed.item.notes || ''} onChange={(e) => ed.set('notes', e.target.value)} /></Field>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">Variant attributes</span>
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAttrs([...attrs, { name: '', values: [{ value: '', extra_price: 0 }] }])}>Attribute</Button></div>
            {!attrs.length && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No variants. Add an attribute like <b>Brand</b> with values (e.g. Odoo +560) to price options.</p>}
            <div className="space-y-3">{attrs.map((a, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex gap-2"><Input placeholder="Attribute name (e.g. Brand)" value={a.name} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Button variant="ghost" icon={Trash2} onClick={() => setAttrs(attrs.filter((_, j) => j !== i))} aria-label="Remove attribute" /></div>
                <div className="mt-2 space-y-2">{a.values.map((v, k) => (
                  <div key={k} className="flex gap-2">
                    <Input placeholder="Value" value={v.value} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, values: x.values.map((y, m) => (m === k ? { ...y, value: e.target.value } : y)) } : x)))} />
                    <Input className="w-36" type="number" placeholder="+ price" value={v.extra_price} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, values: x.values.map((y, m) => (m === k ? { ...y, extra_price: e.target.value } : y)) } : x)))} />
                    <Button variant="ghost" icon={X} disabled={a.values.length === 1} onClick={() => setAttrs(attrs.map((x, j) => (j === i ? { ...x, values: x.values.filter((_, m) => m !== k) } : x)))} aria-label="Remove value" />
                  </div>))}
                  <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setAttrs(attrs.map((x, j) => (j === i ? { ...x, values: [...x.values, { value: '', extra_price: 0 }] } : x)))}>+ Add value</button>
                </div>
              </div>))}</div>
            {Object.keys(ed.errs).some((k) => k.startsWith('attributes')) && <p className="mt-2 text-xs text-rose-600">Every attribute needs a name and each value a label.</p>}
          </div>
        </div>}
      </Modal>
    </>
  );
}

// ---------------- Plans ----------------
export function Plans() {
  const { can } = useAuth();
  const admin = can('admin');
  const list = useApi('/plans');
  const ed = useEditor({ name: '', billing_period: 'monthly', interval_count: 1, min_quantity: 1, duration_cycles: '', available_from: '', available_to: '', auto_close: true, closable: true, pausable: false, renewable: false, active: true }, {
    path: '/plans', onSaved: list.reload,
    spec: { name: [rules.required], interval_count: [rules.min(1)], min_quantity: [rules.min(1)], available_to: [(v, o) => (v && o.available_from && v < o.available_from ? 'Must be after start' : null)] },
    toBody: (p) => nullIfEmpty(p, ['duration_cycles', 'available_from', 'available_to']),
  });
  const flag = (on, label) => (on ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{label}</span> : null);
  return (
    <>
      <PageHeader title="Subscription plans" subtitle="Billing frequency, terms and lifecycle rules" actions={admin && <Button icon={Plus} onClick={() => ed.open()}>New plan</Button>} />
      <div className="card overflow-hidden">
        <Table loading={list.loading} rows={list.data} onRowClick={admin ? (r) => ed.open(r) : undefined} columns={[
          { key: 'name', label: 'Plan', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { key: 'billing', label: 'Billing', render: (r) => periodLabel(r.billing_period, r.interval_count) },
          { key: 'term', label: 'Term', render: (r) => (r.duration_cycles ? `${r.duration_cycles} cycles` : 'Open-ended') },
          { key: 'min_quantity', label: 'Min qty', align: 'right' },
          { key: 'window', label: 'Available', render: (r) => (r.available_from || r.available_to ? `${r.available_from ? date(r.available_from) : '…'} – ${r.available_to ? date(r.available_to) : '…'}` : 'Always') },
          { key: 'rules', label: 'Rules', render: (r) => <div className="flex flex-wrap gap-1">{flag(r.renewable, 'Auto-renew')}{flag(r.auto_close, 'Auto-close')}{flag(r.pausable, 'Pausable')}{flag(!r.closable, 'No early close')}</div> },
          { key: 'active_subscriptions', label: 'Active', align: 'right' },
        ]} />
      </div>
      <Modal open={!!ed.item} onClose={ed.close} title={ed.item?.id ? 'Edit plan' : 'New plan'} footer={<Footer ed={ed} />}>
        {ed.item && <div className="space-y-4">
          <ErrorBanner error={ed.errs._} />
          <Field label="Name" error={ed.errs.name}><Input value={ed.item.name} error={ed.errs.name} onChange={(e) => ed.set('name', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Billing frequency"><Select value={ed.item.billing_period} onChange={(e) => ed.set('billing_period', e.target.value)}>{['daily', 'weekly', 'monthly', 'yearly'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</Select></Field>
            <Field label="Every N periods" error={ed.errs.interval_count}><Input type="number" min="1" value={ed.item.interval_count} onChange={(e) => ed.set('interval_count', e.target.value)} /></Field>
            <Field label="Minimum quantity" error={ed.errs.min_quantity}><Input type="number" min="1" value={ed.item.min_quantity} onChange={(e) => ed.set('min_quantity', e.target.value)} /></Field>
            <Field label="Term (cycles)" hint="Blank = open-ended" error={ed.errs.duration_cycles}><Input type="number" min="1" value={ed.item.duration_cycles ?? ''} onChange={(e) => ed.set('duration_cycles', e.target.value)} /></Field>
            <Field label="Available from" error={ed.errs.available_from}><Input type="date" value={ed.item.available_from || ''} onChange={(e) => ed.set('available_from', e.target.value)} /></Field>
            <Field label="Available to" error={ed.errs.available_to}><Input type="date" value={ed.item.available_to || ''} error={ed.errs.available_to} onChange={(e) => ed.set('available_to', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <Toggle checked={!!ed.item.renewable} onChange={(v) => ed.set('renewable', v)} label="Automatic renewal" hint="Extends for another term at expiry" />
            <Toggle checked={!!ed.item.auto_close} onChange={(v) => ed.set('auto_close', v)} label="Auto-close on completion" hint="Closes when the term ends" />
            <Toggle checked={!!ed.item.closable} onChange={(v) => ed.set('closable', v)} label="Allow early closure" />
            <Toggle checked={!!ed.item.pausable} onChange={(v) => ed.set('pausable', v)} label="Allow pausing" />
            <Toggle checked={!!ed.item.active} onChange={(v) => ed.set('active', v)} label="Active" />
          </div>
        </div>}
      </Modal>
    </>
  );
}

// ---------------- Quotation templates ----------------
export function Templates() {
  const { can } = useAuth();
  const admin = can('admin');
  const list = useApi('/templates');
  const plans = useApi('/plans').data || [];
  const products = useApi('/products?withVariants=1').data || [];
  const ed = useEditor({ name: '', validity_days: 14, plan_id: '', payment_terms_days: 15, notes: '', lines: [] }, {
    path: '/templates', onSaved: list.reload,
    spec: { name: [rules.required], validity_days: [rules.min(1)] },
    toBody: (t) => ({ ...nullIfEmpty(t, ['plan_id']), lines: t.lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), variant_value_ids: l.variant_value_ids })) }),
  });
  const lines = ed.item?.lines || [];
  return (
    <>
      <PageHeader title="Quotation templates" subtitle="Pre-configured bundles for fast quoting" actions={admin && <Button icon={Plus} onClick={() => ed.open()}>New template</Button>} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((t) => (
          <button key={t.id} onClick={() => admin && ed.open(t)} className="card p-5 text-left transition hover:border-brand-200">
            <div className="flex items-start justify-between"><h3 className="font-semibold text-slate-900">{t.name}</h3><Badge status="quotation">{t.validity_days}d validity</Badge></div>
            <p className="mt-1 text-sm text-slate-500">{t.plan_name || 'No plan'} · Net {t.payment_terms_days}</p>
            <ul className="mt-4 space-y-1 text-sm">{t.lines.map((l) => <li key={l.id} className="flex justify-between"><span className="text-slate-700">{l.product_name}</span><span className="text-slate-500">× {l.quantity}</span></li>)}</ul>
            {t.notes && <p className="mt-3 text-xs text-slate-500">{t.notes}</p>}
          </button>
        ))}
      </div>
      <Modal wide open={!!ed.item} onClose={ed.close} title={ed.item?.id ? 'Edit template' : 'New template'} footer={<Footer ed={ed} />}>
        {ed.item && <div className="space-y-4">
          <ErrorBanner error={ed.errs._} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" error={ed.errs.name}><Input value={ed.item.name} error={ed.errs.name} onChange={(e) => ed.set('name', e.target.value)} /></Field>
            <Field label="Plan"><Select value={ed.item.plan_id || ''} onChange={(e) => ed.set('plan_id', e.target.value)}><option value="">—</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Quote validity (days)" error={ed.errs.validity_days}><Input type="number" min="1" value={ed.item.validity_days} onChange={(e) => ed.set('validity_days', e.target.value)} /></Field>
            <Field label="Payment terms (days)"><Input type="number" min="0" value={ed.item.payment_terms_days} onChange={(e) => ed.set('payment_terms_days', e.target.value)} /></Field>
          </div>
          <Field label="Notes"><Textarea value={ed.item.notes || ''} onChange={(e) => ed.set('notes', e.target.value)} /></Field>
          <div>
            <div className="mb-2 flex justify-between"><span className="text-sm font-semibold">Preset lines</span><Button size="sm" variant="secondary" icon={Plus} onClick={() => ed.set('lines', [...lines, { product_id: '', quantity: 1, variant_value_ids: [] }])}>Line</Button></div>
            <div className="space-y-2">{lines.map((l, i) => {
              const p = products.find((x) => x.id === Number(l.product_id));
              const upd = (nl) => ed.set('lines', lines.map((x, j) => (j === i ? nl : x)));
              return (
                <div key={i} className="flex flex-wrap gap-2 rounded-lg border border-slate-200 p-2">
                  <Select className="min-w-[12rem] flex-1" value={l.product_id} onChange={(e) => { const np = products.find((x) => x.id === Number(e.target.value)); upd({ ...l, product_id: e.target.value, variant_value_ids: np ? np.attributes.map((a) => a.values[0].id) : [] }); }}>
                    <option value="">Product…</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
                  {p?.attributes.map((a) => (
                    <Select key={a.id} className="w-36" value={a.values.find((v) => l.variant_value_ids.includes(v.id))?.id || ''}
                      onChange={(e) => upd({ ...l, variant_value_ids: [...l.variant_value_ids.filter((id) => !a.values.some((v) => v.id === id)), Number(e.target.value)] })}>
                      {a.values.map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}</Select>))}
                  <Input className="w-20" type="number" min="1" value={l.quantity} onChange={(e) => upd({ ...l, quantity: e.target.value })} />
                  <Button variant="ghost" icon={Trash2} onClick={() => ed.set('lines', lines.filter((_, j) => j !== i))} aria-label="Remove" />
                </div>);
            })}</div>
          </div>
        </div>}
      </Modal>
    </>
  );
}

// ---------------- Taxes ----------------
export function Taxes() {
  const list = useApi('/taxes');
  const ed = useEditor({ name: '', rate: '', product_type: '', is_default: false, active: true }, {
    path: '/taxes', onSaved: list.reload, spec: { name: [rules.required], rate: [rules.min(0), rules.max(100)] },
    toBody: (t) => nullIfEmpty(t, ['product_type']),
  });
  return (
    <>
      <PageHeader title="Tax rules" subtitle="Resolution order: product's explicit tax → rule for its product type → default rule" actions={<Button icon={Plus} onClick={() => ed.open()}>New tax</Button>} />
      <div className="card overflow-hidden">
        <Table loading={list.loading} rows={list.data} onRowClick={(r) => ed.open(r)} columns={[
          { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { key: 'rate', label: 'Rate', align: 'right', render: (r) => `${r.rate}%` },
          { key: 'product_type', label: 'Applies to', render: (r) => (r.is_default ? <Badge status="admin">Default</Badge> : r.product_type ? `${titleCase(r.product_type)} products` : 'Explicit only') },
          { key: 'active', label: 'Status', render: (r) => <Badge status={r.active ? 'live' : 'inactive'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
        ]} />
      </div>
      <Modal open={!!ed.item} onClose={ed.close} title={ed.item?.id ? 'Edit tax' : 'New tax'} footer={<Footer ed={ed} />}>
        {ed.item && <div className="space-y-4">
          <ErrorBanner error={ed.errs._} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={ed.errs.name}><Input value={ed.item.name} error={ed.errs.name} onChange={(e) => ed.set('name', e.target.value)} /></Field>
            <Field label="Rate (%)" error={ed.errs.rate}><Input type="number" step="0.01" value={ed.item.rate} error={ed.errs.rate} onChange={(e) => ed.set('rate', e.target.value)} /></Field>
          </div>
          <Field label="Auto-apply to product type"><Select value={ed.item.product_type || ''} onChange={(e) => ed.set('product_type', e.target.value)}><option value="">None (explicit assignment only)</option><option value="software">Software</option><option value="service">Service</option><option value="goods">Goods</option></Select></Field>
          <Toggle checked={!!ed.item.is_default} onChange={(v) => ed.set('is_default', v)} label="Default tax" hint="Used when no other rule matches" />
          <Toggle checked={!!ed.item.active} onChange={(v) => ed.set('active', v)} label="Active" />
        </div>}
      </Modal>
    </>
  );
}

// ---------------- Discounts ----------------
export function Discounts() {
  const list = useApi('/discounts');
  const products = useApi('/products').data || [];
  const ed = useEditor({ name: '', type: 'percent', value: '', min_amount: 0, min_quantity: 0, start_date: '', end_date: '', max_uses: '', product_id: '', active: true }, {
    path: '/discounts', onSaved: list.reload,
    spec: { name: [rules.required], value: [rules.positive, (v, o) => (o.type === 'percent' && Number(v) > 100 ? 'Max 100%' : null)], end_date: [(v, o) => (v && o.start_date && v < o.start_date ? 'Must be after start' : null)] },
    toBody: (d) => nullIfEmpty(d, ['start_date', 'end_date', 'max_uses', 'product_id']),
  });
  return (
    <>
      <PageHeader title="Discount rules" subtitle="Auto-applied on invoices while valid and within usage caps" actions={<Button icon={Plus} onClick={() => ed.open()}>New discount</Button>} />
      <div className="card overflow-hidden">
        <Table loading={list.loading} rows={list.data} onRowClick={(r) => ed.open(r)} columns={[
          { key: 'name', label: 'Rule', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { key: 'value', label: 'Discount', render: (r) => (r.type === 'percent' ? `${r.value}%` : money(r.value)) },
          { key: 'cond', label: 'Conditions', render: (r) => <span className="text-xs text-slate-600">{[r.min_amount > 0 && `≥ ${money(r.min_amount)}`, r.min_quantity > 0 && `qty ≥ ${r.min_quantity}`, r.product_name && `on ${r.product_name}`].filter(Boolean).join(' · ') || 'Any order'}</span> },
          { key: 'window', label: 'Valid', render: (r) => <span className="text-xs">{r.start_date || r.end_date ? `${r.start_date ? date(r.start_date) : '…'} – ${r.end_date ? date(r.end_date) : '…'}` : 'Always'}</span> },
          { key: 'usage', label: 'Usage', render: (r) => (
            <div className="w-28"><div className="text-xs tabular-nums text-slate-600">{r.used_count}{r.max_uses ? ` / ${r.max_uses}` : ' uses'}</div>
              {r.max_uses && <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(100, (r.used_count / r.max_uses) * 100)}%` }} /></div>}</div>) },
          { key: 'state', label: 'Status', render: (r) => <Badge status={r.state} /> },
        ]} />
      </div>
      <Modal open={!!ed.item} onClose={ed.close} title={ed.item?.id ? 'Edit discount' : 'New discount'} footer={<Footer ed={ed} />}>
        {ed.item && <div className="space-y-4">
          <ErrorBanner error={ed.errs._} />
          <Field label="Name" error={ed.errs.name}><Input value={ed.item.name} error={ed.errs.name} onChange={(e) => ed.set('name', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={ed.item.type} onChange={(e) => ed.set('type', e.target.value)}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></Select></Field>
            <Field label={ed.item.type === 'percent' ? 'Percent off' : 'Amount off'} error={ed.errs.value}><Input type="number" step="0.01" value={ed.item.value} error={ed.errs.value} onChange={(e) => ed.set('value', e.target.value)} /></Field>
            <Field label="Min purchase amount"><Input type="number" value={ed.item.min_amount} onChange={(e) => ed.set('min_amount', e.target.value)} /></Field>
            <Field label="Min quantity"><Input type="number" value={ed.item.min_quantity} onChange={(e) => ed.set('min_quantity', e.target.value)} /></Field>
            <Field label="Valid from"><Input type="date" value={ed.item.start_date || ''} onChange={(e) => ed.set('start_date', e.target.value)} /></Field>
            <Field label="Valid until" error={ed.errs.end_date}><Input type="date" value={ed.item.end_date || ''} error={ed.errs.end_date} onChange={(e) => ed.set('end_date', e.target.value)} /></Field>
            <Field label="Max uses" hint="Blank = unlimited"><Input type="number" min="1" value={ed.item.max_uses ?? ''} onChange={(e) => ed.set('max_uses', e.target.value)} /></Field>
            <Field label="Limit to product"><Select value={ed.item.product_id || ''} onChange={(e) => ed.set('product_id', e.target.value)}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          </div>
          <Toggle checked={!!ed.item.active} onChange={(v) => ed.set('active', v)} label="Active" />
        </div>}
      </Modal>
    </>
  );
}
