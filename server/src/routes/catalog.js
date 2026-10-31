import { Router } from 'express';
import { q, tx } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { schemas, validate } from '../lib/validation.js';
import { bool, conflict, h, notFound, todayISO } from '../lib/util.js';

const r = Router();
const admin = requireRole('admin');
const internal = requireRole('admin', 'staff');

// ---------- Taxes ----------
r.get('/taxes', internal, (_req, res) => res.json(q.all('SELECT * FROM taxes ORDER BY active DESC, name')));
const saveTax = (id) => h((req, res) => {
  const t = validate(schemas.tax, req.body);
  const out = tx(() => {
    if (t.is_default) q.run('UPDATE taxes SET is_default = 0');
    if (id(req)) {
      if (!q.run('UPDATE taxes SET name=?, rate=?, product_type=?, is_default=?, active=? WHERE id=?',
        t.name, t.rate, t.product_type ?? null, bool(t.is_default), bool(t.active ?? true), id(req)).changes) throw notFound();
      return id(req);
    }
    return Number(q.run('INSERT INTO taxes (name, rate, product_type, is_default, active) VALUES (?,?,?,?,?)',
      t.name, t.rate, t.product_type ?? null, bool(t.is_default), bool(t.active ?? true)).lastInsertRowid);
  });
  res.status(id(req) ? 200 : 201).json(q.get('SELECT * FROM taxes WHERE id = ?', out));
});
r.post('/taxes', admin, saveTax(() => null));
r.put('/taxes/:id', admin, saveTax((req) => Number(req.params.id)));
r.delete('/taxes/:id', admin, h((req, res) => {
  q.run('UPDATE taxes SET active = 0, is_default = 0 WHERE id = ?', req.params.id); // soft-delete: historic invoices keep their rate
  res.json({ ok: true });
}));

// ---------- Products & variants ----------
function productWithAttrs(id) {
  const p = q.get('SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?', id);
  if (!p) return null;
  p.attributes = q.all('SELECT id, name FROM product_attributes WHERE product_id = ? ORDER BY id', id).map((a) => ({
    ...a, values: q.all('SELECT id, value, extra_price FROM attribute_values WHERE attribute_id = ? ORDER BY id', a.id),
  }));
  return p;
}

r.get('/products', internal, h((req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.q) { where.push('p.name LIKE ?'); params.push(`%${req.query.q}%`); }
  if (req.query.active !== 'all') where.push('p.active = 1');
  const rows = q.all(`SELECT p.*, t.name AS tax_name, (SELECT COUNT(*) FROM product_attributes a WHERE a.product_id = p.id) AS attribute_count
    FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 500`, ...params);
  res.json(req.query.withVariants ? rows.map((p) => productWithAttrs(p.id)) : rows);
}));
r.get('/products/:id', internal, h((req, res) => {
  const p = productWithAttrs(Number(req.params.id));
  if (!p) throw notFound('Product not found');
  res.json(p);
}));

