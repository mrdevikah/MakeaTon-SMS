import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useDebounced } from '../lib/hooks.js';
import { cx } from './ui.jsx';

/** Searchable customer combobox backed by the paginated /customers endpoint (scales to thousands). */
export function CustomerPicker({ value, onChange, error, allowAll, placeholder = 'Select customer' }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');
  const t = useDebounced(term, 200);
  const ref = useRef();

  useEffect(() => { if (open) api('/customers' + qs({ q: t, pageSize: 20 })).then((r) => setRows(r.rows)).catch(() => {}); }, [t, open]);
  useEffect(() => {
    if (!value) return setLabel('');
    api(`/customers/${value}`).then((c) => setLabel(c.name)).catch(() => {});
  }, [value]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className={cx('input flex items-center justify-between text-left', error && 'input-error')}>
        <span className={label ? '' : 'text-slate-400'}>{label || (allowAll ? 'All customers' : placeholder)}</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2"><Search className="h-4 w-4 text-slate-400" />
            <input autoFocus className="w-full text-sm outline-none" placeholder="Search name or email…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {allowAll && <li><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange(''); setOpen(false); }}>All customers</button></li>}
            {rows.map((c) => (
              <li key={c.id}><button type="button" className={cx('w-full px-3 py-2 text-left text-sm hover:bg-slate-50', c.id === Number(value) && 'bg-brand-50')}
                onClick={() => { onChange(c.id); setLabel(c.name); setOpen(false); }}>
                <div className="font-medium text-slate-800">{c.name}</div><div className="text-xs text-slate-500">{c.email}</div></button></li>
            ))}
            {!rows.length && <li className="px-3 py-3 text-sm text-slate-500">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
