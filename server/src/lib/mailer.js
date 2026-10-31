import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { q } from '../db.js';

let transport;
function getTransport() {
  if (!transport && config.smtp) transport = nodemailer.createTransport(config.smtp);
  return transport;
}

/**
 * Every email is logged to email_outbox (so local dev works offline and
 * admins can inspect what was sent). If SMTP is configured it is also delivered.
 */
export async function sendMail({ to, subject, html }) {
  const row = q.run('INSERT INTO email_outbox (to_address, subject, html) VALUES (?,?,?)', to, subject, html);
  const t = getTransport();
  if (t) {
    try {
      await t.sendMail({ from: config.mailFrom, to, subject, html });
      q.run('UPDATE email_outbox SET delivered = 1 WHERE id = ?', row.lastInsertRowid);
    } catch (e) {
      console.error('[mail] SMTP delivery failed:', e.message);
    }
  } else if (process.env.NODE_ENV !== 'test') {
    console.log(`[mail] (outbox) to=${to} subject="${subject}"`);
  }
  return Number(row.lastInsertRowid);
}

export const layout = (title, body) => `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f4f5f7;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
<div style="font-weight:700;color:#4338ca;font-size:18px;margin-bottom:16px">◐ ${config.companyName}</div>
<h2 style="margin:0 0 12px;color:#111827;font-size:20px">${title}</h2>${body}
<p style="color:#9ca3af;font-size:12px;margin-top:28px">This is an automated message from ${config.companyName}.</p></div></body></html>`;
