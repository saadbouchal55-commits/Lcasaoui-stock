import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah, parseDate, ymd } from '../lib/http.js';
import { requireAuth, requireRole, resolveLocation, FLOOR_ROLES } from '../middleware/auth.js';
import { assertManagerEditableDate } from '../lib/businessday.js';
import { getEffectiveRecipeLines } from '../lib/recipes.js';
import { onHandFromMovements } from '../lib/stock.js';
import { reconcile } from '../engine/reconciliation.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { writeAudit } from '../lib/audit.js';
import { parseCsv } from '../lib/csv.js';
import { loadPosConfig } from '../lib/posmap.js';
import { t } from '../lib/i18n.js';

const router = Router();

// Floor operations (counts, sales, reconciliation, initial stock, waste report)
// are for DIRECTION + MANAGER only. ORDER_MANAGER has no access to any of it.
// (DIRECTION-only routes below add a further requireRole('DIRECTION').)
router.use(requireAuth, requireRole(...FLOOR_ROLES));

const RECON_TYPES = ['CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'COUNT_SET'];

// ── shared helpers ────────────────────────────────────────────────────────────

/** Ledger on-hand at the START of `date` (all movements strictly before it). */
async function openingStock(locationId, date) {
  const movements = await prisma.stockMovement.findMany({
    where: { locationId, date: { lt: date } },
    select: { id: true, itemId: true, type: true, qty: true, date: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const byItem = new Map();
  for (const m of movements) {
    if (!byItem.has(m.itemId)) byItem.set(m.itemId, []);
    byItem.get(m.itemId).push(m);
  }
  const opening = new Map();
  for (const [itemId, list] of byItem) opening.set(itemId, onHandFromMovements(list));
  return opening;
}

/** RECEIVED quantities dated exactly `date`, summed per item. */
async function receivedOnDay(locationId, date) {
  const movements = await prisma.stockMovement.findMany({
    where: { locationId, date, type: 'RECEIVED' },
    select: { itemId: true, qty: true },
  });
  const received = new Map();
  for (const m of movements) received.set(m.itemId, (received.get(m.itemId) || 0) + m.qty);
  return received;
}

/** Declared INGREDIENT (item) waste for a day, summed per item. */
async function declaredItemWaste(locationId, date) {
  const decls = await prisma.wasteDeclaration.findMany({
    where: { locationId, date, refType: 'ITEM', itemId: { not: null } },
    select: { itemId: true, qty: true },
  });
  const m = new Map();
  for (const d of decls) m.set(d.itemId, (m.get(d.itemId) || 0) + d.qty);
  return m;
}

/** Recompute (without persisting) the waste rows for one (location, date). */
async function reconcileDay(locationId, date) {
  const [items, recipeLinesByDish, entry, opening, received, declaredWaste] = await Promise.all([
    prisma.item.findMany(),
    getEffectiveRecipeLines(date),
    prisma.dailyEntry.findUnique({
      where: { locationId_date: { locationId, date } },
      include: { salesLines: true, countLines: true },
    }),
    openingStock(locationId, date),
    receivedOnDay(locationId, date),
    declaredItemWaste(locationId, date),
  ]);

  const sales = (entry?.salesLines || []).map((s) => ({ dishId: s.dishId, qtySold: s.qtySold }));
  const counted = new Map((entry?.countLines || []).map((c) => [c.itemId, c.countedQty]));

  const rows = reconcile({ items, recipeLinesByDish, sales, opening, received, counted, declaredWaste });
  return { entry, rows };
}

async function upsertEntry(locationId, date, userId) {
  return prisma.dailyEntry.upsert({
    where: { locationId_date: { locationId, date } },
    update: {},
    create: { locationId, date, createdBy: userId, status: 'open' },
  });
}

/** Is this the first-ever count at a location (no ledger before this day)? Uses
 *  strictly-before so re-submitting the same first night stays a baseline. */
async function isBaseline(locationId, date) {
  const prior = await prisma.stockMovement.count({ where: { locationId, date: { lt: date } } });
  return prior === 0;
}

/** Persist a reconciliation for one day: CONSUMPTION / WASTE / COUNT_SET → ledger. */
async function persistReconcile(locationId, date, userId) {
  const { entry, rows } = await reconcileDay(locationId, date);
  if (!entry) return { entry: null, rows: [] };
  const ref = `entry:${entry.id}`;
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.deleteMany({ where: { locationId, ref, type: { in: RECON_TYPES } } });
    const toCreate = [];
    // Consumption + UNEXPLAINED variance are FOOD-only (recipes are food-only).
    for (const row of rows) {
      if (row.consumption > 0) {
        toCreate.push({ locationId, itemId: row.itemId, type: 'CONSUMPTION', qty: row.consumption, date, ref, createdBy: userId });
      }
      if (row.counted !== null) {
        if (row.waste > 0) {
          toCreate.push({ locationId, itemId: row.itemId, type: 'WASTE', qty: row.waste, date, ref, createdBy: userId });
        } else if (row.waste < 0) {
          toCreate.push({ locationId, itemId: row.itemId, type: 'ADJUSTMENT', qty: -row.waste, date, ref, createdBy: userId });
        }
      }
    }
    // COUNT_SET for EVERY counted item (food AND packaging) so packaging stock is
    // known too. Written LAST so it is the authoritative on-hand baseline.
    for (const cl of entry.countLines) {
      toCreate.push({ locationId, itemId: cl.itemId, type: 'COUNT_SET', qty: cl.countedQty, date, ref, createdBy: userId });
    }
    if (toCreate.length) await tx.stockMovement.createMany({ data: toCreate });
    await tx.dailyEntry.update({ where: { id: entry.id }, data: { status: 'reconciled' } });
  });
  return { entry, rows };
}

/** Record a first-night baseline: COUNT_SET only, no waste. Becomes next day's opening. */
async function persistBaseline(locationId, date, counts, userId) {
  const entry = await upsertEntry(locationId, date, userId);
  const ref = `baseline:${entry.id}`;
  await prisma.$transaction(async (tx) => {
    // Save the counts on the entry for the record.
    await tx.countLine.deleteMany({ where: { dailyEntryId: entry.id } });
    await tx.countLine.createMany({
      data: counts.filter((c) => c.countedQty !== '' && c.countedQty != null).map((c) => ({ dailyEntryId: entry.id, itemId: Number(c.itemId), countedQty: Number(c.countedQty) })),
    });
    // Establish the ledger baseline.
    await tx.stockMovement.deleteMany({ where: { locationId, ref, type: 'COUNT_SET' } });
    await tx.stockMovement.createMany({
      data: counts
        .filter((c) => c.countedQty !== '' && c.countedQty != null)
        .map((c) => ({ locationId, itemId: Number(c.itemId), type: 'COUNT_SET', qty: Number(c.countedQty), date, ref, createdBy: userId })),
    });
    await tx.dailyEntry.update({ where: { id: entry.id }, data: { status: 'baseline' } });
  });
  await writeAudit({ userId, entity: 'stock', entityId: `${locationId}:${ymd(date)}`, action: 'baseline_count', newValue: { items: counts.length } });
  return entry;
}

// ── daily entry read ──────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    const entry = await prisma.dailyEntry.findUnique({
      where: { locationId_date: { locationId, date } },
      include: { salesLines: { include: { dish: true } }, countLines: { include: { item: true } } },
    });

    const payload = {
      locationId,
      date: ymd(date),
      status: entry?.status || 'open',
      sales: (entry?.salesLines || []).map((s) => ({ dishId: s.dishId, dishName: s.dish.name, qtySold: s.qtySold })),
    };

    // BLIND COUNTING: non-Direction roles never receive reference numbers — no
    // opening/received/previous counts are sent (enforced here, not just hidden in UI).
    if (req.user.role === 'DIRECTION') {
      const opening = await openingStock(locationId, date);
      const received = await receivedOnDay(locationId, date);
      payload.counts = (entry?.countLines || []).map((c) => ({ itemId: c.itemId, itemName: c.item.name, unit: c.item.unit, countedQty: c.countedQty }));
      payload.opening = Object.fromEntries(opening);
      payload.received = Object.fromEntries(received);
    } else {
      payload.blind = true; // signals the UI to render name + unit + empty field only
    }

    res.json(payload);
  }),
);

