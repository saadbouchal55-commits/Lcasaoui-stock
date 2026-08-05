import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { t } from '../lib/i18n.js';

const router = Router();

/** Load a dish with its ACTIVE recipe version + lines. */
async function loadDishRecipe(dishId) {
  const dish = await prisma.dish.findUnique({
    where: { id: dishId },
    include: { recipes: { include: { versions: { include: { lines: { include: { item: true } } } } } } },
  });
  if (!dish) return null;
  const recipe = dish.recipes[0] || null;
  let activeVersion = null;
  if (recipe) {
    activeVersion =
      recipe.versions.find((v) => v.id === recipe.activeVersion) ||
      recipe.versions[recipe.versions.length - 1] ||
      null;
  }
  return { dish, recipe, activeVersion };
}

// List all dishes with their active recipe (for the editor). Direction only.
router.get(
  '/',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const dishes = await prisma.dish.findMany({
      orderBy: { name: 'asc' },
      include: { recipes: { include: { versions: { include: { lines: { include: { item: true } } } } } } },
    });
    const result = dishes.map((dish) => {
      const recipe = dish.recipes[0] || null;
      const activeVersion = recipe
        ? recipe.versions.find((v) => v.id === recipe.activeVersion) ||
          recipe.versions[recipe.versions.length - 1] ||
          null
        : null;
      return {
        id: dish.id,
        name: dish.name,
        active: dish.active,
        recipeId: recipe?.id ?? null,
        versionCount: recipe?.versions.length ?? 0,
        activeVersion: activeVersion
          ? {
              id: activeVersion.id,
              version: activeVersion.version,
              effectiveFrom: activeVersion.effectiveFrom,
              lines: activeVersion.lines.map((l) => ({
                itemId: l.itemId,
                itemName: l.item.name,
                unit: l.item.unit,
                qty: l.qty,
                unitNote: l.unitNote,
              })),
            }
          : null,
      };
    });
    res.json({ dishes: result });
  }),
);

// Excel export of all active recipes. Direction only.
router.get(
  '/export',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const dishes = await prisma.dish.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { recipes: { include: { versions: { include: { lines: { include: { item: true } } } } } } },
    });
    const rows = [];
    for (const dish of dishes) {
      const recipe = dish.recipes[0];
      if (!recipe) continue;
      const av =
        recipe.versions.find((v) => v.id === recipe.activeVersion) ||
        recipe.versions[recipe.versions.length - 1];
      if (!av) continue;
      for (const l of av.lines) {
        rows.push({ dish: dish.name, version: av.version, item: l.item.name, qty: l.qty, unitNote: l.unitNote, unit: l.item.unit });
      }
    }
    const buffer = await buildWorkbook({
      sheetName: 'Recettes',
      title: t('recipes.title'),
      meta: { Note: t('recipes.foodOnly') },
      columns: [
        { key: 'dish', header: t('recipes.dish'), width: 26 },
        { key: 'version', header: t('recipes.version') },
        { key: 'item', header: t('common.item'), width: 22 },
        { key: 'qty', header: t('common.qty') },
        { key: 'unitNote', header: t('recipes.recipeUnit') },
        { key: 'unit', header: t('common.unit') },
      ],
      rows,
    });
    sendXlsx(res, 'recettes.xlsx', buffer);
  }),
);

// Create a dish (Direction). Optionally with an initial recipe version.
router.post(
  '/dishes',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: t('errors.validation'), fields: ['name'] });
    const dish = await prisma.dish.create({ data: { name } });
    await writeAudit({ userId: req.user.id, entity: 'dish', entityId: dish.id, action: 'create', newValue: dish });
    res.status(201).json({ dish });
  }),
);

// Create a NEW recipe version for a dish (Direction). Editing never mutates a
// past version — historical waste reports stay stable.
router.post(
  '/dishes/:dishId/versions',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const dishId = Number(req.params.dishId);
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!lines.length) return res.status(400).json({ error: t('errors.validation'), fields: ['lines'] });

    // Enforce FOOD-ONLY: every line item must be an in-recipe (food) item.
    const itemIds = lines.map((l) => Number(l.itemId));
    const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const l of lines) {
      const item = byId.get(Number(l.itemId));
      if (!item) return res.status(400).json({ error: t('errors.validation'), detail: `item ${l.itemId} inconnu` });
      if (!item.inRecipes) {
        return res
          .status(400)
          .json({ error: t('recipes.foodOnly'), detail: `${item.name} n'est pas un aliment` });
      }
      if (!(Number(l.qty) > 0)) return res.status(400).json({ error: t('errors.validation'), detail: `qty pour ${item.name}` });
    }

    const dish = await prisma.dish.findUnique({ where: { id: dishId }, include: { recipes: true } });
    if (!dish) return res.status(404).json({ error: t('errors.notFound') });

    const result = await prisma.$transaction(async (tx) => {
      let recipe = dish.recipes[0];
      if (!recipe) recipe = await tx.recipe.create({ data: { dishId } });

      const agg = await tx.recipeVersion.aggregate({ where: { recipeId: recipe.id }, _max: { version: true } });
      const nextVersion = (agg._max.version || 0) + 1;

      const version = await tx.recipeVersion.create({
        data: {
          recipeId: recipe.id,
          version: nextVersion,
          createdBy: req.user.id,
          effectiveFrom: new Date(),
          lines: {
            create: lines.map((l) => ({
              itemId: Number(l.itemId),
              qty: Number(l.qty),
              unitNote: l.unitNote || null,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.recipe.update({ where: { id: recipe.id }, data: { activeVersion: version.id } });
      return { recipe, version };
    });

    await writeAudit({
      userId: req.user.id,
      entity: 'recipe',
      entityId: dishId,
      action: 'new_version',
      newValue: { version: result.version.version, lines },
    });
    res.status(201).json(result);
  }),
);

// Full version history for a dish. Direction only.
router.get(
  '/dishes/:dishId/versions',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const data = await loadDishRecipe(Number(req.params.dishId));
    if (!data || !data.recipe) return res.json({ versions: [] });
    const versions = data.recipe.versions
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        id: v.id,
        version: v.version,
        effectiveFrom: v.effectiveFrom,
        isActive: v.id === data.recipe.activeVersion,
        lines: v.lines.map((l) => ({ itemId: l.itemId, itemName: l.item.name, qty: l.qty, unitNote: l.unitNote })),
      }));
    res.json({ versions });
  }),
);

router.post(
  '/dishes/:dishId/deactivate',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const id = Number(req.params.dishId);
    const dish = await prisma.dish.update({ where: { id }, data: { active: false } });
    await writeAudit({ userId: req.user.id, entity: 'dish', entityId: id, action: 'deactivate', newValue: dish });
    res.json({ dish });
  }),
);

export default router;
