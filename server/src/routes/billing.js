import { Router } from 'express';
import { q } from '../db.js';
import { isInternal, requireRole, scopeCustomer } from '../lib/auth.js';
import { schemas, validate, isoDate } from '../lib/validation.js';
import { badRequest, h, notFound, paginate, todayISO } from '../lib/util.js';
import { createSubscription, fromTemplate, getSubscription, transitionSubscription, updateSubscription } from '../services/subscriptions.js';
import { emailInvoice, getInvoice, recordPayment, transitionInvoice } from '../services/invoicing.js';
import { runBilling } from '../services/billing.js';

const r = Router();
const internal = requireRole('admin', 'staff');
const admin = requireRole('admin');

const like = (s) => `%${s}%`;
function own(user, row) {
  if (!row) throw notFound();
  if (!isInternal(user) && row.customer_id !== user.customer_id) throw notFound(); // don't leak existence
  return row;
}

// ---------- Subscriptions ----------
r.get('/subscriptions', h((req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const where = ['1=1'], params = [];
  const cust = scopeCustomer(req.user);
  if (cust) { where.push('s.customer_id = ?'); params.push(cust); }
  if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.customer_id && !cust) { where.push('s.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.q) { where.push('(s.number LIKE ? OR c.name LIKE ?)'); params.push(like(req.query.q), like(req.query.q)); }
  const w = where.join(' AND ');
  const total = q.get(`SELECT COUNT(*) n FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE ${w}`, ...params).n;
  const rows = q.all(`SELECT s.id, s.number, s.status, s.paused, s.start_date, s.expiry_date, s.next_invoice_date, s.quote_valid_until,
      c.name AS customer_name, p.name AS plan_name, p.billing_period,
      (SELECT COALESCE(SUM(quantity * unit_price * (1 + tax_rate/100.0)),0) FROM subscription_lines sl WHERE sl.subscription_id = s.id) AS recurring_total
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
    WHERE ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ rows, total, page, pageSize });
}));

r.get('/subscriptions/:id', h((req, res) => res.json(own(req.user, getSubscription(Number(req.params.id))))));

r.post('/subscriptions', internal, h((req, res) => {
  let body = req.body ?? {};
  // Create straight from a quotation template: its plan, terms and lines are prefilled.
  if (body.template_id && !body.lines) {
    const start = validate(isoDate, body.start_date ?? todayISO());
    const tpl = fromTemplate(Number(body.template_id), Number(body.customer_id), start);
    body = { ...tpl, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== '')), lines: tpl.lines };
  }
  res.status(201).json(createSubscription(validate(schemas.subscription, body), req.user.id));
}));

r.put('/subscriptions/:id', internal, h((req, res) =>
  res.json(updateSubscription(Number(req.params.id), validate(schemas.subscription, req.body)))));

r.post('/subscriptions/:id/:action', h(async (req, res) => {
  const allowed = ['send_quote', 'revert_draft', 'confirm', 'activate', 'pause', 'resume', 'close', 'invoice_now'];
  if (!allowed.includes(req.params.action)) throw badRequest('Unknown action');
  res.json(await transitionSubscription(Number(req.params.id), req.params.action, req.user, { reason: req.body?.reason }));
}));

r.get('/templates/:id/preview', internal, h((req, res) => res.json(fromTemplate(Number(req.params.id), null, todayISO()))));

// ---------- Invoices ----------
const invoiceFilters = (req) => {
  const where = ['1=1'], params = [];
  const cust = scopeCustomer(req.user);
  const today = todayISO();
  if (cust) { where.push('i.customer_id = ?', "i.status <> 'draft'"); params.push(cust); }
  if (req.query.status === 'overdue') { where.push(`i.status = 'confirmed' AND i.due_date < ? AND i.total > i.amount_paid`); params.push(today); }
  else if (req.query.status) { where.push('i.status = ?'); params.push(req.query.status); }
  if (req.query.customer_id && !cust) { where.push('i.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.subscription_id) { where.push('i.subscription_id = ?'); params.push(Number(req.query.subscription_id)); }
  if (req.query.from) { where.push('i.invoice_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('i.invoice_date <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push('(i.number LIKE ? OR c.name LIKE ?)'); params.push(like(req.query.q), like(req.query.q)); }
  return { w: where.join(' AND '), params, today };
};

r.get('/invoices', h((req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const { w, params, today } = invoiceFilters(req);
  const total = q.get(`SELECT COUNT(*) n FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE ${w}`, ...params).n;
  const rows = q.all(`SELECT i.id, i.number, i.status, i.invoice_date, i.due_date, i.total, i.amount_paid, i.subscription_id, i.emailed_at,
      c.name AS customer_name, s.number AS subscription_number,
      (i.status = 'confirmed' AND i.due_date < ? AND i.total > i.amount_paid) AS overdue
    FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN subscriptions s ON s.id = i.subscription_id
    WHERE ${w} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`, today, ...params, pageSize, offset);
  res.json({ rows, total, page, pageSize });
}));

r.get('/invoices/:id', h((req, res) => {
  const inv = own(req.user, getInvoice(Number(req.params.id)));
  if (!isInternal(req.user) && inv.status === 'draft') throw notFound();
  res.json(inv);
}));

r.post('/invoices/:id/email', internal, h(async (req, res) => res.json(await emailInvoice(Number(req.params.id)))));
r.post('/invoices/:id/:action', internal, h((req, res) => {
  if (!['confirm', 'cancel', 'reset_draft'].includes(req.params.action)) throw badRequest('Unknown action');
  res.json(transitionInvoice(Number(req.params.id), req.params.action));
}));

// ---------- Payments ----------
r.get('/payments', h((req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const where = ['1=1'], params = [];
  const cust = scopeCustomer(req.user);
  if (cust) { where.push('i.customer_id = ?'); params.push(cust); }
  if (req.query.method) { where.push('p.method = ?'); params.push(req.query.method); }
  if (req.query.from) { where.push('p.date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('p.date <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push('(i.number LIKE ? OR c.name LIKE ?)'); params.push(like(req.query.q), like(req.query.q)); }
  const w = where.join(' AND ');
  const base = `FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id WHERE ${w}`;
  const agg = q.get(`SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) s ${base}`, ...params);
  const rows = q.all(`SELECT p.*, i.number AS invoice_number, c.name AS customer_name ${base} ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ rows, total: agg.n, sum: agg.s, page, pageSize });
}));