// ── save sales ────────────────────────────────────────────────────────────────

router.put(
  '/sales',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    assertManagerEditableDate(req.user, date);
    const sales = Array.isArray(req.body.sales) ? req.body.sales : [];

    const entry = await upsertEntry(locationId, date, req.user.id);
    await prisma.$transaction([
      prisma.salesLine.deleteMany({ where: { dailyEntryId: entry.id } }),
      prisma.salesLine.createMany({
        data: sales
          .filter((s) => Number(s.qtySold) > 0)
          .map((s) => ({ dailyEntryId: entry.id, dishId: Number(s.dishId), qtySold: Number(s.qtySold) })),
      }),
    ]);
    res.json({ ok: true });
  }),
);

// ── save closing counts ───────────────────────────────────────────────────────

router.put(
  '/counts',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    assertManagerEditableDate(req.user, date);
    const counts = Array.isArray(req.body.counts) ? req.body.counts : [];

    const entry = await upsertEntry(locationId, date, req.user.id);
    await prisma.$transaction([
      prisma.countLine.deleteMany({ where: { dailyEntryId: entry.id } }),
      prisma.countLine.createMany({
        data: counts
          .filter((c) => c.countedQty !== '' && c.countedQty != null)
          .map((c) => ({ dailyEntryId: entry.id, itemId: Number(c.itemId), countedQty: Number(c.countedQty) })),
      }),
    ]);
    res.json({ ok: true });
  }),
);

