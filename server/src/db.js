import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Tax rules: a product can point at a tax explicitly; otherwise the rule
-- matching its product type applies; otherwise the default rule.
CREATE TABLE IF NOT EXISTS taxes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate >= 0 AND rate <= 100),
  product_type TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service','software','goods')),
  sales_price REAL NOT NULL CHECK (sales_price >= 0),
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  notes TEXT,
  tax_id INTEGER REFERENCES taxes(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_attributes (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attribute_values (
  id INTEGER PRIMARY KEY,
  attribute_id INTEGER NOT NULL REFERENCES product_attributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  extra_price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('daily','weekly','monthly','yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  duration_cycles INTEGER CHECK (duration_cycles IS NULL OR duration_cycles >= 1),
  available_from TEXT,
  available_to TEXT,
  auto_close INTEGER NOT NULL DEFAULT 1,
  closable INTEGER NOT NULL DEFAULT 1,
  pausable INTEGER NOT NULL DEFAULT 0,
  renewable INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quotation_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  validity_days INTEGER NOT NULL CHECK (validity_days >= 1),
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  payment_terms_days INTEGER NOT NULL DEFAULT 15,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS template_lines (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  variant_value_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  template_id INTEGER REFERENCES quotation_templates(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quotation','confirmed','active','closed')),
  paused INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  expiry_date TEXT,
  next_invoice_date TEXT,
  cycles_billed INTEGER NOT NULL DEFAULT 0,
  payment_terms_days INTEGER NOT NULL DEFAULT 15,
  quote_valid_until TEXT,
  notes TEXT,
  closed_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscription_lines (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  description TEXT NOT NULL,
  variant_value_ids TEXT NOT NULL DEFAULT '[]',
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price REAL NOT NULL,
  tax_id INTEGER REFERENCES taxes(id),
  tax_rate REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value REAL NOT NULL CHECK (value > 0),
  min_amount REAL NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses >= 1),
  used_count INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE,
  subscription_id INTEGER REFERENCES subscriptions(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','paid','cancelled')),
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  cycle_index INTEGER,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  emailed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  discount_id INTEGER REFERENCES discounts(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  method TEXT NOT NULL CHECK (method IN ('card','bank_transfer','cash','upi','cheque','other')),
  date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_runs (
  id INTEGER PRIMARY KEY,
  run_date TEXT NOT NULL,
  invoices_created INTEGER NOT NULL,
  subscriptions_closed INTEGER NOT NULL,
  subscriptions_renewed INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Double-billing guard: one invoice per subscription per billing cycle.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_sub_cycle ON invoices(subscription_id, cycle_index)
  WHERE subscription_id IS NOT NULL AND cycle_index IS NOT NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS ix_sub_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS ix_sub_customer ON subscriptions(customer_id, status);
CREATE INDEX IF NOT EXISTS ix_sub_billing ON subscriptions(status, paused, next_invoice_date);
CREATE INDEX IF NOT EXISTS ix_sub_lines ON subscription_lines(subscription_id);
CREATE INDEX IF NOT EXISTS ix_inv_status_due ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS ix_inv_customer ON invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_sub ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS ix_inv_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS ix_inv_lines ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS ix_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS ix_pay_date ON payments(date);
CREATE INDEX IF NOT EXISTS ix_attr_product ON product_attributes(product_id);
CREATE INDEX IF NOT EXISTS ix_attrval_attr ON attribute_values(attribute_id);
CREATE INDEX IF NOT EXISTS ix_tpl_lines ON template_lines(template_id);
CREATE INDEX IF NOT EXISTS ix_resets_user ON password_resets(user_id);
`;

let db;

export function getDb() {
  if (!db) db = openDb(config.dbPath);
  return db;
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  d.exec(SCHEMA);
  return d;
}

/** Swap the active database (used by tests). */
export function setDb(d) { db = d; }

/** Run fn inside a write transaction; rolls back on throw. Re-entrant. */
let depth = 0;
export function tx(fn) {
  const d = getDb();
  if (depth > 0) return fn(d);
  d.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const q = {
  get: (sql, ...p) => getDb().prepare(sql).get(...p),
  all: (sql, ...p) => getDb().prepare(sql).all(...p),
  run: (sql, ...p) => getDb().prepare(sql).run(...p),
};
