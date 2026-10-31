import { q, tx } from '../db.js';
import { addDays, badRequest, conflict, cycleDate, forbidden, pad, todayISO } from '../lib/util.js';
import { priceLines, resolveProductLine, resolveTax, subscriptionLinesForPricing } from './pricing.js';
import { createCycleInvoice } from './invoicing.js';
import { sendMail, layout } from '../lib/mailer.js';
import { config } from '../config.js';

export const TRANSITIONS = {
  draft: ['send_quote', 'close'],
  quotation: ['confirm', 'revert_draft', 'close'],
  confirmed: ['activate', 'close'],
  active: ['pause', 'resume', 'close', 'invoice_now'],
  closed: [],
};

function loadPlan(planId, startDate) {
  const plan = q.get('SELECT * FROM plans WHERE id = ?', planId);
  if (!plan) throw badRequest('Plan not found', { plan_id: 'Plan not found' });
  if (!plan.active) throw badRequest('This plan is no longer offered', { plan_id: 'Plan is inactive' });
  if (plan.available_from && startDate < plan.available_from)
    throw badRequest(`Plan is available from ${plan.available_from}`, { start_date: `Plan starts ${plan.available_from}` });
  if (plan.available_to && startDate > plan.available_to)
    throw badRequest(`Plan was available until ${plan.available_to}`, { start_date: `Plan ended ${plan.available_to}` });
  return plan;
}

function writeLines(subId, plan, lines) {
  q.run('DELETE FROM subscription_lines WHERE subscription_id = ?', subId);
  lines.forEach((l, i) => {
    if (l.quantity < plan.min_quantity)
      throw badRequest(`Minimum quantity for plan "${plan.name}" is ${plan.min_quantity}`, { [`lines.${i}.quantity`]: `Min ${plan.min_quantity}` });
    const r = resolveProductLine(l.product_id, l.variant_value_ids);
    const tax = resolveTax(r.product);
    q.run(`INSERT INTO subscription_lines (subscription_id, product_id, description, variant_value_ids, quantity, unit_price, tax_id, tax_rate)
      VALUES (?,?,?,?,?,?,?,?)`, subId, r.product.id, r.description, JSON.stringify(r.variant_value_ids),
      l.quantity, l.unit_price ?? r.unit_price, tax?.id ?? null, tax?.rate ?? 0);
  });
}

function computeExpiry(data, plan) {
  if (data.expiry_date) return data.expiry_date;
  return plan.duration_cycles ? cycleDate(data.start_date, plan.billing_period, plan.interval_count, plan.duration_cycles) : null;
}

export function createSubscription(data, userId) {
  return tx(() => {
    const cust = q.get('SELECT id FROM customers WHERE id = ?', data.customer_id);
    if (!cust) throw badRequest('Customer not found', { customer_id: 'Customer not found' });
    const plan = loadPlan(data.plan_id, data.start_date);
    const id = Number(q.run(
      `INSERT INTO subscriptions (customer_id, plan_id, template_id, start_date, expiry_date, payment_terms_days, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?)`, data.customer_id, plan.id, data.template_id ?? null, data.start_date,
      computeExpiry(data, plan), data.payment_terms_days, data.notes ?? null, userId).lastInsertRowid);
    q.run('UPDATE subscriptions SET number = ? WHERE id = ?', `SUB-${pad(id)}`, id);
    writeLines(id, plan, data.lines);
    return getSubscription(id);
  });
}

export function updateSubscription(id, data) {
  return tx(() => {
    const sub = q.get('SELECT * FROM subscriptions WHERE id = ?', id);
    if (!sub) throw badRequest('Subscription not found');
    if (sub.status !== 'draft') throw conflict('Only draft subscriptions can be edited — revert the quotation to draft first');
    const plan = loadPlan(data.plan_id, data.start_date);
    q.run(`UPDATE subscriptions SET customer_id=?, plan_id=?, template_id=?, start_date=?, expiry_date=?, payment_terms_days=?, notes=? WHERE id=?`,
      data.customer_id, plan.id, data.template_id ?? null, data.start_date, computeExpiry(data, plan),
      data.payment_terms_days, data.notes ?? null, id);
    writeLines(id, plan, data.lines);
    return getSubscription(id);
  });
}

/** Build a draft subscription payload from a quotation template. */
export function fromTemplate(templateId, customerId, startDate) {
  const t = q.get('SELECT * FROM quotation_templates WHERE id = ?', templateId);
  if (!t) throw badRequest('Template not found');
  if (!t.plan_id) throw badRequest('Template has no plan configured');
  const lines = q.all('SELECT product_id, quantity, variant_value_ids FROM template_lines WHERE template_id = ?', templateId)
    .map((l) => ({ ...l, variant_value_ids: JSON.parse(l.variant_value_ids) }));
  return { customer_id: customerId, plan_id: t.plan_id, template_id: t.id, start_date: startDate,
    payment_terms_days: t.payment_terms_days, notes: t.notes, lines };
}

