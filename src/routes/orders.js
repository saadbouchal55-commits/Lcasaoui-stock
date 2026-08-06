import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah, parseDate, ymd } from '../lib/http.js';
import { requireAuth, requireRole, assertLocationAccess, ORDER_ROLES } from '../middleware/auth.js';
import { computeSuggestions, generateOrder } from '../services/orderservice.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { buildBonCommande } from '../lib/boncommande.js';
import { groupByZoneSub } from '../lib/zones.js';
import { writeAudit } from '../lib/audit.js';
import { t } from '../lib/i18n.js';

const router = Router();

// French unit labels for the printed Bon de Commande (always French, like the paper form).
const UNIT_FR = { KG: 'kg', UNIT: 'unité', PIECE: 'pièce', PACKAGE: 'paquet', L: 'L', UNTRACKED: '—' };
// Establishment line per restaurant, as printed on the paper form.
const ESTABLISHMENT = { L1: 'LCASAOUI 1 Narjiss', L2: 'LCASAOUI 2 Rte Ain Chkef' };

// Every order endpoint is restricted to DIRECTION and ORDER_MANAGER.
// Restaurant managers / shift-leaders have NO order access at all.
router.use(requireAuth, requireRole(...ORDER_ROLES));

/** PRIMARY (seq 1) order view for one (location, date): status + food + packaging. */
async function buildPrimaryView(locationId, date) {
  const [order, { food, packaging }] = await Promise.all([
    prisma.orderSuggestion.findUnique({ where: { locationId_date_seq: { locationId, date, seq: 1 } }, include: { lines: true } }),
    computeSuggestions(locationId, date),
  ]);
  const lineByItem = new Map((order?.lines || []).map((l) => [l.itemId, l]));

  const foodView = food.map((f) => {
    const line = lineByItem.get(f.itemId);
    return {
      itemId: f.itemId, lineId: line?.id ?? null, name: f.name, unit: f.unit,
      storageZone: f.storageZone, subCategory: f.subCategory,
      currentStock: f.currentStock, avgDaily: f.avgDaily, mode: f.mode,
      suggestedQty: f.suggestedQty, orderedQty: line?.orderedQty ?? f.suggestedQty,
      flagged: line?.flagged ?? false, reason: f.reason,
    };
  });
  const packagingView = packaging.map((p) => {
    const line = lineByItem.get(p.itemId);
    return {
      itemId: p.itemId, lineId: line?.id ?? null, name: p.name, unit: p.unit,
      storageZone: p.storageZone, subCategory: p.subCategory,
      hintAvg: p.hintAvg, hintLast: p.hintLast, ordersInWindow: p.ordersInWindow,
      orderedQty: line?.orderedQty ?? null,
    };
  });

  return {
    id: order?.id ?? null, seq: 1, kind: 'primary', locationId, date: ymd(date),
    status: order?.status ?? 'GENERATED', exists: !!order,
    holdReason: order?.holdReason ?? null, confirmedBy: order?.confirmedBy ?? null, confirmedAt: order?.confirmedAt ?? null,
    food: foodView, packaging: packagingView,
  };
}

/** SUPPLEMENTARY (seq ≥ 2) order view — a flat manual line list. */
function mapSupplement(order) {
  return {
    id: order.id, seq: order.seq, kind: 'supplement', locationId: order.locationId, date: ymd(order.date),
    status: order.status, confirmedBy: order.confirmedBy, confirmedAt: order.confirmedAt,
    lines: order.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, name: l.item.name, unit: l.item.unit, orderedQty: l.orderedQty ?? 0 })),
  };
}
async function loadSupplement(orderId) {
  const order = await prisma.orderSuggestion.findUnique({ where: { id: orderId }, include: { lines: { include: { item: true } } } });
  return order ? mapSupplement(order) : null;
}

// List all orders (primary + supplements) for every restaurant for a date.
router.get(
  '/',
  ah(async (req, res) => {
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    const locations = await prisma.location.findMany({ where: { active: true }, orderBy: { code: 'asc' } });

    const out = [];
    for (const loc of locations) {
      const primary = await buildPrimaryView(loc.id, date);
      const supRows = await prisma.orderSuggestion.findMany({
        where: { locationId: loc.id, date, seq: { gte: 2 } },
        include: { lines: { include: { item: true } } },
        orderBy: { seq: 'asc' },
      });
      out.push({ locationId: loc.id, locationCode: loc.code, locationName: loc.name, primary, supplements: supRows.map(mapSupplement) });
    }
    res.json({ date: ymd(date), orders: out });
  }),
);

