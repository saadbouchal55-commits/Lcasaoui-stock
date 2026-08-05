import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah, parseDate, ymd } from '../lib/http.js';
import { requireAuth, requireRole, resolveLocation, FLOOR_ROLES } from '../middleware/auth.js';
import { computeSuggestions } from '../services/orderservice.js';
import { t } from '../lib/i18n.js';

const router = Router();

// "Commander Emballage" — restaurant managers enter packaging/consumable order
// quantities for their own restaurant (food ordering stays with Direction/Order
// Manager). Floor roles only; managers are pinned to their location.
router.use(requireAuth, requireRole(...FLOOR_ROLES));

// Packaging items with a non-binding history hint + any qty already entered.
router.get(
  '/',
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    const { packaging } = await computeSuggestions(locationId, date);
    const order = await prisma.orderSuggestion.findUnique({
      where: { locationId_date: { locationId, date } },
      include: { lines: true },
    });
    const lineByItem = new Map((order?.lines || []).map((l) => [l.itemId, l]));
    const confirmed = order?.status === 'CONFIRMED_SENT';

    res.json({
      locationId,
      date: ymd(date),
      locked: confirmed, // once the order is confirmed sent it can't be changed here
      rows: packaging.map((p) => ({
        ...p,
        orderedQty: lineByItem.get(p.itemId)?.orderedQty ?? null,
      })),
    });
  }),
);

// Save packaging quantities. Blank / 0 => line removed => item skipped (not sent).
router.put(
  '/',
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    let order = await prisma.orderSuggestion.findUnique({ where: { locationId_date: { locationId, date } } });
    if (order?.status === 'CONFIRMED_SENT') return res.status(409).json({ error: 'Commande déjà confirmée — non modifiable.' });
    if (!order) order = await prisma.orderSuggestion.create({ data: { locationId, date, status: 'GENERATED' } });

    // Only packaging (non-recipe) items may be set here.
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
    res.json({ ok: true });
  }),
);

export default router;
