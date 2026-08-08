import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole, FLOOR_ROLES } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { UNITS } from '../engine/units.js';
import { t } from '../lib/i18n.js';

const router = Router();

const CATEGORIES = ['INGREDIENT', 'PACKAGING', 'SOLD_AS_IS'];

function validateItem(body) {
  const errors = [];
  if (!body.name || !String(body.name).trim()) errors.push('name');
  if (!UNITS.includes(body.unit)) errors.push('unit');
  if (body.category && !CATEGORIES.includes(body.category)) errors.push('category');
  if (body.unit === 'PACKAGE' && !(Number(body.packSize) > 0)) errors.push('packSize');
  return errors;
}

// List (floor roles read the catalogue; Order Manager has no need for it).
router.get(
  '/',
  requireAuth,
  requireRole(...FLOOR_ROLES),
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? {} : { active: true };
    if (req.query.q) where.name = { contains: String(req.query.q) };
    const items = await prisma.item.findMany({ where, orderBy: { name: 'asc' } });
    // countedDaily = derived from the extensible countFrequency ("DAILY" vs the rest).
    res.json({ items: items.map((i) => ({ ...i, countedDaily: i.countFrequency === 'DAILY' })) });
  }),
);

// Excel export of the catalogue (scoped by the same filters).
router.get(
  '/export',
  requireAuth,
  requireRole(...FLOOR_ROLES),
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? {} : { active: true };
    if (req.query.q) where.name = { contains: String(req.query.q) };
    const items = await prisma.item.findMany({ where, orderBy: { name: 'asc' } });

    const buffer = await buildWorkbook({
      sheetName: 'Articles',
      title: t('items.title'),
      meta: {
        Filtre: req.query.q ? `nom contient "${req.query.q}"` : t('common.all'),
        Inactifs: includeInactive ? t('common.yes') : t('common.no'),
      },
      columns: [
        { key: 'name', header: t('items.name'), width: 28 },
        { key: 'unit', header: t('common.unit') },
        { key: 'packSize', header: t('items.packSize') },
        { key: 'yieldPct', header: t('items.yield') },
        { key: 'category', header: 'Catégorie' },
        { key: 'inRecipes', header: t('items.inRecipes') },
        { key: 'isTracked', header: t('items.tracked') },
        { key: 'active', header: t('items.active') },
      ],
      rows: items.map((i) => ({
        ...i,
        inRecipes: i.inRecipes ? 'oui' : 'non',
        isTracked: i.isTracked ? 'oui' : 'non',
        active: i.active ? 'oui' : 'non',
      })),
    });
    sendXlsx(res, 'articles.xlsx', buffer);
  }),
);

// Create (Direction only).
router.post(
  '/',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const errors = validateItem(req.body);
    if (errors.length) return res.status(400).json({ error: t('errors.validation'), fields: errors });

    const item = await prisma.item.create({
      data: {
        name: String(req.body.name).trim(),
        unit: req.body.unit,
        packSize: req.body.packSize ? Number(req.body.packSize) : null,
        yieldPct: req.body.yieldPct ? Number(req.body.yieldPct) : null,
        isTracked: req.body.isTracked ?? true,
        inRecipes: req.body.inRecipes ?? true,
        category: req.body.category || 'INGREDIENT',
        active: true,
      },
    });
    await writeAudit({ userId: req.user.id, entity: 'item', entityId: item.id, action: 'create', newValue: item });
    res.status(201).json({ item });
  }),
);

// Update (Direction only). Never mixes units silently — changing unit is allowed
// but recorded in the audit log with old->new.
router.put(
  '/:id',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.item.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: t('errors.notFound') });

    const merged = { ...before, ...req.body };
    const errors = validateItem(merged);
    if (errors.length) return res.status(400).json({ error: t('errors.validation'), fields: errors });

    const item = await prisma.item.update({
      where: { id },
      data: {
        name: String(merged.name).trim(),
        unit: merged.unit,
        packSize: merged.packSize ? Number(merged.packSize) : null,
        yieldPct: merged.yieldPct ? Number(merged.yieldPct) : null,
        isTracked: merged.isTracked,
        inRecipes: merged.inRecipes,
        category: merged.category,
      },
    });
    await writeAudit({ userId: req.user.id, entity: 'item', entityId: id, action: 'edit', oldValue: before, newValue: item });
    res.json({ item });
  }),
);

// Soft-delete (deactivate). Never hard-delete — history must stay valid.
router.post(
  '/:id/deactivate',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.item.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: t('errors.notFound') });
    const item = await prisma.item.update({ where: { id }, data: { active: false } });
    await writeAudit({ userId: req.user.id, entity: 'item', entityId: id, action: 'deactivate', oldValue: before, newValue: item });
    res.json({ item });
  }),
);

router.post(
  '/:id/reactivate',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const item = await prisma.item.update({ where: { id }, data: { active: true } });
    await writeAudit({ userId: req.user.id, entity: 'item', entityId: id, action: 'reactivate', newValue: item });
    res.json({ item });
  }),
);

export default router;