// Tracked items for the supplementary-order picker (Order Manager has no /api/items).
router.get(
  '/items',
  ah(async (req, res) => {
    const items = await prisma.item.findMany({ where: { active: true, isTracked: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true, inRecipes: true, storageZone: true, subCategory: true } });
    res.json({ items });
  }),
);

// (Re)generate the primary food order for a location/date (HOLD guardrails).
router.post(
  '/generate',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.body.locationId);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    const order = await generateOrder(locationId, date, req.user.id);
    if (order?.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée envoyée.' });
    if (order?.status === 'HELD') {
      await writeAudit({ userId: req.user.id, entity: 'order', entityId: `${locationId}:${ymd(date)}`, action: 'held', newValue: { reason: order.holdReason } });
    }
    res.json(await buildPrimaryView(locationId, date));
  }),
);

// Create a new supplementary (extra) same-day order for a restaurant.
router.post(
  '/supplementary',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.body.locationId);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    const agg = await prisma.orderSuggestion.aggregate({ where: { locationId, date }, _max: { seq: true } });
    const seq = (agg._max.seq || 0) + 1;
    const order = await prisma.orderSuggestion.create({ data: { locationId, date, seq, status: 'GENERATED', editedBy: req.user.id } });
    await writeAudit({ userId: req.user.id, entity: 'order', entityId: `${locationId}:${ymd(date)}:${seq}`, action: 'supplementary_created' });
    res.status(201).json(await loadSupplement(order.id));
  }),
);

// Add / set a line on an order (used by supplementary orders — any tracked item).
router.post(
  '/:orderId/line',
  ah(async (req, res) => {
    const orderId = Number(req.params.orderId);
    const itemId = Number(req.body.itemId);
    const qty = Number(req.body.qty);
    const order = await prisma.orderSuggestion.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: t('errors.notFound') });
    assertLocationAccess(req.user, order.locationId);
    if (order.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });
    if (!itemId || !(qty > 0)) return res.status(400).json({ error: t('errors.validation') });

    const existing = await prisma.orderLine.findFirst({ where: { suggestionId: orderId, itemId } });
    if (existing) await prisma.orderLine.update({ where: { id: existing.id }, data: { orderedQty: qty } });
    else await prisma.orderLine.create({ data: { suggestionId: orderId, itemId, suggestedQty: 0, orderedQty: qty } });
    await prisma.orderSuggestion.update({ where: { id: orderId }, data: { editedBy: req.user.id } });
    res.json(await loadSupplement(orderId));
  }),
);

// Edit a line's quantity / flag (before confirm).
router.put(
  '/line/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const line = await prisma.orderLine.findUnique({ where: { id }, include: { suggestion: true } });
    if (!line) return res.status(404).json({ error: t('errors.notFound') });
    assertLocationAccess(req.user, line.suggestion.locationId);
    if (line.suggestion.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });

    const data = {};
    if (req.body.orderedQty != null && req.body.orderedQty !== '') data.orderedQty = Math.max(0, Number(req.body.orderedQty));
    if (typeof req.body.flagged === 'boolean') data.flagged = req.body.flagged;
    await prisma.orderLine.update({ where: { id }, data });
    await prisma.orderSuggestion.update({ where: { id: line.suggestionId }, data: { editedBy: req.user.id } });
    res.json({ ok: true });
  }),
);

// Remove a line (supplementary orders).
router.delete(
  '/line/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const line = await prisma.orderLine.findUnique({ where: { id }, include: { suggestion: true } });
    if (!line) return res.status(404).json({ error: t('errors.notFound') });
    assertLocationAccess(req.user, line.suggestion.locationId);
    if (line.suggestion.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });
    await prisma.orderLine.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