// ── record a stock movement (delivery received / correction / opening count) ────

router.post(
  '/movement',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    const type = req.body.type;
    const itemId = Number(req.body.itemId);
    const qty = Number(req.body.qty);
    if (!date || !['RECEIVED', 'ADJUSTMENT', 'COUNT_SET'].includes(type) || !itemId || Number.isNaN(qty)) {
      return res.status(400).json({ error: t('errors.validation') });
    }
    assertManagerEditableDate(req.user, date);
    const movement = await prisma.stockMovement.create({
      data: { locationId, itemId, type, qty, date, ref: req.body.ref || `manual:${type.toLowerCase()}`, createdBy: req.user.id },
    });
    if (type === 'ADJUSTMENT' || type === 'COUNT_SET') {
      await writeAudit({ userId: req.user.id, entity: 'stock', entityId: `${locationId}:${itemId}`, action: type.toLowerCase(), newValue: { qty, date: ymd(date) } });
    }
    res.status(201).json({ movement });
  }),
);

// ── reconcile: compute waste and post CONSUMPTION / WASTE / COUNT_SET to ledger ─

router.post(
  '/reconcile',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });

    assertManagerEditableDate(req.user, date);
    const { entry, rows } = await persistReconcile(locationId, date, req.user.id);
    if (!entry) return res.status(400).json({ error: 'Aucune saisie pour ce jour.' });
    await writeAudit({ userId: req.user.id, entity: 'stock', entityId: `${locationId}:${ymd(date)}`, action: 'reconcile', newValue: { rows: rows.length } });
    // Blind: only Direction receives the computed waste/expected rows.
    if (req.user.role !== 'DIRECTION') return res.json({ date: ymd(date), ok: true });
    res.json({ date: ymd(date), rows });
  }),
);

// ── night count: closing count + reconcile (initial stock is Direction-only) ────

/** Earliest ledger movement date for a location (= its Stock-initial day), or null. */
async function initializationDate(locationId) {
  const first = await prisma.stockMovement.findFirst({ where: { locationId }, orderBy: { date: 'asc' }, select: { date: true } });
  return first?.date || null;
}

router.get(
  '/night-status',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.query.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    const initDate = await initializationDate(locationId);
    const entry = await prisma.dailyEntry.findUnique({ where: { locationId_date: { locationId, date } }, include: { salesLines: true } });
    res.json({
      locationId,
      date: ymd(date),
      initialized: !!initDate,
      isInitialDay: initDate ? ymd(date) <= ymd(initDate) : false,
      hasSales: (entry?.salesLines.length || 0) > 0,
      status: entry?.status || 'open',
    });
  }),
);

