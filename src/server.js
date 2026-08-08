import './lib/loadenv.js'; // must be first so config/Prisma see env vars
import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { config } from './config.js';
import { t } from './lib/i18n.js';
import { securityHeaders } from './middleware/security.js';
import { PrismaSessionStore } from './lib/sessionstore.js';

import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import itemRoutes from './routes/items.js';
import dishRoutes from './routes/dishes.js';
import recipeRoutes from './routes/recipes.js';
import dailyRoutes from './routes/daily.js';
import orderRoutes from './routes/orders.js';
import bufferRoutes from './routes/buffers.js';
import auditRoutes from './routes/audit.js';
import userRoutes from './routes/users.js';
import wasteDeclRoutes from './routes/wastedecl.js';
import packagingRoutes from './routes/packaging.js';
import historyRoutes from './routes/history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1); // behind Hostinger/Passenger proxy
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));

app.use(
  session({
    name: 'lcasaoui.sid',
    secret: config.sessionSecret,
    store: new PrismaSessionStore(), // DB-backed: survives restarts, Postgres-portable
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh expiry on activity
    cookie: {
      httpOnly: true,
      sameSite: 'strict', // SPA is same-origin; strict blocks all cross-site sending
      secure: config.isProd, // requires HTTPS in production (lesracinesdor.ma)
      maxAge: config.security.sessionTtlMs,
    },
  }),
);

// ── API ────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/dishes', dishRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/buffers', bufferRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/users', userRoutes);
app.use('/api/waste-declarations', wasteDeclRoutes);
app.use('/api/packaging', packagingRoutes);
app.use('/api/history', historyRoutes);

// Unknown API route -> JSON 404 (don't fall through to the SPA).
app.use('/api', (req, res) => res.status(404).json({ error: t('errors.notFound') }));

// ── Frontend (built SPA) ─────────────────────────────────────────────────────
const distDir = join(__dirname, '..', 'frontend', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(join(distDir, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res
      .type('text/plain')
      .send('API en ligne. Construisez le frontend: npm run build:frontend (voir README).'),
  );
}

// ── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || t('errors.server') });
});

app.listen(config.port, () => {
  console.log(`L'Casaoui Stock Tool — API on :${config.port} (${config.isProd ? 'prod' : 'dev'})`);
});
