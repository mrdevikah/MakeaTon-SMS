import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q, tx } from '../db.js';
import { config } from '../config.js';
import { schemas, validate } from '../lib/validation.js';
import { authenticate, rateLimit, signToken } from '../lib/auth.js';
import { HttpError, badRequest, conflict, h } from '../lib/util.js';
import { sendMail, layout } from '../lib/mailer.js';

const r = Router();
const RESET_TTL_MIN = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, customer_id: u.customer_id });

// Constant-ish time: always run a bcrypt compare even when the user doesn't exist.
const DUMMY_HASH = bcrypt.hashSync('Dummy!password1', 10);

r.post('/login', rateLimit(10, 60_000), h(async (req, res) => {
  const { email, password } = validate(schemas.login, req.body);
  const u = q.get('SELECT * FROM users WHERE email = ?', email);
  const ok = await bcrypt.compare(password, u?.password_hash || DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Invalid email or password');
  if (!u.active) throw new HttpError(403, 'This account has been disabled');
  res.json({ token: signToken(u), user: publicUser(u) });
}));

/** Customer self-registration: creates the customer record + portal login. */
r.post('/signup', rateLimit(5, 60_000), h(async (req, res) => {
  const { name, email, password } = validate(schemas.signup, req.body);
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) throw conflict('An account with this email already exists');
  const hash = await bcrypt.hash(password, 10);
  const user = tx(() => {
    let cust = q.get('SELECT id FROM customers WHERE email = ?', email);
    if (!cust) cust = { id: Number(q.run('INSERT INTO customers (name, email) VALUES (?,?)', name, email).lastInsertRowid) };
    const id = q.run('INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?,?,?)',
      email, hash, name, 'customer', cust.id).lastInsertRowid;
    return q.get('SELECT * FROM users WHERE id = ?', id);
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

/** Always 200 so the endpoint can't be used to discover which emails exist. */
r.post('/forgot-password', rateLimit(5, 60_000), h(async (req, res) => {
  const { email } = validate(schemas.forgot, req.body);
  const u = q.get('SELECT id, name, email, active FROM users WHERE email = ?', email);
  if (u && u.active) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TTL_MIN * 60_000).toISOString();
    tx(() => {
      q.run('UPDATE password_resets SET used_at = datetime(\'now\') WHERE user_id = ? AND used_at IS NULL', u.id);
      q.run('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)', u.id, sha256(token), expires);
    });
    const link = `${config.appUrl}/reset-password?token=${token}`;
    await sendMail({
      to: u.email, subject: 'Reset your Brightloop password',
      html: layout('Password reset', `<p>Hi ${u.name},</p><p>Use the button below to choose a new password. The link expires in ${RESET_TTL_MIN} minutes and can be used once.</p>
<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reset password</a></p>
<p style="color:#6b7280;font-size:13px">If you didn't request this, you can ignore this email.</p>`),
    });
  }
  res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
}));

r.post('/reset-password', rateLimit(10, 60_000), h(async (req, res) => {
  const { token, password } = validate(schemas.reset, req.body);
  const row = q.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(token));
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) throw badRequest('This reset link is invalid or has expired');
  const hash = await bcrypt.hash(password, 10);
  tx(() => {
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, row.user_id);
    q.run('UPDATE password_resets SET used_at = datetime(\'now\') WHERE id = ?', row.id);
  });
  res.json({ ok: true });
}));

r.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

r.post('/change-password', authenticate, h(async (req, res) => {
  const { currentPassword, newPassword } = validate(schemas.changePassword, req.body);
  const u = q.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!(await bcrypt.compare(currentPassword, u.password_hash))) throw badRequest('Current password is incorrect', { currentPassword: 'Incorrect password' });
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(newPassword, 10), req.user.id);
  res.json({ ok: true });
}));

export default r;