r.post('/payments', internal, h((req, res) => res.status(201).json(recordPayment(validate(schemas.payment, req.body), req.user.id))));

// ---------- Finance dashboard ----------
r.get('/dashboard', internal, h((req, res) => {
  const today = todayISO();
  const from = req.query.from || '0000-01-01';
  const to = req.query.to || '9999-12-31';
  const cust = req.query.customer_id ? Number(req.query.customer_id) : null;
  if (cust !== null && !Number.isInteger(cust)) throw badRequest('Invalid customer filter');
  const cf = (alias) => (cust ? ` AND ${alias}.customer_id = ${Number(cust)}` : '');
  const one = (sql, ...p) => q.get(sql, ...p);

  const subs = one(`SELECT COUNT(*) FILTER (WHERE status='active') active, COUNT(*) FILTER (WHERE status='active' AND paused=1) paused,
    COUNT(*) FILTER (WHERE status='quotation') quotations FROM subscriptions s WHERE 1=1${cf('s')}`);
  const revenue = one(`SELECT COALESCE(SUM(p.amount),0) v, COUNT(*) n FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.date BETWEEN ? AND ?${cf('i')}`, from, to);
  const pending = one(`SELECT COALESCE(SUM(total - amount_paid),0) v, COUNT(*) n FROM invoices i WHERE status='confirmed' AND due_date >= ?
    AND invoice_date BETWEEN ? AND ?${cf('i')}`, today, from, to);
  const overdue = one(`SELECT COALESCE(SUM(total - amount_paid),0) v, COUNT(*) n FROM invoices i WHERE status='confirmed' AND due_date < ?
    AND total > amount_paid AND invoice_date BETWEEN ? AND ?${cf('i')}`, today, from, to);
  const drafts = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM invoices i WHERE status='draft'${cf('i')}`);
  const mrr = one(`SELECT COALESCE(SUM(sl.quantity * sl.unit_price *
      CASE p.billing_period WHEN 'daily' THEN 30.4375 WHEN 'weekly' THEN 4.348 WHEN 'monthly' THEN 1 ELSE 1/12.0 END / p.interval_count),0) v
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN subscription_lines sl ON sl.subscription_id = s.id
    WHERE s.status='active' AND s.paused = 0${cf('s')}`);
  const monthly = q.all(`SELECT substr(p.date,1,7) month, ROUND(SUM(p.amount),2) collected FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.date >= date(?, 'start of month', '-11 months')${cf('i')} GROUP BY 1 ORDER BY 1`, today);
  const invoiced = q.all(`SELECT substr(invoice_date,1,7) month, ROUND(SUM(total),2) invoiced FROM invoices i
    WHERE status IN ('confirmed','paid') AND invoice_date >= date(?, 'start of month', '-11 months')${cf('i')} GROUP BY 1`, today);
  const invMap = Object.fromEntries(invoiced.map((r) => [r.month, r.invoiced]));
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k);
    const m = d.toISOString().slice(0, 7);
    months.push({ month: m, collected: monthly.find((x) => x.month === m)?.collected ?? 0, invoiced: invMap[m] ?? 0 });
  }
  const overdueList = q.all(`SELECT i.id, i.number, i.due_date, ROUND(i.total - i.amount_paid,2) balance, c.name customer_name,
      CAST(julianday(?) - julianday(i.due_date) AS INTEGER) days_overdue
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status='confirmed' AND i.due_date < ? AND i.total > i.amount_paid${cf('i')}
    ORDER BY i.due_date LIMIT 8`, today, today);
  const byPlan = q.all(`SELECT p.name, COUNT(*) n FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status='active'${cf('s')}
    GROUP BY p.id ORDER BY n DESC LIMIT 6`);
  res.json({
    today, active_subscriptions: subs.active, paused_subscriptions: subs.paused, open_quotations: subs.quotations,
    revenue_collected: revenue.v, payments_count: revenue.n, pending_amount: pending.v, pending_count: pending.n,
    overdue_amount: overdue.v, overdue_count: overdue.n, draft_invoices: drafts.n, draft_amount: drafts.v,
    mrr: Math.round(mrr.v * 100) / 100, months, overdue_list: overdueList, by_plan: byPlan,
  });
}));

// ---------- Admin ops ----------
r.post('/billing/run', admin, h((req, res) => {
  const asOf = req.body?.as_of ? validate(isoDate, req.body.as_of) : todayISO();
  if (asOf > todayISO()) throw badRequest('Cannot bill future dates');
  res.json(runBilling(asOf));
}));
r.get('/billing/runs', admin, (_req, res) => res.json(q.all('SELECT * FROM billing_runs ORDER BY id DESC LIMIT 20')));
r.get('/outbox', admin, (_req, res) => res.json(q.all('SELECT * FROM email_outbox ORDER BY id DESC LIMIT 50')));

export default r;