// Set/upsert a FOOD line on the primary order by item — lets you order an item
// the system suggested 0 for (or adjust before generating). qty 0 removes it.
router.put(
  '/food-line',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.body.locationId);
    const date = parseDate(req.body.date);
    const itemId = Number(req.body.itemId);
    const qty = Math.max(0, Number(req.body.qty));
    if (!date || !itemId || Number.isNaN(qty)) return res.status(400).json({ error: t('errors.validation') });

    let order = await prisma.orderSuggestion.findUnique({ where: { locationId_date_seq: { locationId, date, seq: 1 } } });
    if (order?.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });
    if (!order) order = await prisma.orderSuggestion.create({ data: { locationId, date, seq: 1, status: 'GENERATED' } });

    const existing = await prisma.orderLine.findFirst({ where: { suggestionId: order.id, itemId } });
    if (qty > 0) {
      if (existing) await prisma.orderLine.update({ where: { id: existing.id }, data: { orderedQty: qty } });
      else await prisma.orderLine.create({ data: { suggestionId: order.id, itemId, suggestedQty: 0, orderedQty: qty } });
    } else if (existing) {
      await prisma.orderLine.update({ where: { id: existing.id }, data: { orderedQty: 0 } });
    }
    await prisma.orderSuggestion.update({ where: { id: order.id }, data: { editedBy: req.user.id } });
    res.json({ ok: true });
  }),
);

// Set packaging quantities on the PRIMARY order (manual). Blank/0 => skipped.
router.put(
  '/packaging',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.body.locationId);
    const date = parseDate(req.body.date);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    let order = await prisma.orderSuggestion.findUnique({ where: { locationId_date_seq: { locationId, date, seq: 1 } } });
    if (order?.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });
    if (!order) order = await prisma.orderSuggestion.create({ data: { locationId, date, seq: 1, status: 'GENERATED' } });

    const ids = items.map((i) => Number(i.itemId));
    const dbItems = await prisma.item.findMany({ where: { id: { in: ids } } });
    const packagingIds = new Set(dbItems.filter((i) => !i.inRecipes).map((i) => i.id));

    for (const row of items) {
      const itemId = Number(row.itemId);
      if (!packagingIds.has(itemId)) continue;
      const qty = row.qty === '' || row.qty == null ? 0 : Number(row.qty);
      const existing = await prisma.orderLine.findFirst({ where: { suggestionId: order.id, itemId } });
      if (qty > 0) {
        if (existing) await prisma.orderLine.update({ where: { id: existing.id }, data: { orderedQty: qty } });
        else await prisma.orderLine.create({ data: { suggestionId: order.id, itemId, suggestedQty: 0, orderedQty: qty } });
      } else if (existing) {
        await prisma.orderLine.delete({ where: { id: existing.id } });
      }
    }
    await prisma.orderSuggestion.update({ where: { id: order.id }, data: { editedBy: req.user.id } });
    res.json(await buildPrimaryView(locationId, date));
  }),
);

