import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, allowedLocationIds } from '../middleware/auth.js';
import { loadLocale } from '../lib/i18n.js';
import { config } from '../config.js';
import { UNITS } from '../engine/units.js';

const router = Router();

// Locations the current user may see.
router.get(
  '/locations',
  requireAuth,
  ah(async (req, res) => {
    const allowed = allowedLocationIds(req.user);
    const where = { active: true };
    if (allowed) where.id = { in: allowed };
    const locations = await prisma.location.findMany({ where, orderBy: { code: 'asc' } });
    res.json({ locations });
  }),
);

// UI strings (French now; Arabic can be added as ar.json with no code change).
router.get('/i18n', (req, res) => {
  const lang = req.query.lang === 'ar' ? 'ar' : 'fr';
  try {
    res.json({ lang, strings: loadLocale(lang) });
  } catch {
    res.json({ lang: 'fr', strings: loadLocale('fr') });
  }
});

// Enum / config metadata for the frontend.
router.get('/config', requireAuth, (req, res) => {
  res.json({
    units: UNITS,
    categories: ['INGREDIENT', 'PACKAGING', 'SOLD_AS_IS'],
    roles: ['DIRECTION', 'MANAGER'],
    order: config.order,
  });
});

export default router;