router.post(
  '/night-count',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    if (!date) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    assertManagerEditableDate(req.user, date);
    const counts = Array.isArray(req.body.counts) ? req.body.counts : [];

    // The opening baseline is set ONCE by Direction via "Stock initial" — never
    // here. A closing count requires the restaurant to already be initialised, and
    // may only cover a day AFTER the initial (you can't recount the baseline day).
    const initDate = await initializationDate(locationId);
    if (!initDate) {
      return res.status(400).json({ error: 'Le stock initial n\'a pas encore été défini par la Direction.' });
    }
    if (ymd(date) <= ymd(initDate)) {
      return res.status(400).json({ error: 'Cette journée correspond au stock initial (défini par la Direction).' });
    }

    // Save the closing count and reconcile.
    const entry = await upsertEntry(locationId, date, req.user.id);
    await prisma.$transaction([
      prisma.countLine.deleteMany({ where: { dailyEntryId: entry.id } }),
      prisma.countLine.createMany({
        data: counts.filter((c) => c.countedQty !== '' && c.countedQty != null).map((c) => ({ dailyEntryId: entry.id, itemId: Number(c.itemId), countedQty: Number(c.countedQty) })),
      }),
    ]);
    const { rows } = await persistReconcile(locationId, date, req.user.id);
    await writeAudit({ userId: req.user.id, entity: 'stock', entityId: `${locationId}:${ymd(date)}`, action: 'night_count', newValue: { rows: rows.length } });
    // Blind: managers/shift-leaders get a confirmation only; Direction gets the waste rows.
    if (req.user.role !== 'DIRECTION') return res.json({ mode: 'reconciled', date: ymd(date) });
    res.json({ mode: 'reconciled', date: ymd(date), rows });
  }),
);

// ── initial stock (Direction-only, one-time per restaurant) ─────────────────────

/** A location is "initialized" once its ledger has any movement. */
async function isInitialized(locationId) {
  const n = await prisma.stockMovement.count({ where: { locationId } });
  return n > 0;
}

router.get(
  '/initial-stock-status',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    res.json({ locationId, initialized: await isInitialized(locationId) });
  }),
);

router.post(
  '/initial-stock',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date) || parseDate(ymd(new Date()));
    const provided = Array.isArray(req.body.items) ? req.body.items : [];

    // Locked: cannot re-initialize an in-use ledger. Corrections go through
    // Direction-only stock adjustments (audit-logged), never re-init.
    if (await isInitialized(locationId)) {
      return res.status(409).json({ error: 'Stock initial déjà défini pour ce restaurant. Utilisez un ajustement.' });
    }

    const qtyByItem = new Map(provided.map((i) => [Number(i.itemId), Number(i.qty) || 0]));
    const items = await prisma.item.findMany({ where: { active: true, isTracked: true } });

    const ref = 'initial-stock';
    await prisma.stockMovement.createMany({
      data: items.map((it) => ({ locationId, itemId: it.id, type: 'COUNT_SET', qty: qtyByItem.get(it.id) || 0, date, ref, createdBy: req.user.id })),
    });
    await writeAudit({ userId: req.user.id, entity: 'stock', entityId: `${locationId}:initial`, action: 'initial_stock', newValue: { items: items.length, date: ymd(date) } });
    res.status(201).json({ ok: true, items: items.length, date: ymd(date) });
  }),
);

// ── waste report (single day or aggregated range) ──────────────────────────────