const saveProduct = (isNew) => h((req, res) => {
  const p = validate(schemas.product, req.body);
  const id = tx(() => {
    let pid = Number(req.params.id);
    if (isNew) {
      pid = Number(q.run('INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id, active) VALUES (?,?,?,?,?,?,?)',
        p.name, p.type, p.sales_price, p.cost_price, p.notes ?? null, p.tax_id ?? null, bool(p.active ?? true)).lastInsertRowid);
    } else if (!q.run('UPDATE products SET name=?, type=?, sales_price=?, cost_price=?, notes=?, tax_id=?, active=? WHERE id=?',
      p.name, p.type, p.sales_price, p.cost_price, p.notes ?? null, p.tax_id ?? null, bool(p.active ?? true), pid).changes) throw notFound();
    // Variants are replaced wholesale; existing subscription lines keep their frozen description & price.
    q.run('DELETE FROM product_attributes WHERE product_id = ?', pid);
    for (const a of p.attributes) {
      const aid = q.run('INSERT INTO product_attributes (product_id, name) VALUES (?,?)', pid, a.name).lastInsertRowid;
      for (const v of a.values) q.run('INSERT INTO attribute_values (attribute_id, value, extra_price) VALUES (?,?,?)', aid, v.value, v.extra_price);
    }
    return pid;
  });
  res.status(isNew ? 201 : 200).json(productWithAttrs(id));
});
r.post('/products', admin, saveProduct(true));
r.put('/products/:id', admin, saveProduct(false));
r.delete('/products/:id', admin, h((req, res) => {
  q.run('UPDATE products SET active = 0 WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// ---------- Plans ----------
const planCols = ['name', 'billing_period', 'interval_count', 'min_quantity', 'duration_cycles', 'available_from', 'available_to',
  'auto_close', 'closable', 'pausable', 'renewable', 'active'];
const planVals = (p) => [p.name, p.billing_period, p.interval_count, p.min_quantity, p.duration_cycles ?? null, p.available_from ?? null,
  p.available_to ?? null, bool(p.auto_close), bool(p.closable), bool(p.pausable), bool(p.renewable), bool(p.active ?? true)];

r.get('/plans', internal, h((req, res) => {
  const t = todayISO();
  const avail = req.query.available ? 'AND active = 1 AND (available_from IS NULL OR available_from <= ?) AND (available_to IS NULL OR available_to >= ?)' : '';
  res.json(q.all(`SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active') AS active_subscriptions
    FROM plans p WHERE 1=1 ${avail} ORDER BY active DESC, name`, ...(avail ? [t, t] : [])));
}));
r.post('/plans', admin, h((req, res) => {
  const p = validate(schemas.plan, req.body);
  const id = q.run(`INSERT INTO plans (${planCols}) VALUES (${planCols.map(() => '?')})`, ...planVals(p)).lastInsertRowid;
  res.status(201).json(q.get('SELECT * FROM plans WHERE id = ?', id));
}));
r.put('/plans/:id', admin, h((req, res) => {
  const p = validate(schemas.plan, req.body);
  if (!q.run(`UPDATE plans SET ${planCols.map((c) => c + '=?')} WHERE id=?`, ...planVals(p), req.params.id).changes) throw notFound();
  res.json(q.get('SELECT * FROM plans WHERE id = ?', req.params.id));
}));
r.delete('/plans/:id', admin, h((req, res) => {
  q.run('UPDATE plans SET active = 0 WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// ---------- Quotation templates ----------
function template(id) {
  const t = q.get('SELECT t.*, p.name AS plan_name FROM quotation_templates t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = ?', id);
  if (!t) return null;
  t.lines = q.all('SELECT tl.*, pr.name AS product_name, pr.sales_price FROM template_lines tl JOIN products pr ON pr.id = tl.product_id WHERE template_id = ? ORDER BY tl.id', id)
    .map((l) => ({ ...l, variant_value_ids: JSON.parse(l.variant_value_ids) }));
  return t;
}
r.get('/templates', internal, (_req, res) =>
  res.json(q.all('SELECT t.id FROM quotation_templates t ORDER BY name').map((t) => template(t.id))));
const saveTemplate = (isNew) => h((req, res) => {
  const t = validate(schemas.template, req.body);
  const id = tx(() => {
    let tid = Number(req.params.id);
    if (isNew) tid = Number(q.run('INSERT INTO quotation_templates (name, validity_days, plan_id, payment_terms_days, notes) VALUES (?,?,?,?,?)',
      t.name, t.validity_days, t.plan_id ?? null, t.payment_terms_days, t.notes ?? null).lastInsertRowid);
    else if (!q.run('UPDATE quotation_templates SET name=?, validity_days=?, plan_id=?, payment_terms_days=?, notes=? WHERE id=?',
      t.name, t.validity_days, t.plan_id ?? null, t.payment_terms_days, t.notes ?? null, tid).changes) throw notFound();
    q.run('DELETE FROM template_lines WHERE template_id = ?', tid);
    for (const l of t.lines) q.run('INSERT INTO template_lines (template_id, product_id, quantity, variant_value_ids) VALUES (?,?,?,?)',
      tid, l.product_id, l.quantity, JSON.stringify(l.variant_value_ids));
    return tid;
  });
  res.status(isNew ? 201 : 200).json(template(id));
});
r.post('/templates', admin, saveTemplate(true));
r.put('/templates/:id', admin, saveTemplate(false));
r.delete('/templates/:id', admin, h((req, res) => {
  if (q.get(`SELECT 1 FROM subscriptions WHERE template_id = ? AND status IN ('draft','quotation')`, req.params.id))
    throw conflict('Template is used by open quotations');
  q.run('DELETE FROM quotation_templates WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// ---------- Discounts ----------
const discCols = ['name', 'type', 'value', 'min_amount', 'min_quantity', 'start_date', 'end_date', 'max_uses', 'product_id', 'active'];
const discVals = (d) => [d.name, d.type, d.value, d.min_amount, d.min_quantity, d.start_date ?? null, d.end_date ?? null,
  d.max_uses ?? null, d.product_id ?? null, bool(d.active ?? true)];
const discStatus = `CASE WHEN d.active = 0 THEN 'inactive' WHEN d.end_date IS NOT NULL AND d.end_date < ? THEN 'expired'
  WHEN d.max_uses IS NOT NULL AND d.used_count >= d.max_uses THEN 'exhausted' WHEN d.start_date IS NOT NULL AND d.start_date > ? THEN 'scheduled' ELSE 'live' END`;

r.get('/discounts', internal, (_req, res) => {
  const t = todayISO();
  res.json(q.all(`SELECT d.*, p.name AS product_name, ${discStatus} AS state FROM discounts d LEFT JOIN products p ON p.id = d.product_id ORDER BY d.id DESC`, t, t));
});
r.post('/discounts', admin, h((req, res) => {
  const d = validate(schemas.discount, req.body);
  const id = q.run(`INSERT INTO discounts (${discCols}) VALUES (${discCols.map(() => '?')})`, ...discVals(d)).lastInsertRowid;
  res.status(201).json(q.get('SELECT * FROM discounts WHERE id = ?', id));
}));
r.put('/discounts/:id', admin, h((req, res) => {
  const d = validate(schemas.discount, req.body);
  if (!q.run(`UPDATE discounts SET ${discCols.map((c) => c + '=?')} WHERE id=?`, ...discVals(d), req.params.id).changes) throw notFound();
  res.json(q.get('SELECT * FROM discounts WHERE id = ?', req.params.id));
}));
r.delete('/discounts/:id', admin, h((req, res) => {
  q.run('UPDATE discounts SET active = 0 WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

export default r;
