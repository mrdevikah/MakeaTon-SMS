import { createApp } from './app.js';
import { config } from './config.js';
import { getDb, q } from './db.js';
import { startScheduler } from './services/billing.js';
import { seed } from './seed.js';

getDb();
if (!q.get('SELECT 1 FROM users LIMIT 1')) {
  console.log('[setup] Empty database — loading demo data');
  seed();
}
createApp().listen(config.port, () => {
  console.log(`Brightloop API listening on http://localhost:${config.port}`);
  startScheduler();
});
