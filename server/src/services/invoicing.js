import { q, tx } from '../db.js';
import { addDays, badRequest, conflict, cycleDate, pad, round2, todayISO } from '../lib/util.js';
import { priceLines, subscriptionLinesForPricing } from './pricing.js';
import { sendMail, layout } from '../lib/mailer.js';
import { config } from '../config.js';

/**
 * Create the invoice for billing cycle `k` of a subscription. Must run inside
 * a transaction. The partial unique index on (subscription_id, cycle_index)
 * makes double-billing impossible even under concurrent runs.
 * Discount usage is consumed atomically here and released if the invoice is cancelled.
 */
export function createCycleInvoice(sub, plan, k) {
  const periodStart = cycleDate(sub.start_date, plan.billing_period, plan.interval_count, k);
  let periodEnd = addDays(cycleDate(sub.start_date, plan.billing_period, plan.interval_count, k + 1), -1);
  if (sub.expiry_date && periodEnd >= sub.expiry_date) periodEnd = addDays(sub.expiry_date, -1);

  if (q.get(`SELECT 1 FROM invoices WHERE subscription_id = ? AND cycle_index = ? AND status <> 'cancelled'`, sub.id, k))
    return null; // already billed — idempotent

  const lines = subscriptionLinesForPricing(sub.id);
  // Consume discount usage atomically; a rule that hits its cap mid-run is skipped.
  const candidates = q.all(
    `SELECT * FROM discounts WHERE active = 1 AND (start_date IS NULL OR start_date <= ?)
       AND (end_date IS NULL OR end_date >= ?) AND (max_uses IS NULL OR used_count < max_uses) ORDER BY id`,
    periodStart, periodStart);
  const preview = priceLines(lines, periodStart, { discounts: candidates });
  const usable = [];
  for (const dl of preview.discountLines) {
    const ok = q.run('UPDATE discounts SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)', dl.discount_id);
    if (ok.changes) usable.push(candidates.find((c) => c.id === dl.discount_id));
  }
  const priced = usable.length === preview.discountLines.length ? preview : priceLines(lines, periodStart, { discounts: usable });

  return insertInvoice({
    subscription_id: sub.id, customer_id: sub.customer_id,
    invoice_date: periodStart, due_date: addDays(periodStart, sub.payment_terms_days),
    period_start: periodStart, period_end: periodEnd, cycle_index: k,
  }, priced);
}

