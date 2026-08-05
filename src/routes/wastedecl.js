import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah, parseDate, ymd } from '../lib/http.js';
import { requireAuth, requireRole, resolveLocation, FLOOR_ROLES } from '../middleware/auth.js';
import { t } from '../lib/i18n.js';

const router = Router();

// Waste declaration is a floor activity (Manager / Shift-Leader / Direction).
router.use(requireAuth, requireRole(...FLOOR_ROLES));

// Create a declaration: raw ingredient (ITEM) or finished product (PRODUCT).
router.post(
  '/',
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    const refType = req.body.refType;
    const qty = Number(req.body.qty);
    const reason = req.body.reason ? String(req.body.reason) : null;
    if (!date || !['ITEM', 'PRODUCT'].includes(refType) || !(qty > 0)) {
      return res.status(400).json({ error: t('errors.validation') });
    }
    const itemId = refType === 'ITEM' ? Number(req.body.itemId) : null;
    const dishId = refType === 'PRODUCT' ? Number(req.body.dishId) : null;
    if (refType === 'ITEM' && !itemId) return res.status(400).json({ error: t('errors.validation'), fields: ['itemId'] });
    if (refType === 'PRODUCT' && !dishId) return res.status(400).json({ error: t('errors.validation'), fields: ['dishId'] });

    const decl = await prisma.wasteDeclaration.create({
      data: { locationId, date, refType, itemId, dishId, qty, reason, createdBy: req.user.id },
    });

    // Raw-ingredient waste is also posted to the ledger as a WASTE movement.
    if (refType === 'ITEM') {
      await prisma.stockMovement.create({
        data: { locationId, itemId, type: 'WASTE', qty, date, ref: `wastedecl:${decl.id}`, createdBy: req.user.id },
      });
    }
    res.status(201).json({ declaration: decl });
  }),
);

// List declarations. Manager: own location, read-only. Direction: any / all.
router.get(
  '/',
  ah(async (req, res) => {
    let locationId = null;
    if (req.user.role === 'MANAGER') locationId = req.user.locationId;
    else if (req.query.locationId) locationId = Number(req.query.locationId);

    const where = {};
    if (locationId) where.locationId = locationId;
    if (req.query.from && req.query.to) {
      const to = parseDate(req.query.to); to.setUTCDate(to.getUTCDate() + 1);
      where.date = { gte: parseDate(req.query.from), lt: to };
    }

    const decls = await prisma.wasteDeclaration.findMany({
      where,
      include: { item: true, dish: true, location: true },
      orderBy: { date: 'desc' },
      take: 500,
    });
    const users = await prisma.user.findMany({ select: { id: true, username: true } });
    const nameById = new Map(users.map((u) => [u.id, u.username]));

    res.json({
      declarations: decls.map((d) => ({
        id: d.id,
        date: ymd(d.date),
        locationId: d.locationId,
        locationCode: d.location?.code,
        refType: d.refType,
        name: d.refType === 'ITEM' ? d.item?.name : d.dish?.name,
        unit: d.refType === 'ITEM' ? d.item?.unit : null,
        qty: d.qty,
        reason: d.reason || '',
        by: nameById.get(d.createdBy) || '—',
      })),
    });
  }),
);

export default router;
