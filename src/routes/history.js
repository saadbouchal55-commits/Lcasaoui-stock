// Direction-only HISTORY views: browse past orders and past stock counts over a
// date range, read-only, with Excel export. Direction sees all restaurants; an
// optional locationId narrows to one.
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah, parseDate, ymd } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { t } from '../lib/i18n.js';

const router = Router();
router.use(requireAuth, requireRole('DIRECTION'));

const rangeEnd = (to) => { const d = new Date(to); d.setUTCDate(d.getUTCDate() + 1); return d; };

/** Flattened order lines (ordered qty > 0) across the range, oldest first. */
async function orderRows(from, to, locationId) {
  const where = { date: { gte: from, lt: rangeEnd(to) } };
  if (locationId) where.locationId = locationId;
  const orders = await prisma.orderSuggestion.findMany({
    where,
    include: { lines: { include: { item: true } }, location: true },
    orderBy: [{ date: 'asc' }, { locationId: 'asc' }, { seq: 'asc' }],
  });
  const rows = [];
  for (const o of orders) {
    for (const l of o.lines) {
      if ((l.orderedQty ?? 0) <= 0) continue;
      rows.push({ date: ymd(o.date), location: o.location.code, item: l.item.name, unit: l.item.unit, ordered: l.orderedQty, status: o.status });
    }
  }
  return rows;
}

/** Flattened stock counts (COUNT_SET = every physical count: initial + nightly). */
async function stockRows(from, to, locationId) {
  const where = { type: 'COUNT_SET', date: { gte: from, lt: rangeEnd(to) } };
  if (locationId) where.locationId = locationId;
  const moves = await prisma.stockMovement.findMany({
    where,
    include: { item: true, location: true },
    orderBy: [{ date: 'asc' }, { locationId: 'asc' }, { itemId: 'asc' }],
  });
  return moves.map((m) => ({
    date: ymd(m.date), location: m.location.code, item: m.item.name, unit: m.item.unit,
    counted: m.qty, source: m.ref === 'initial-stock' ? 'initial' : 'count',
  }));
}

function parseRange(req, res) {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (!from || !to) { res.status(400).json({ error: t('errors.validation'), fields: ['from', 'to'] }); return null; }
  const locationId = req.query.locationId ? Number(req.query.locationId) : null;
  return { from, to, locationId };
}

// ── Orders history ──────────────────────────────────────────────────────────
router.get('/orders', ah(async (req, res) => {
  const p = parseRange(req, res); if (!p) return;
  res.json({ rows: await orderRows(p.from, p.to, p.locationId) });
}));

router.get('/orders/export', ah(async (req, res) => {
  const p = parseRange(req, res); if (!p) return;
  const rows = await orderRows(p.from, p.to, p.locationId);
  const buffer = await buildWorkbook({
    sheetName: 'Historique commandes',
    title: t('history.ordersTitle'),
    meta: { Période: `${ymd(p.from)} → ${ymd(p.to)}` },
    columns: [
      { key: 'date', header: t('common.date') },
      { key: 'location', header: t('common.location') },
      { key: 'item', header: t('common.item'), width: 26 },
      { key: 'unit', header: t('common.unit') },
      { key: 'ordered', header: t('orders.ordered') },
      { key: 'status', header: t('orders.status') },
    ],
    rows: rows.map((r) => ({ ...r, unit: t(`units.${r.unit}`), status: t(`orderStatus.${r.status}`) })),
  });
  sendXlsx(res, `historique_commandes_${ymd(p.from)}_${ymd(p.to)}.xlsx`, buffer);
}));

// ── Stock history ───────────────────────────────────────────────────────────
router.get('/stock', ah(async (req, res) => {
  const p = parseRange(req, res); if (!p) return;
  res.json({ rows: await stockRows(p.from, p.to, p.locationId) });
}));

router.get('/stock/export', ah(async (req, res) => {
  const p = parseRange(req, res); if (!p) return;
  const rows = await stockRows(p.from, p.to, p.locationId);
  const buffer = await buildWorkbook({
    sheetName: 'Historique stock',
    title: t('history.stockTitle'),
    meta: { Période: `${ymd(p.from)} → ${ymd(p.to)}` },
    columns: [
      { key: 'date', header: t('common.date') },
      { key: 'location', header: t('common.location') },
      { key: 'item', header: t('common.item'), width: 26 },
      { key: 'unit', header: t('common.unit') },
      { key: 'counted', header: t('waste.counted') },
      { key: 'source', header: t('history.source') },
    ],
    rows: rows.map((r) => ({ ...r, unit: t(`units.${r.unit}`), source: t(`history.${r.source === 'initial' ? 'initial' : 'count'}`) })),
  });
  sendXlsx(res, `historique_stock_${ymd(p.from)}_${ymd(p.to)}.xlsx`, buffer);
}));

export default router;