function insertInvoice(head, priced) {
  const id = Number(q.run(
    `INSERT INTO invoices (subscription_id, customer_id, invoice_date, due_date, period_start, period_end, cycle_index,
       subtotal, discount_total, tax_total, total) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    head.subscription_id, head.customer_id, head.invoice_date, head.due_date, head.period_start, head.period_end,
    head.cycle_index, priced.subtotal, priced.discount_total, priced.tax_total, priced.total).lastInsertRowid);
  q.run('UPDATE invoices SET number = ? WHERE id = ?', `INV-${head.invoice_date.slice(0, 4)}-${pad(id, 6)}`, id);
  const ins = 'INSERT INTO invoice_lines (invoice_id, product_id, discount_id, description, quantity, unit_price, tax_rate, tax_amount, line_total) VALUES (?,?,?,?,?,?,?,?,?)';
  for (const l of priced.lines)
    q.run(ins, id, l.product_id, null, l.description, l.quantity, l.unit_price, l.tax_rate, l.tax_amount, l.amount);
  for (const l of priced.discountLines)
    q.run(ins, id, null, l.discount_id, l.description, 1, l.unit_price, l.tax_rate, l.tax_amount, l.amount);
  return id;
}

export function getInvoice(id) {
  const inv = q.get(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.address AS customer_address, s.number AS subscription_number
     FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN subscriptions s ON s.id = i.subscription_id WHERE i.id = ?`, id);
  if (!inv) return null;
  inv.lines = q.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY discount_id IS NOT NULL, id', id);
  inv.payments = q.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date, id', id);
  inv.balance = round2(inv.total - inv.amount_paid);
  inv.overdue = inv.status === 'confirmed' && inv.balance > 0 && inv.due_date < todayISO();
  return inv;
}

export function transitionInvoice(id, action) {
  return tx(() => {
    const inv = q.get('SELECT * FROM invoices WHERE id = ?', id);
    if (!inv) throw badRequest('Invoice not found');
    if (action === 'confirm') {
      if (inv.status !== 'draft') throw conflict(`Only draft invoices can be confirmed (current: ${inv.status})`);
      q.run(`UPDATE invoices SET status = 'confirmed' WHERE id = ?`, id);
    } else if (action === 'cancel') {
      if (!['draft', 'confirmed'].includes(inv.status)) throw conflict(`A ${inv.status} invoice cannot be cancelled`);
      if (inv.amount_paid > 0) throw conflict('Invoice has payments recorded; it cannot be cancelled');
      q.run(`UPDATE invoices SET status = 'cancelled' WHERE id = ?`, id);
      // Release discount usage so caps reflect only billed invoices.
      for (const l of q.all('SELECT discount_id FROM invoice_lines WHERE invoice_id = ? AND discount_id IS NOT NULL', id))
        q.run('UPDATE discounts SET used_count = MAX(0, used_count - 1) WHERE id = ?', l.discount_id);
    } else if (action === 'reset_draft') {
      if (inv.status !== 'confirmed' || inv.amount_paid > 0) throw conflict('Only unpaid confirmed invoices can return to draft');
      q.run(`UPDATE invoices SET status = 'draft' WHERE id = ?`, id);
    } else throw badRequest('Unknown action');
    return getInvoice(id);
  });
}

export function recordPayment(p, userId) {
  return tx(() => {
    const inv = q.get('SELECT * FROM invoices WHERE id = ?', p.invoice_id);
    if (!inv) throw badRequest('Invoice not found', { invoice_id: 'Invoice not found' });
    if (inv.status !== 'confirmed') throw conflict(`Payments can only be recorded on confirmed invoices (current: ${inv.status})`);
    const balance = round2(inv.total - inv.amount_paid);
    if (p.amount > balance + 0.001) throw badRequest(`Amount exceeds the outstanding balance of ${balance}`, { amount: `Max ${balance}` });
    const id = Number(q.run('INSERT INTO payments (invoice_id, method, date, amount, notes, created_by) VALUES (?,?,?,?,?,?)',
      p.invoice_id, p.method, p.date, round2(p.amount), p.notes ?? null, userId).lastInsertRowid);
    const paid = round2(inv.amount_paid + p.amount);
    q.run(`UPDATE invoices SET amount_paid = ?, status = CASE WHEN ? >= total - 0.001 THEN 'paid' ELSE status END WHERE id = ?`, paid, paid, inv.id);
    return { id, invoice: getInvoice(inv.id) };
  });
}

const money = (n) => `${config.currency} ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function emailInvoice(id) {
  const inv = getInvoice(id);
  if (!inv) throw badRequest('Invoice not found');
  if (inv.status === 'draft' || inv.status === 'cancelled') throw conflict('Confirm the invoice before emailing it');
  const rows = inv.lines.map((l) => `<tr><td style="padding:6px 0">${l.description}</td><td align="right">${l.quantity}</td><td align="right">${money(l.line_total + l.tax_amount)}</td></tr>`).join('');
  await sendMail({
    to: inv.customer_email, subject: `Invoice ${inv.number} from ${config.companyName}`,
    html: layout(`Invoice ${inv.number}`, `<p>Hi ${inv.customer_name},</p><p>Your invoice for ${inv.period_start ?? inv.invoice_date} – ${inv.period_end ?? ''} is ready.</p>
<table width="100%" style="font-size:14px;border-collapse:collapse">${rows}</table><hr style="border:none;border-top:1px solid #e5e7eb">
<p style="font-size:16px"><b>Total: ${money(inv.total)}</b> · Balance due ${money(inv.balance)} by ${inv.due_date}</p>
<p><a href="${config.appUrl}/invoices/${inv.id}" style="color:#4f46e5">View invoice in the customer portal</a></p>`),
  });
  q.run(`UPDATE invoices SET emailed_at = datetime('now') WHERE id = ?`, id);
  return getInvoice(id);
}