async function wasteReport(locationId, from, to) {
  const days = [];
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) days.push(new Date(d));
  if (days.length === 1) {
    const { rows } = await reconcileDay(locationId, days[0]);
    return rows;
  }
  // Aggregate across days: sum numeric fields per item, union flags.
  const agg = new Map();
  for (const day of days) {
    const { rows } = await reconcileDay(locationId, day);
    for (const r of rows) {
      const cur = agg.get(r.itemId) || {
        itemId: r.itemId, name: r.name, unit: r.unit, category: r.category,
        opening: 0, received: 0, consumption: 0, expectedClosing: 0, counted: 0, declaredWaste: 0, waste: 0, flags: new Set(),
      };
      cur.received += r.received;
      cur.consumption += r.consumption;
      if (r.counted !== null) cur.counted += r.counted;
      cur.declaredWaste += r.declaredWaste || 0;
      if (r.waste !== null) cur.waste += r.waste;
      r.flags.forEach((f) => cur.flags.add(f));
      agg.set(r.itemId, cur);
    }
  }
  return [...agg.values()]
    .map((r) => ({ ...r, opening: null, expectedClosing: null, flags: [...r.flags] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// Waste/variance report is DIRECTION-only — managers/shift-leaders never see
// expected stock or variance anywhere (blind-counting integrity).
router.get(
  '/waste',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const from = parseDate(req.query.from || req.query.date);
    const to = parseDate(req.query.to || req.query.date);
    if (!from || !to) return res.status(400).json({ error: t('errors.validation'), fields: ['date'] });
    const rows = await wasteReport(locationId, from, to);

    // Product-level declared waste, kept separate (never exploded into ingredients).
    const toEnd = new Date(to); toEnd.setUTCDate(toEnd.getUTCDate() + 1);
    const prodDecls = await prisma.wasteDeclaration.findMany({
      where: { locationId, refType: 'PRODUCT', date: { gte: from, lt: toEnd } },
      include: { dish: true },
      orderBy: { date: 'desc' },
    });
    const productWaste = prodDecls.map((d) => ({ date: ymd(d.date), name: d.dish?.name || '—', qty: d.qty, reason: d.reason || '' }));

    res.json({ locationId, from: ymd(from), to: ymd(to), rows, productWaste });
  }),
);

router.get(
  '/waste/export',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const from = parseDate(req.query.from || req.query.date);
    const to = parseDate(req.query.to || req.query.date);
    if (!from || !to) return res.status(400).json({ error: t('errors.validation') });
    const rows = await wasteReport(locationId, from, to);
    const location = await prisma.location.findUnique({ where: { id: locationId } });

    const buffer = await buildWorkbook({
      sheetName: 'Gaspillage',
      title: t('waste.title'),
      meta: {
        [t('common.location')]: `${location?.code} — ${location?.name}`,
        Période: from === to ? ymd(from) : `${ymd(from)} → ${ymd(to)}`,
      },
      columns: [
        { key: 'name', header: t('common.item'), width: 24 },
        { key: 'unit', header: t('common.unit') },
        { key: 'opening', header: t('daily.opening') },
        { key: 'received', header: t('daily.received') },
        { key: 'consumption', header: t('waste.consumption') },
        { key: 'expectedClosing', header: t('waste.expected') },
        { key: 'counted', header: t('waste.counted') },
        { key: 'declaredWaste', header: t('waste.declared') },
        { key: 'waste', header: t('waste.unexplained') },
        { key: 'flags', header: t('waste.flags'), width: 30 },
      ],
      rows: rows.map((r) => ({
        ...r,
        opening: r.opening ?? '',
        expectedClosing: r.expectedClosing ?? '',
        counted: r.counted ?? '',
        declaredWaste: r.declaredWaste ?? '',
        waste: r.waste ?? '',
        flags: (r.flags || []).map((f) => t(`flags.${f}`)).join(', '),
      })),
    });
    sendXlsx(res, `gaspillage_${location?.code}_${ymd(from)}.xlsx`, buffer);
  }),
);

// ── import POS sales (CSV text) ────────────────────────────────────────────────

router.post(
  '/import-sales',
  requireAuth,
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const date = parseDate(req.body.date);
    const csvText = req.body.csv || '';
    if (!date || !csvText) return res.status(400).json({ error: t('errors.validation') });

    const pos = loadPosConfig();
    const ignore = new Set([...(pos.ignore || []), ...(pos.drinks || [])]);
    const mappings = await prisma.posMapping.findMany();
    const nameToDish = new Map(mappings.map((m) => [m.posName, m.dishId]));
    const location = await prisma.location.findUnique({ where: { id: locationId } });

    const rows = parseCsv(csvText);
    const byDish = new Map();
    const skipped = [];
    for (const r of rows) {
      // If the CSV carries a location column, keep only rows for this restaurant.
      if (r.location && location && r.location !== location.code) continue;
      const dishName = r.dish;
      const qty = Number(r.qty_sold ?? r.qty ?? 0);
      if (!dishName || !qty) continue;
      if (ignore.has(dishName)) continue;
      const dishId = nameToDish.get(dishName);
      if (!dishId) { skipped.push(dishName); continue; }
      byDish.set(dishId, (byDish.get(dishId) || 0) + qty);
    }

    const entry = await upsertEntry(locationId, date, req.user.id);
    await prisma.$transaction([
      prisma.salesLine.deleteMany({ where: { dailyEntryId: entry.id } }),
      prisma.salesLine.createMany({ data: [...byDish].map(([dishId, qtySold]) => ({ dailyEntryId: entry.id, dishId, qtySold })) }),
    ]);
    res.json({ imported: byDish.size, skipped: [...new Set(skipped)] });
  }),
);

export default router;