export function getSubscription(id) {
  const s = q.get(
    `SELECT s.*, c.name AS customer_name, c.email AS customer_email, p.name AS plan_name, p.billing_period, p.interval_count,
       p.pausable, p.closable, p.renewable, p.auto_close, p.min_quantity, p.duration_cycles, t.name AS template_name, t.validity_days
     FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
     LEFT JOIN quotation_templates t ON t.id = s.template_id WHERE s.id = ?`, id);
  if (!s) return null;
  s.lines = q.all('SELECT sl.*, t.name AS tax_name FROM subscription_lines sl LEFT JOIN taxes t ON t.id = sl.tax_id WHERE subscription_id = ? ORDER BY sl.id', id)
    .map((l) => ({ ...l, variant_value_ids: JSON.parse(l.variant_value_ids) }));
  // Live pricing preview with current tax rules and any auto-applicable discounts.
  s.pricing = priceLines(subscriptionLinesForPricing(id), s.next_invoice_date || s.start_date);
  s.invoices = q.all('SELECT id, number, status, invoice_date, period_start, period_end, total, amount_paid FROM invoices WHERE subscription_id = ? ORDER BY cycle_index DESC, id DESC LIMIT 50', id);
  s.actions = TRANSITIONS[s.status].filter((a) => (a === 'pause' ? s.pausable && !s.paused : a === 'resume' ? s.paused : true));
  return s;
}

/**
 * Lifecycle: Draft → Quotation → Confirmed → Active → Closed (plus pause/resume
 * and early close per plan rules). `actor` decides role-based permissions.
 */
export async function transitionSubscription(id, action, actor, { reason } = {}) {
  const result = tx(() => {
    const s = getSubscription(id);
    if (!s) throw badRequest('Subscription not found');
    const isCustomer = actor.role === 'customer';
    if (isCustomer && s.customer_id !== actor.customer_id) throw forbidden();
    if (!TRANSITIONS[s.status].includes(action)) throw conflict(`Cannot ${action.replace('_', ' ')} a ${s.status} subscription`);
    const customerAllowed = { quotation: ['confirm'], active: ['pause', 'resume', 'close'] };
    if (isCustomer && !(customerAllowed[s.status] || []).includes(action)) throw forbidden('This action is handled by Brightloop staff');
    const today = todayISO();
    let email = null;

    switch (action) {
      case 'send_quote': {
        if (!s.lines.length) throw conflict('Add line items before sending a quotation');
        const valid = addDays(today, s.validity_days || 30);
        q.run(`UPDATE subscriptions SET status='quotation', quote_valid_until=? WHERE id=?`, valid, id);
        email = { to: s.customer_email, subject: `Quotation ${s.number} from ${config.companyName}`,
          html: layout(`Your quotation ${s.number}`, `<p>Hi ${s.customer_name},</p><p>Your quotation for <b>${s.plan_name}</b> totals <b>${config.currency} ${s.pricing.total.toFixed(2)}</b> per billing cycle and is valid until <b>${valid}</b>.</p><p><a href="${config.appUrl}/subscriptions/${id}" style="color:#4f46e5">Review and accept in the customer portal</a></p>`) };
        break;
      }
      case 'revert_draft':
        q.run(`UPDATE subscriptions SET status='draft', quote_valid_until=NULL WHERE id=?`, id); break;
      case 'confirm':
        if (s.quote_valid_until && s.quote_valid_until < today) throw conflict(`This quotation expired on ${s.quote_valid_until}`);
        q.run(`UPDATE subscriptions SET status='confirmed' WHERE id=?`, id); break;
      case 'activate':
        activate(s); break;
      case 'pause':
        if (!s.pausable) throw conflict('This plan does not allow pausing');
        q.run('UPDATE subscriptions SET paused = 1 WHERE id = ?', id); break;
      case 'resume': resume(s, today); break;
      case 'close': {
        const early = s.status === 'active' && (!s.expiry_date || s.expiry_date > today);
        if (early && !s.closable && actor.role !== 'admin') throw conflict('This plan does not allow early closure');
        q.run(`UPDATE subscriptions SET status='closed', closed_reason=? WHERE id=?`,
          reason || (s.status === 'active' ? (early ? 'closed early' : 'completed') : 'cancelled'), id);
        break;
      }
      case 'invoice_now': {
        const plan = q.get('SELECT * FROM plans WHERE id = ?', s.plan_id);
        const ps = cycleDate(s.start_date, plan.billing_period, plan.interval_count, s.cycles_billed);
        if (s.expiry_date && ps >= s.expiry_date) throw conflict('All cycles up to the expiry date have been invoiced');
        const sub = q.get('SELECT * FROM subscriptions WHERE id = ?', id);
        createCycleInvoice(sub, plan, sub.cycles_billed);
        q.run('UPDATE subscriptions SET cycles_billed = cycles_billed + 1, next_invoice_date = ? WHERE id = ?',
          cycleDate(s.start_date, plan.billing_period, plan.interval_count, sub.cycles_billed + 1), id);
        break;
      }
    }
    return { sub: getSubscription(id), email };
  });
  if (result.email) await sendMail(result.email);
  return result.sub;
}

export function activate(s) {
  q.run(`UPDATE subscriptions SET status='active', paused=0, cycles_billed=0, next_invoice_date=? WHERE id=?`, s.start_date, s.id);
}

/** On resume, cycles that would have started during the pause are skipped (not billed). */
function resume(s, today) {
  const plan = q.get('SELECT * FROM plans WHERE id = ?', s.plan_id);
  let k = s.cycles_billed;
  while (cycleDate(s.start_date, plan.billing_period, plan.interval_count, k) < today) k++;
  q.run('UPDATE subscriptions SET paused = 0, cycles_billed = ?, next_invoice_date = ? WHERE id = ?',
    k, cycleDate(s.start_date, plan.billing_period, plan.interval_count, k), s.id);
}
