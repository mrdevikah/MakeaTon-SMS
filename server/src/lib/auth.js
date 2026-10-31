import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { q } from '../db.js';
import { HttpError, forbidden } from './util.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtTtl });

/** Verifies the bearer token and loads the (still active) user onto req.user. */
export function authenticate(req, _res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = q.get('SELECT id, email, name, role, customer_id, active FROM users WHERE id = ?', payload.sub);
    if (!user || !user.active) return next(new HttpError(401, 'Account disabled or missing'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired session'));
  }
}

/** RBAC guard: requireRole('admin') or requireRole('admin','staff'). */
export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden('You do not have permission for this action'));

export const isInternal = (user) => user.role === 'admin' || user.role === 'staff';

/** For customer-scoped reads: returns the customer id to filter by, or null for internal users. */
export function scopeCustomer(user) {
  if (isInternal(user)) return null;
  if (!user.customer_id) throw forbidden('No customer account is linked to this login');
  return user.customer_id;
}

/** Simple fixed-window rate limiter for auth endpoints (in-memory, per IP+route). */
const hits = new Map();
export const rateLimit = (max, windowMs) => (req, _res, next) => {
  if (process.env.NODE_ENV === 'test' && !req.headers['x-test-ratelimit']) return next();
  const key = req.ip + req.path;
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now - e.start > windowMs) { hits.set(key, { start: now, n: 1 }); return next(); }
  if (++e.n > max) return next(new HttpError(429, 'Too many attempts, try again shortly'));
  next();
};
