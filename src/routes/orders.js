import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah, parseDate, ymd } from '../lib/http.js';
import { requireAuth, requireRole, assertLocationAccess, ORDER_ROLES } from '../middleware/auth.js';
import { computeSuggestions, generateOrder } from '../services/orderservice.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { writeAudit } from '../lib/audit.js';
import { t } from '../lib/i18n.js';

const router = Router();

// Every order endpoint is restricted to DIRECTION and ORDER_MANAGER.
// Restaurant managers / shift-leaders have NO order access at all.
router.use(requireAuth, requireRole(...ORDER_ROLES));

/** Assemble the full order view for one (location, date): status + food + packaging. */
async function buildOrderView(locationId, date) {
  const [order, { food, packaging }] = await Promise.all([
    prisma.orderSuggestion.findUnique({ where: { locationId_date: { locationId, date } }, include: { lines: true } }),
    computeSuggestions(locationId, date),
  ]);

  const lineByItem = new Map((order?.lines || []).map((l) => [l.itemId, l]));

  const foodView = food.map((f) => {
    const line = lineByItem.get(f.itemId);
    return {
      itemId: f.itemId,
      lineId: line?.id ?? null,
      name: f.name,
      unit: f.unit,
      currentStock: f.currentStock,
      avgDaily: f.avgDaily,
      mode: f.mode,
      suggestedQty: f.suggestedQty,
      orderedQty: line?.orderedQty ?? f.suggestedQty, // default to suggested until edited
      flagged: line?.flagged ?? false,
      reason: f.reason,
    };
  });

  const packagingView = packaging.map((p) => {
    const line = lineByItem.get(p.itemId);
    return {
      itemId: p.itemId,
      lineId: line?.id ?? null,
      name: p.name,
      unit: p.unit,
      hintAvg: p.hintAvg,
      hintLast: p.hintLast,
      ordersInWindow: p.ordersInWindow,
      orderedQty: line?.orderedQty ?? null, // blank = skipped (not sent)
    };
  });

  return {
    locationId,
    date: ymd(date),
    status: order?.status ?? 'GENERATED',
    exists: !!order,
    holdReason: order?.holdReason ?? null,
    confirmedBy: order?.confirmedBy ?? null,
    confirmedAt: order?.confirmedAt ?? null,
    food: foodView,
    packaging: packagingView,
  };
}

// List orders for all restaurants for a date (both roles see L1 + L2).
router.get(
  '/',
  ah(async (req, res) => {
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    const locations = await prisma.location.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
    const orders = [];
    for (const loc of locations) {
      const view = await buildOrderView(loc.id, date);
      orders.push({ ...view, locationCode: loc.code, locationName: loc.name });
    }
    res.json({ date: ymd(date), orders });
  }),
);

// (Re)generate the food order for a location/date (applies HOLD guardrails).
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
    res.json(await buildOrderView(locationId, date));
  }),
);

// Edit a food line's quantity / flag (before confirm).
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

// Set packaging quantities (manual). Blank / 0 => line removed => item is skipped.
router.put(
  '/packaging',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.body.locationId);
    const date = parseDate(req.body.date);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    let order = await prisma.orderSuggestion.findUnique({ where: { locationId_date: { locationId, date } } });
    if (order?.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });
    if (!order) order = await prisma.orderSuggestion.create({ data: { locationId, date, status: 'GENERATED' } });

    // Guard: only allow packaging (non-recipe) items here.
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
        await prisma.orderLine.delete({ where: { id: existing.id } }); // blank => skip
      }
    }
    await prisma.orderSuggestion.update({ where: { id: order.id }, data: { editedBy: req.user.id } });
    res.json(await buildOrderView(locationId, date));
  }),
);

// Confirm the order was sent. This is the system of record + the learning input,
// and posts the received stock to the ledger.
router.post(
  '/confirm',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.body.locationId);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    const order = await prisma.orderSuggestion.findUnique({ where: { locationId_date: { locationId, date } }, include: { lines: true } });
    if (!order) return res.status(400).json({ error: 'Aucune commande à confirmer.' });
    if (order.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Déjà confirmée.' });

    const ref = `order:${order.id}`;
    await prisma.$transaction(async (tx) => {
      await tx.orderSuggestion.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED_SENT', confirmedBy: req.user.id, confirmedAt: new Date() },
      });
      // Post the received delivery to the ledger (idempotent for this order).
      await tx.stockMovement.deleteMany({ where: { locationId, ref, type: 'RECEIVED' } });
      const received = order.lines
        .filter((l) => (l.orderedQty ?? 0) > 0)
        .map((l) => ({ locationId, itemId: l.itemId, type: 'RECEIVED', qty: l.orderedQty, date, ref, createdBy: req.user.id }));
      if (received.length) await tx.stockMovement.createMany({ data: received });
    });
    await writeAudit({ userId: req.user.id, entity: 'order', entityId: `${locationId}:${ymd(date)}`, action: 'confirm_sent', newValue: { lines: order.lines.length } });
    res.json(await buildOrderView(locationId, date));
  }),
);

// Excel export of one order.
router.get(
  '/export',
  ah(async (req, res) => {
    const locationId = assertLocationAccess(req.user, req.query.locationId);
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation') });
    const view = await buildOrderView(locationId, date);
    const location = await prisma.location.findUnique({ where: { id: locationId } });

    const rows = [
      ...view.food.map((r) => ({ type: t('orders.food'), name: r.name, unit: r.unit, suggestedQty: r.suggestedQty, orderedQty: r.orderedQty, note: r.reason })),
      ...view.packaging
        .filter((r) => r.orderedQty != null && r.orderedQty > 0)
        .map((r) => ({ type: t('orders.packaging'), name: r.name, unit: r.unit, suggestedQty: '', orderedQty: r.orderedQty, note: `hint moy. ${r.hintAvg}` })),
    ];

    const buffer = await buildWorkbook({
      sheetName: 'Commande',
      title: t('orders.title'),
      meta: {
        [t('common.location')]: `${location?.code} — ${location?.name}`,
        [t('common.date')]: ymd(date),
        Statut: t(`orderStatus.${view.status}`),
      },
      columns: [
        { key: 'type', header: 'Type' },
        { key: 'name', header: t('common.item'), width: 24 },
        { key: 'unit', header: t('common.unit') },
        { key: 'suggestedQty', header: t('orders.suggested') },
        { key: 'orderedQty', header: t('orders.ordered') },
        { key: 'note', header: t('orders.reason'), width: 40 },
      ],
      rows,
    });
    sendXlsx(res, `commande_${location?.code}_${ymd(date)}.xlsx`, buffer);
  }),
);

export default router;
