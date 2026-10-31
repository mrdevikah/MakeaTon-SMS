import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'brightloop.db'),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-brightloop',
  jwtTtl: process.env.JWT_TTL || '8h',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  companyName: 'Brightloop Software',
  currency: process.env.CURRENCY || 'INR',
  // Optional SMTP; when absent, mail goes to the email_outbox table (viewable in the admin UI).
  smtp: process.env.SMTP_HOST ? {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  } : null,
  mailFrom: process.env.MAIL_FROM || 'Brightloop Billing <billing@brightloop.local>',
  billingIntervalMs: Number(process.env.BILLING_INTERVAL_MS || 60 * 60 * 1000),
  disableScheduler: process.env.DISABLE_SCHEDULER === 'true',
};
