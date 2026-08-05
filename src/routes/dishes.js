import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole, FLOOR_ROLES } from '../middleware/auth.js';

const router = Router();

// Active dishes for the daily sales-entry screen (floor roles only).
router.get(
  '/',
  requireAuth,
  requireRole(...FLOOR_ROLES),
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? {} : { active: true };
    const dishes = await prisma.dish.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { posNames: true },
    });
    res.json({ dishes });
  }),
);

export default router;
