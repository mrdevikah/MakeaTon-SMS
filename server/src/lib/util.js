/** Money rounding to 2 decimals without binary-float drift (e.g. 1.005 -> 1.01). */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, m);
export const conflict = (m) => new HttpError(409, m);

/** Wrap async handlers so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

// ---- Dates (ISO YYYY-MM-DD, UTC-safe) ----
export const todayISO = () => process.env.FAKE_TODAY || new Date().toISOString().slice(0, 10);

const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const fmt = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso, n) {
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Add n months, clamping to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso, n) {
  const { y, m, d } = parse(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/**
 * Date of cycle k for a plan, always computed from the anchor (start date) so
 * month-end clamping never drifts (31st stays 31st when the month allows it).
 */
export function cycleDate(anchor, period, interval, k) {
  const n = interval * k;
  switch (period) {
    case 'daily': return addDays(anchor, n);
    case 'weekly': return addDays(anchor, 7 * n);
    case 'monthly': return addMonths(anchor, n);
    case 'yearly': return addMonths(anchor, 12 * n);
    default: throw new Error('Unknown period ' + period);
  }
}

export function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const bool = (v) => (v ? 1 : 0);
export const pad = (n, w = 5) => String(n).padStart(w, '0');
