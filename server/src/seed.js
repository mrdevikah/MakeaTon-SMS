/**
 * Demo data. `npm run seed` resets the DB with a realistic book of business;
 * `npm run seed:bulk` loads thousands of records for performance testing.
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb, q, tx } from './db.js';
import { addDays, addMonths, todayISO } from './lib/util.js';
import { createSubscription, transitionSubscription } from './services/subscriptions.js';
import { runBilling } from './services/billing.js';
import { recordPayment, transitionInvoice } from './services/invoicing.js';

export const DEMO = {
  admin: { email: 'admin@brightloop.io', password: 'Admin@12345' },
  staff: { email: 'staff@brightloop.io', password: 'Staff@12345' },
  customer: { email: 'priya@acmeretail.in', password: 'Customer@123' },
};

let s = 42; // deterministic PRNG so demo data is stable
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const COMPANIES = ['Acme Retail', 'Kochi Spices Co', 'Malabar Logistics', 'Nimbus Labs', 'Periyar Textiles', 'Vertex Health', 'Blue Lotus Hotels',
  'Coastal Fintech', 'Greenfield Agro', 'Orbit Media', 'Sahyadri Motors', 'Lighthouse Edu', 'Quantum Pharma', 'Harbor Freight', 'Saffron Foods',
  'Pixel Forge', 'Tranquil Spa', 'Monsoon Travels', 'Ironclad Security', 'Silverline Realty', 'Northstar Legal', 'Cardamom Hills Tea',
  'Brightside Clinics', 'Delta Electricals', 'Evergreen Interiors', 'Falcon Couriers', 'Granite Builders', 'Horizon Telecom'];

export function seed({ bulk = false, today = todayISO() } = {}) {
  const db = getDb();
  db.exec(`DELETE FROM payments; DELETE FROM invoice_lines; DELETE FROM invoices; DELETE FROM subscription_lines; DELETE FROM subscriptions;
    DELETE FROM template_lines; DELETE FROM quotation_templates; DELETE FROM discounts; DELETE FROM attribute_values; DELETE FROM product_attributes;
    DELETE FROM products; DELETE FROM plans; DELETE FROM password_resets; DELETE FROM users; DELETE FROM customers; DELETE FROM taxes;
    DELETE FROM email_outbox; DELETE FROM billing_runs;`);
  s = 42;
  const ins = (sql, ...p) => Number(q.run(sql, ...p).lastInsertRowid);

  tx(() => {
    const gst18 = ins(`INSERT INTO taxes (name, rate, is_default) VALUES ('GST 18%', 18, 1)`);
    ins(`INSERT INTO taxes (name, rate, product_type) VALUES ('GST 12% (Goods)', 12, 'goods')`);
    ins(`INSERT INTO taxes (name, rate, active) VALUES ('Service Tax 15% (legacy)', 15, 0)`);

    const crm = ins(`INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('Brightloop CRM Seat','software',1200,180,'Per-user CRM licence',?)`, gst18);
    const brand = ins('INSERT INTO product_attributes (product_id, name) VALUES (?, ?)', crm, 'Brand');
    for (const [v, p] of [['Standard', 0], ['Odoo', 560], ['Zoho', 300]]) ins('INSERT INTO attribute_values (attribute_id, value, extra_price) VALUES (?,?,?)', brand, v, p);
    const edition = ins('INSERT INTO product_attributes (product_id, name) VALUES (?, ?)', crm, 'Edition');
    for (const [v, p] of [['Starter', 0], ['Pro', 800]]) ins('INSERT INTO attribute_values (attribute_id, value, extra_price) VALUES (?,?,?)', edition, v, p);
    const host = ins(`INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES ('Managed Cloud Hosting','service',2500,1100,'Includes daily backups')`);
    const region = ins('INSERT INTO product_attributes (product_id, name) VALUES (?, ?)', host, 'Region');
    for (const [v, p] of [['Mumbai', 0], ['Singapore', 400], ['Frankfurt', 650]]) ins('INSERT INTO attribute_values (attribute_id, value, extra_price) VALUES (?,?,?)', region, v, p);
    ins(`INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES ('Priority Support Retainer','service',5000,2200,'4h response SLA')`);
    ins(`INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES ('Hardware Security Key','goods',899,420,'Shipped per seat')`);
    ins(`INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES ('Analytics Add-on','software',1500,200,NULL)`);

    ins(`INSERT INTO plans (name, billing_period, interval_count, min_quantity, renewable, pausable, closable, auto_close) VALUES ('Monthly Flex','monthly',1,1,1,1,1,1)`);
    ins(`INSERT INTO plans (name, billing_period, interval_count, min_quantity, duration_cycles, renewable, pausable, closable) VALUES ('Annual Commit','yearly',1,1,1,1,0,0)`);
    ins(`INSERT INTO plans (name, billing_period, interval_count, min_quantity, duration_cycles, auto_close, closable, pausable) VALUES ('Quarterly Term (12 mo)','monthly',3,5,4,1,0,1)`);
    ins(`INSERT INTO plans (name, billing_period, interval_count, min_quantity, duration_cycles, auto_close, available_to) VALUES ('Weekly Pilot','weekly',1,1,4,1,?)`, addMonths(today, 3));

    const t1 = ins(`INSERT INTO quotation_templates (name, validity_days, plan_id, payment_terms_days, notes) VALUES ('CRM Starter Bundle',14,1,15,'5 seats + hosting')`);
    ins(`INSERT INTO template_lines (template_id, product_id, quantity, variant_value_ids) VALUES (?,?,5,'[1,4]')`, t1, crm);
    ins(`INSERT INTO template_lines (template_id, product_id, quantity, variant_value_ids) VALUES (?,?,1,'[6]')`, t1, host);
    const t2 = ins(`INSERT INTO quotation_templates (name, validity_days, plan_id, payment_terms_days, notes) VALUES ('Enterprise Annual (Odoo)',30,2,30,'Odoo-branded Pro seats with support')`);
    ins(`INSERT INTO template_lines (template_id, product_id, quantity, variant_value_ids) VALUES (?,?,25,'[2,5]')`, t2, crm);
    ins(`INSERT INTO template_lines (template_id, product_id, quantity, variant_value_ids) VALUES (?,3,1,'[]')`, t2);

    ins(`INSERT INTO discounts (name, type, value, min_amount, max_uses, start_date) VALUES ('Welcome 10%','percent',10,8000,40,?)`, addMonths(today, -12));
    ins(`INSERT INTO discounts (name, type, value, min_quantity, product_id) VALUES ('Bulk seats 15%','percent',15,20,?)`, crm);
    ins(`INSERT INTO discounts (name, type, value, min_amount, start_date, end_date) VALUES ('Festive ₹500 off','fixed',500,5000,?,?)`, addDays(today, -20), addDays(today, 25));
    ins(`INSERT INTO discounts (name, type, value, start_date, end_date) VALUES ('Summer launch 5%','percent',5,?,?)`, addMonths(today, -6), addMonths(today, -4));

    const hash = (p) => bcrypt.hashSync(p, 10);
    ins(`INSERT INTO users (email, password_hash, name, role) VALUES (?,?,'Anita Menon','admin')`, DEMO.admin.email, hash(DEMO.admin.password));
    ins(`INSERT INTO users (email, password_hash, name, role) VALUES (?,?,'Rahul Varma','staff')`, DEMO.staff.email, hash(DEMO.staff.password));
    const acme = ins(`INSERT INTO customers (name, email, phone, address) VALUES ('Acme Retail', ?, '+91 98470 12345', 'MG Road, Kochi, Kerala 682016')`, DEMO.customer.email);
    ins(`INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,'Priya Nair','customer',?)`, DEMO.customer.email, hash(DEMO.customer.password), acme);

    const nCust = bulk ? 3000 : COMPANIES.length;
    for (let i = 1; i < nCust; i++) {
      const name = i < COMPANIES.length ? COMPANIES[i] : `${pick(COMPANIES)} ${i}`;
      ins('INSERT INTO customers (name, email, phone, address) VALUES (?,?,?,?)', name,
        `billing${i}@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.in`, `+91 9${String(100000000 + i * 7919).slice(0, 9)}`, pick(['Kochi', 'Thrissur', 'Bengaluru', 'Chennai', 'Mumbai']) + ', India');
    }
  });

  // Subscriptions spread over the last year, then let the real billing engine generate history.
  const admin = { id: 1, role: 'admin' };
  const nSubs = bulk ? 5000 : 46;
  const custCount = q.get('SELECT COUNT(*) n FROM customers').n;
  const variantSets = [[1, 4], [2, 4], [2, 5], [3, 4], [1, 5]];
  for (let i = 0; i < nSubs; i++) {
    const plan = i % 9 === 0 ? 2 : i % 7 === 0 ? 3 : 1;
    const start = addDays(today, -Math.floor(rnd() * (bulk ? 300 : 330)) - 5);
    const lines = [{ product_id: 1, quantity: plan === 3 ? 5 + Math.floor(rnd() * 30) : 1 + Math.floor(rnd() * 24), variant_value_ids: pick(variantSets) }];
    if (rnd() > 0.45) lines.push({ product_id: 2, quantity: plan === 3 ? 5 : 1, variant_value_ids: [6 + Math.floor(rnd() * 3)] });
    if (rnd() > 0.7) lines.push({ product_id: 3, quantity: plan === 3 ? 5 : 1, variant_value_ids: [] });
    const sub = createSubscription({ customer_id: i === 0 ? 1 : 1 + Math.floor(rnd() * custCount), plan_id: plan, start_date: start, payment_terms_days: 15, lines }, 1);
    const fate = rnd();
    q.run(`UPDATE subscriptions SET status = ? WHERE id = ?`, fate < 0.06 ? 'quotation' : fate < 0.1 ? 'draft' : 'confirmed', sub.id);
    if (fate < 0.06) q.run('UPDATE subscriptions SET quote_valid_until = ? WHERE id = ?', addDays(today, 10), sub.id);
  }
  // A couple of clearly-upcoming items for the portal demo.
  const up = createSubscription({ customer_id: 1, plan_id: 1, template_id: 1, start_date: addDays(today, 3), payment_terms_days: 15,
    lines: [{ product_id: 5, quantity: 3, variant_value_ids: [] }] }, 1);
  q.run(`UPDATE subscriptions SET status='quotation', quote_valid_until=? WHERE id=?`, addDays(today, 14), up.id);

  // Replay billing month by month so discounts with caps/date windows behave as they would have.
  for (let d = addDays(today, -340); d < today; d = addDays(d, 7)) runBilling(d);
  runBilling(today);

  // Confirm and settle history: most older invoices paid, some partially, some left overdue.
  const methods = ['bank_transfer', 'card', 'upi', 'card', 'bank_transfer', 'cheque'];
  const invs = q.all(`SELECT id, invoice_date, due_date, total FROM invoices WHERE status = 'draft' ORDER BY id`);
  for (const inv of invs) {
    if (inv.invoice_date > addDays(today, -2) && rnd() < 0.6) continue; // fresh ones stay as drafts for staff to review
    transitionInvoice(inv.id, 'confirm');
    const r = rnd();
    if (inv.due_date < today ? r < 0.88 : r < 0.3) {
      const payDate = [addDays(inv.invoice_date, Math.floor(rnd() * 14)), today].sort()[0];
      const amount = rnd() < 0.08 ? Math.round(inv.total * 0.5 * 100) / 100 : inv.total;
      recordPayment({ invoice_id: inv.id, method: pick(methods), date: payDate, amount, notes: amount < inv.total ? 'Part payment' : null }, 2);
    }
  }
  // Close a few early to show the full lifecycle.
  for (const { id } of q.all(`SELECT id FROM subscriptions WHERE status='active' AND plan_id = 1 ORDER BY id DESC LIMIT 3`))
    transitionSubscription(id, 'close', admin, { reason: 'Customer churned' });
  const pausable = q.get(`SELECT id FROM subscriptions WHERE status='active' AND plan_id = 1 AND customer_id <> 1 LIMIT 1`);
  if (pausable) q.run('UPDATE subscriptions SET paused = 1 WHERE id = ?', pausable.id);
  db.exec('DELETE FROM email_outbox; ANALYZE;');
  return {
    customers: q.get('SELECT COUNT(*) n FROM customers').n,
    subscriptions: q.get('SELECT COUNT(*) n FROM subscriptions').n,
    invoices: q.get('SELECT COUNT(*) n FROM invoices').n,
    payments: q.get('SELECT COUNT(*) n FROM payments').n,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (fs.existsSync(config.dbPath)) for (const f of [config.dbPath, config.dbPath + '-wal', config.dbPath + '-shm']) fs.rmSync(f, { force: true });
  const t = Date.now();
  const out = seed({ bulk: process.argv.includes('--bulk') });
  console.log('Seeded', out, `in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log('Logins:', Object.entries(DEMO).map(([k, v]) => `${k}: ${v.email} / ${v.password}`).join(' | '));
}
