import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, className, children, ...p }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
  }[variant];
  const s = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' }[size];
  return (
    <button className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60', v, s, className)}
      disabled={loading || p.disabled} {...p}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const Input = ({ error, className, ...p }) => <input className={cx('input', error && 'input-error', className)} aria-invalid={!!error} {...p} />;
export const Select = ({ error, className, children, ...p }) => <select className={cx('input', error && 'input-error', className)} {...p}>{children}</select>;
export const Textarea = ({ error, className, ...p }) => <textarea className={cx('input', error && 'input-error', className)} rows={3} {...p} />;

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span><span className="block text-sm font-medium text-slate-700">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

const BADGE = {
  draft: 'bg-slate-100 text-slate-700', quotation: 'bg-sky-50 text-sky-700 ring-sky-200', confirmed: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200', closed: 'bg-slate-100 text-slate-500', paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-rose-50 text-rose-600 ring-rose-200', overdue: 'bg-rose-50 text-rose-700 ring-rose-200', paused: 'bg-amber-50 text-amber-700 ring-amber-200',
  live: 'bg-emerald-50 text-emerald-700 ring-emerald-200', expired: 'bg-slate-100 text-slate-500', exhausted: 'bg-amber-50 text-amber-700 ring-amber-200',
  scheduled: 'bg-sky-50 text-sky-700 ring-sky-200', inactive: 'bg-slate-100 text-slate-500', admin: 'bg-brand-50 text-brand-700 ring-brand-200',
  staff: 'bg-sky-50 text-sky-700 ring-sky-200', customer: 'bg-slate-100 text-slate-700',
};
export function Badge({ status, children }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ring-transparent', BADGE[status] || BADGE.draft)}>{children || status}</span>;
}

export function Card({ title, actions, children, className, padded = true }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2><div className="flex gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between no-print">
      <div>
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Table({ columns, rows, onRowClick, empty = 'Nothing here yet', loading }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50/70"><tr>{columns.map((c) => <th key={c.key} className={cx('th', c.align === 'right' && 'text-right', c.className)}>{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {loading && !rows?.length ? (
            [...Array(5)].map((_, i) => <tr key={i}><td colSpan={columns.length} className="td"><div className="h-4 animate-pulse rounded bg-slate-100" /></td></tr>)
          ) : !rows?.length ? (
            <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-slate-500">{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx(onRowClick && 'cursor-pointer hover:bg-slate-50', loading && 'opacity-60')}>
              {columns.map((c) => <td key={c.key} className={cx('td', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{total} records</div> : null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
      <span className="text-xs text-slate-500">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous" />
        <span className="px-2 text-xs text-slate-600">Page {page} / {pages}</span>
        <Button variant="ghost" size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next" />
      </div>
    </div>
  );
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  return <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error.message || String(error)}</div>;
}

export function Stat({ label, value, sub, tone = 'slate', icon: Icon }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', brand: 'bg-brand-50 text-brand-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600' };
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        {Icon && <span className={cx('rounded-lg p-2', tones[tone])}><Icon className="h-4 w-4" /></span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ---- Toasts ----
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'success') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 no-print">
        {items.map((t) => (
          <div key={t.id} className={cx('flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg', t.tone === 'error' ? 'bg-rose-600' : 'bg-slate-900')}>
            {t.tone === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}{t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Run an async action with toast feedback; returns the result or undefined on error. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = async (key, fn, success) => {
    setBusy(key);
    try { const r = await fn(); if (success) toast(success); return r; }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };
  return { busy, run };
}
