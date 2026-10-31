import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, tx } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { schemas, validate } from '../lib/validation.js';
import { badRequest, bool, conflict, h, notFound, paginate } from '../lib/util.js';

const r = Router();
const admin = requireRole('admin');
const internal = requireRole('admin', 'staff');

// ---------- Customers ----------
r.get('/customers', internal, h((req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const where = ['1=1'], params = [];
  if (req.query.q) { where.push('(c.name LIKE ? OR c.email LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const w = where.join(' AND ');
  const total = q.get(`SELECT COUNT(*) n FROM customers c WHERE ${w}`, ...params).n;
  const rows = q.all(`SELECT c.*,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active') AS active_subscriptions,
      (SELECT COALESCE(SUM(total - amount_paid),0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'confirmed') AS outstanding,
      EXISTS(SELECT 1 FROM users u WHERE u.customer_id = c.id) AS has_login
    FROM customers c WHERE ${w} ORDER BY c.name LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ rows, total, page, pageSize });
}));

r.get('/customers/:id', internal, h((req, res) => {
  const c = q.get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!c) throw notFound('Customer not found');
  res.json(c);
}));

r.post('/customers', internal, h(async (req, res) => {
  const c = validate(schemas.customer, req.body);
  if (q.get('SELECT 1 FROM customers WHERE email = ?', c.email)) throw conflict('A customer with this email already exists');
  if (c.create_login && q.get('SELECT 1 FROM users WHERE email = ?', c.email)) throw conflict('A login with this email already exists');
  const hash = c.create_login ? await bcrypt.hash(c.password, 10) : null;
  const id = tx(() => {
    const cid = Number(q.run('INSERT INTO customers (name, email, phone, address) VALUES (?,?,?,?)', c.name, c.email, c.phone ?? null, c.address ?? null).lastInsertRowid);
    if (hash) q.run(`INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?,'customer',?)`, c.email, hash, c.name, cid);
    return cid;
  });
  res.status(201).json(q.get('SELECT * FROM customers WHERE id = ?', id));
}));

r.put('/customers/:id', internal, h((req, res) => {
  const c = validate(schemas.customer, req.body);
  const dup = q.get('SELECT id FROM customers WHERE email = ? AND id <> ?', c.email, req.params.id);
  if (dup) throw conflict('Another customer uses this email');
  if (!q.run('UPDATE customers SET name=?, email=?, phone=?, address=? WHERE id=?', c.name, c.email, c.phone ?? null, c.address ?? null, req.params.id).changes) throw notFound();
  res.json(q.get('SELECT * FROM customers WHERE id = ?', req.params.id));
}));

// ---------- Users (admin creates staff/admin/customer logins) ----------
r.get('/users', admin, (_req, res) =>
  res.json(q.all('SELECT u.id, u.email, u.name, u.role, u.active, u.customer_id, u.created_at, c.name AS customer_name FROM users u LEFT JOIN customers c ON c.id = u.customer_id ORDER BY u.role, u.name')));

r.post('/users', admin, h(async (req, res) => {
  const u = validate(schemas.user, req.body);
  if (q.get('SELECT 1 FROM users WHERE email = ?', u.email)) throw conflict('An account with this email already exists');
  if (u.role === 'customer') {
    if (!u.customer_id) throw badRequest('Choose the customer this login belongs to', { customer_id: 'Required for customer logins' });
    if (!q.get('SELECT 1 FROM customers WHERE id = ?', u.customer_id)) throw badRequest('Customer not found', { customer_id: 'Not found' });
  }
  const id = q.run('INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?,?,?)',
    u.email, await bcrypt.hash(u.password, 10), u.name, u.role, u.role === 'customer' ? u.customer_id : null).lastInsertRowid;
  res.status(201).json(q.get('SELECT id, email, name, role, active, customer_id FROM users WHERE id = ?', id));
}));

r.patch('/users/:id', admin, h((req, res) => {
  const u = validate(schemas.userUpdate, req.body);
  const id = Number(req.params.id);
  if (id === req.user.id && (u.active === false || (u.role && u.role !== 'admin'))) throw conflict('You cannot disable or demote your own account');
  const cur = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!cur) throw notFound();
  q.run('UPDATE users SET name=?, role=?, active=? WHERE id=?', u.name ?? cur.name, u.role ?? cur.role, u.active === undefined ? cur.active : bool(u.active), id);
  res.json(q.get('SELECT id, email, name, role, active, customer_id FROM users WHERE id = ?', id));
}));

export default r;
