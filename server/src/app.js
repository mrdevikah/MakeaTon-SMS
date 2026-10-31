import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import peopleRoutes from './routes/people.js';
import billingRoutes from './routes/billing.js';
import { authenticate } from './lib/auth.js';
import { HttpError } from './lib/util.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api', authenticate, catalogRoutes, peopleRoutes, billingRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));

  // Serve the built frontend when present (single-process production mode).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Malformed JSON body' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, fields: err.details });
  });
  return app;
}