// Confirm an order was sent (by orderId). Record + learning input; posts RECEIVED.
router.post(
  '/confirm',
  ah(async (req, res) => {
    const orderId = Number(req.body.orderId);
    let order;
    if (orderId) {
      order = await prisma.orderSuggestion.findUnique({ where: { id: orderId }, include: { lines: true } });
    } else {
      // Fallback: the primary order for a location/date.
      const locationId = assertLocationAccess(req.user, req.body.locationId);
      const date = parseDate(req.body.date);
      if (!date) return res.status(400).json({ error: t('errors.validation') });
      order = await prisma.orderSuggestion.findUnique({ where: { locationId_date_seq: { locationId, date, seq: 1 } }, include: { lines: true } });
    }
    if (!order) return res.status(400).json({ error: 'Aucune commande à confirmer.' });
    assertLocationAccess(req.user, order.locationId);
    if (order.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Déjà confirmée.' });

    const ref = `order:${order.id}`;
    await prisma.$transaction(async (tx) => {
      await tx.orderSuggestion.update({ where: { id: order.id }, data: { status: 'CONFIRMED_SENT', confirmedBy: req.user.id, confirmedAt: new Date() } });
      await tx.stockMovement.deleteMany({ where: { locationId: order.locationId, ref, type: 'RECEIVED' } });
      const received = order.lines
        .filter((l) => (l.orderedQty ?? 0) > 0)
        .map((l) => ({ locationId: order.locationId, itemId: l.itemId, type: 'RECEIVED', qty: l.orderedQty, date: order.date, ref, createdBy: req.user.id }));
      if (received.length) await tx.stockMovement.createMany({ data: received });
    });
    await writeAudit({ userId: req.user.id, entity: 'order', entityId: `${order.locationId}:${ymd(order.date)}:${order.seq}`, action: 'confirm_sent', newValue: { lines: order.lines.length } });
    res.json({ ok: true });
  }),
);

// Bon de Commande — printable Excel matching the paper form, grouped by storage
// zone/subcategory. version=proposed (current/suggested) | sent (confirmed qty).
router.get(
  '/bon',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.query.locationId);
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation') });
    const version = req.query.version === 'sent' ? 'sent' : 'proposed';

    const view = await buildPrimaryView(locationId, date);
    const location = await prisma.location.findUnique({ where: { id: locationId } });

    // Items actually being ordered (qty > 0), food + packaging, with zone info.
    // Packaging has no system suggestion, so its "Suggéré" is left blank.
    const lines = [];
    for (const f of view.food) if (f.orderedQty > 0) lines.push({ name: f.name, unit: UNIT_FR[f.unit] || f.unit, suggested: f.suggestedQty, ordered: f.orderedQty, storageZone: f.storageZone, subCategory: f.subCategory });
    for (const p of view.packaging) if ((p.orderedQty ?? 0) > 0) lines.push({ name: p.name, unit: UNIT_FR[p.unit] || p.unit, suggested: '', ordered: p.orderedQty, storageZone: p.storageZone, subCategory: p.subCategory });

    const groups = groupByZoneSub(lines);
    const versionLabel = `${version === 'sent' ? t('bon.sent') : t('bon.proposed')} (${t(`orderStatus.${view.status}`)})`;

    const buffer = await buildBonCommande({
      title: 'Bon de Commande : Lcasaoui Original Food',
      establishment: ESTABLISHMENT[location?.code] || location?.name || '',
      dateStr: ymd(date),
      versionLabel,
      groups,
      remarque: 'Remarque :',
    });
    sendXlsx(res, `bon_commande_${location?.code}_${ymd(date)}_${version}.xlsx`, buffer);
  }),
);

// Excel export of the primary order.
router.get(
  '/export',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.query.locationId);
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation') });
    const view = await buildPrimaryView(locationId, date);
    const location = await prisma.location.findUnique({ where: { id: locationId } });

    // The production/order manager gets a clean picking sheet: no "Explication",
    // plus an empty column to write what was actually sent by hand. Direction
    // keeps the full sheet with the explanation. (No "Type" column — redundant.)
    const isOrderMgr = req.user.role === 'ORDER_MANAGER';

    const rows = [
      ...view.food.map((r) => ({ name: r.name, unit: r.unit, suggestedQty: r.suggestedQty, orderedQty: r.orderedQty, note: r.reason, actualSent: '' })),
      ...view.packaging
        .filter((r) => r.orderedQty != null && r.orderedQty > 0)
        .map((r) => ({ name: r.name, unit: r.unit, suggestedQty: '', orderedQty: r.orderedQty, note: `hint moy. ${r.hintAvg}`, actualSent: '' })),
    ];

    const columns = [
      { key: 'name', header: t('common.item'), width: 24 },
      { key: 'unit', header: t('common.unit') },
      { key: 'suggestedQty', header: t('orders.suggested') },
      { key: 'orderedQty', header: t('orders.ordered') },
      isOrderMgr
        ? { key: 'actualSent', header: t('orders.actualSent'), width: 18 } // blank — filled by hand
        : { key: 'note', header: t('orders.reason'), width: 40 },
    ];

    const buffer = await buildWorkbook({
      sheetName: 'Commande',
      title: t('orders.title'),
      meta: {
        [t('common.location')]: `${location?.code} — ${location?.name}`,
        [t('common.date')]: ymd(date),
        Statut: t(`orderStatus.${view.status}`),
      },
      columns,
      rows,
    });
    sendXlsx(res, `commande_${location?.code}_${ymd(date)}.xlsx`, buffer);
  }),
);

export default router;
