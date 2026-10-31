import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, IndianRupee, Repeat, TrendingUp } from 'lucide-react';
import { qs } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { date, money, moneyShort } from '../lib/format.js';
import { Card, ErrorBanner, Field, Input, PageHeader, Select, Stat, Table, cx } from '../components/ui.jsx';
import { CustomerPicker } from '../components/pickers.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
function rangeFor(key) {
  const now = new Date();
  if (key === 'all') return { from: '', to: '' };
  if (key === 'mtd') return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(now) };
  if (key === 'qtd') return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1))), to: iso(now) };
  if (key === 'ytd') return { from: `${now.getUTCFullYear()}-01-01`, to: iso(now) };
  const d = new Date(now); d.setUTCDate(d.getUTCDate() - Number(key));
  return { from: iso(d), to: iso(now) };
}

function RevenueChart({ months }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...months.flatMap((m) => [m.collected, m.invoiced]));
  const nice = Math.pow(10, Math.floor(Math.log10(max))) * Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max))));
  const W = 720, H = 220, pl = 48, pb = 24, pt = 12, bw = (W - pl) / months.length;
  return (
    <div className="relative">
      <svg viewBox={`0 ${-pt} ${W} ${H + pb + pt}`} className="w-full" role="img" aria-label="Monthly invoiced vs collected">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}><line x1={pl} x2={W} y1={H - t * H} y2={H - t * H} className="stroke-slate-100" />
            <text x={pl - 8} y={H - t * H + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{moneyShort(nice * t).replace('₹', '')}</text></g>
        ))}
        {months.map((m, i) => {
          const x = pl + i * bw, hI = (m.invoiced / nice) * H, hC = (m.collected / nice) * H;
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={bw} height={H} className={hover === i ? 'fill-slate-50' : 'fill-transparent'} />
              <rect x={x + bw * 0.18} y={H - hI} width={bw * 0.3} height={hI} rx="3" className="fill-brand-200" />
              <rect x={x + bw * 0.52} y={H - hC} width={bw * 0.3} height={hC} rx="3" className="fill-brand-600" />
              <text x={x + bw / 2} y={H + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {new Date(m.month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg" style={{ left: `${Math.min(75, ((48 + hover * ((720 - 48) / 12)) / 720) * 100)}%` }}>
          <div className="font-medium">{new Date(months[hover].month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
          <div>Invoiced {money(months[hover].invoiced)}</div><div>Collected {money(months[hover].collected)}</div>
        </div>
      )}
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-200" />Invoiced</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" />Collected</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [preset, setPreset] = useState('all');
  const [custom, setCustom] = useState(rangeFor('all'));
  const [customer, setCustomer] = useState('');
  const range = preset === 'custom' ? custom : rangeFor(preset);
  const { data: d, error, loading } = useApi('/dashboard' + qs({ ...range, customer_id: customer }));
  const collectionRate = useMemo(() => {
    if (!d) return null;
    const inv = d.months.reduce((s, m) => s + m.invoiced, 0), col = d.months.reduce((s, m) => s + m.collected, 0);
    return inv ? Math.round((col / inv) * 100) : null;
  }, [d]);

  return (
    <>
      <PageHeader title="Finance overview" subtitle={d ? `As of ${date(d.today)}` : 'Loading…'} />
      <div className="card mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Period">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="all">All time</option><option value="mtd">This month</option><option value="qtd">This quarter</option>
            <option value="ytd">Year to date</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range…</option>
          </Select>
        </Field>
        {preset === 'custom' && <>
          <Field label="From"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
        </>}
        <Field label="Customer"><CustomerPicker value={customer} onChange={setCustomer} allowAll /></Field>
      </div>
      <ErrorBanner error={error} />
      <div className={cx('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-70')}>
        <Stat label="Active subscriptions" icon={Repeat} tone="brand" value={d?.active_subscriptions?.toLocaleString() ?? '—'}
          sub={d && `${d.paused_subscriptions} paused · ${d.open_quotations} open quotes`} />
        <Stat label="Revenue collected" icon={IndianRupee} tone="green" value={d ? money(d.revenue_collected) : '—'} sub={d && `${d.payments_count.toLocaleString()} payments · MRR ${moneyShort(d.mrr)}`} />
        <Stat label="Pending payments" icon={Clock} tone="amber" value={d ? money(d.pending_amount) : '—'} sub={d && `${d.pending_count} invoices not yet due`} />
        <Stat label="Overdue invoices" icon={AlertTriangle} tone="rose" value={d ? money(d.overdue_amount) : '—'} sub={d && `${d.overdue_count} invoices past due`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Invoiced vs collected · last 12 months" className="xl:col-span-2"
          actions={collectionRate !== null && <span className="flex items-center gap-1 text-xs text-slate-500"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" />{collectionRate}% collected</span>}>
          {d ? <RevenueChart months={d.months} /> : <div className="h-60 animate-pulse rounded bg-slate-50" />}
        </Card>
        <Card title="Active by plan">
          <ul className="space-y-3">
            {d?.by_plan.map((p) => {
              const pct = d.active_subscriptions ? (p.n / d.active_subscriptions) * 100 : 0;
              return (<li key={p.name}><div className="mb-1 flex justify-between text-sm"><span className="text-slate-700">{p.name}</span><span className="tabular-nums text-slate-500">{p.n}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div></li>);
            })}
            {d && !d.by_plan.length && <li className="text-sm text-slate-500">No active subscriptions</li>}
          </ul>
          {d?.draft_invoices > 0 && (
            <Link to="/invoices?status=draft" className="mt-5 block rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 hover:bg-amber-100">
              <b>{d.draft_invoices}</b> draft invoice{d.draft_invoices > 1 ? 's' : ''} ({money(d.draft_amount)}) awaiting review →</Link>
          )}
        </Card>
      </div>

      <Card title="Most overdue" className="mt-6" padded={false} actions={<Link to="/invoices?status=overdue" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>}>
        <Table loading={loading} rows={d?.overdue_list} empty="No overdue invoices 🎉" onRowClick={(r) => nav(`/invoices/${r.id}`)} columns={[
          { key: 'number', label: 'Invoice', render: (r) => <span className="font-medium text-slate-900">{r.number}</span> },
          { key: 'customer_name', label: 'Customer' },
          { key: 'due_date', label: 'Due', render: (r) => date(r.due_date) },
          { key: 'days', label: 'Overdue', render: (r) => <span className="text-rose-600">{r.days_overdue} days</span> },
          { key: 'balance', label: 'Balance', align: 'right', render: (r) => money(r.balance) },
        ]} />
      </Card>
    </>
  );
}
