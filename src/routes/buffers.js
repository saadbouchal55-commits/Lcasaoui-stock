import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole, resolveLocation } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { t } from '../lib/i18n.js';

const router = Router();

// Buffers are per (location, item) %. Read allowed to any authenticated user for
// their location; only Direction may edit.
router.get(
  '/',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const buffers = await prisma.buffer.findMany({ where: { locationId } });
    res.json({ locationId, buffers });
  }),
);

router.put(
  '/',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const locationId = resolveLocation(req);
    const itemId = Number(req.body.itemId);
    const pct = Number(req.body.pct);
    if (!itemId || Number.isNaN(pct)) return res.status(400).json({ error: t('errors.validation') });

    const buffer = await prisma.buffer.upsert({
      where: { locationId_itemId: { locationId, itemId } },
      update: { pct },
      create: { locationId, itemId, pct },
    });
    await writeAudit({ userId: req.user.id, entity: 'buffer', entityId: `${locationId}:${itemId}`, action: 'set', newValue: { pct } });
    res.json({ buffer });
  }),
);

export default router;
