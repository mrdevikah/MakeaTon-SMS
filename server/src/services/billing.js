import { q, tx } from '../db.js';
import { config } from '../config.js';
import { cycleDate, todayISO } from '../lib/util.js';
import { activate } from './subscriptions.js';
import { createCycleInvoice } from './invoicing.js';

const MAX_CATCHUP = 1000; // safety bound per subscription per run

/** First cycle index whose start date is on/after `date`. */
function cycleIndexAt(sub, plan, date) {
  let k = 0;
  while (cycleDate(sub.start_date, plan.billing_period, plan.interval_count, k) < date && k < 100000) k++;
  return k;
}

/**
 * Bill one subscription up to `asOf`. Runs in its own transaction and re-reads
 * the row inside it, so concurrent runs serialize and never bill a cycle twice.
 * Every due cycle is billed (catch-up), so downtime never causes skipped cycles.
 */
export function billSubscription(subId, asOf) {
  return tx(() => {
    const sub = q.get('SELECT * FROM subscriptions WHERE id = ?', subId);
    const out = { invoices: 0, closed: 0, renewed: 0 };
    if (!sub || sub.status !== 'active' || sub.paused) return out;
    const plan = q.get('SELECT * FROM plans WHERE id = ?', sub.plan_id);
    let k = sub.cycles_billed;
    let expiry = sub.expiry_date;

    for (let guard = 0; guard < MAX_CATCHUP; guard++) {
      const ps = cycleDate(sub.start_date, plan.billing_period, plan.interval_count, k);
      const withinTerm = !expiry || ps < expiry;
      if (withinTerm && ps <= asOf) {
        if (createCycleInvoice({ ...sub, expiry_date: expiry }, plan, k)) out.invoices++;
        k++;
        continue;
      }
      if (!withinTerm && expiry <= asOf) {
        if (plan.renewable) {
          // Renew for another term of the same length (duration_cycles, or the original term).
          const expIdx = cycleIndexAt(sub, plan, expiry);
          const term = plan.duration_cycles || Math.max(1, expIdx);
          expiry = cycleDate(sub.start_date, plan.billing_period, plan.interval_count, expIdx + term);
          out.renewed++;
          continue;
        }
        if (plan.auto_close) {
          q.run(`UPDATE subscriptions SET status='closed', closed_reason='completed' WHERE id=?`, sub.id);
          out.closed++;
        }
      }
      break;
    }
    q.run('UPDATE subscriptions SET cycles_billed = ?, next_invoice_date = ?, expiry_date = ? WHERE id = ?',
      k, cycleDate(sub.start_date, plan.billing_period, plan.interval_count, k), expiry, sub.id);
    return out;
  });
}

let running = false;

/** Batch run: activate confirmed subscriptions whose start date has arrived, then bill everything due. */
export function runBilling(asOf = todayISO()) {
  if (running) return { skipped: true, reason: 'A billing run is already in progress' };
  running = true;
  try {
    const totals = { run_date: asOf, activated: 0, invoices_created: 0, subscriptions_closed: 0, subscriptions_renewed: 0 };
    tx(() => {
      for (const s of q.all(`SELECT id, start_date FROM subscriptions WHERE status = 'confirmed' AND start_date <= ?`, asOf)) {
        activate(s); totals.activated++;
      }
    });
    // Keyset pagination over due subscriptions keeps memory flat for large books.
    let lastId = 0;
    for (;;) {
      const batch = q.all(
        `SELECT id FROM subscriptions WHERE status = 'active' AND paused = 0 AND id > ?
           AND (next_invoice_date <= ? OR (expiry_date IS NOT NULL AND expiry_date <= ?))
         ORDER BY id LIMIT 500`, lastId, asOf, asOf);
      if (!batch.length) break;
      for (const { id } of batch) {
        const r = billSubscription(id, asOf);
        totals.invoices_created += r.invoices;
        totals.subscriptions_closed += r.closed;
        totals.subscriptions_renewed += r.renewed;
        lastId = id;
      }
    }
    q.run('INSERT INTO billing_runs (run_date, invoices_created, subscriptions_closed, subscriptions_renewed) VALUES (?,?,?,?)',
      asOf, totals.invoices_created, totals.subscriptions_closed, totals.subscriptions_renewed);
    return totals;
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (config.disableScheduler) return null;
  const tick = () => {
    try {
      const r = runBilling();
      if (r.invoices_created || r.activated) console.log('[billing]', r);
    } catch (e) { console.error('[billing] run failed', e); }
  };
  setTimeout(tick, 2000);
  return setInterval(tick, config.billingIntervalMs);
}
