import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { t } from '../lib/i18n.js';

const router = Router();

// Audit log is Direction-only (it spans both restaurants).
router.get(
  '/',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 200, 1000);
    const where = {};
    if (req.query.entity) where.entity = String(req.query.entity);
    const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
    res.json({ logs });
  }),
);

router.get(
  '/export',
  requireAuth,
  requireRole('DIRECTION'),
  ah(async (req, res) => {
    const where = {};
    if (req.query.entity) where.entity = String(req.query.entity);
    const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
    const buffer = await buildWorkbook({
      sheetName: 'Audit',
      title: t('nav.audit'),
      meta: { Filtre: req.query.entity || t('common.all') },
      columns: [
        { key: 'createdAt', header: 'Date', width: 22 },
        { key: 'userId', header: 'Utilisateur' },
        { key: 'entity', header: 'Entité' },
        { key: 'entityId', header: 'ID' },
        { key: 'action', header: 'Action' },
        { key: 'oldValue', header: 'Ancien', width: 40 },
        { key: 'newValue', header: 'Nouveau', width: 40 },
      ],
      rows: logs.map((l) => ({ ...l, createdAt: new Date(l.createdAt).toLocaleString('fr-FR') })),
    });
    sendXlsx(res, 'audit.xlsx', buffer);
  }),
);

export default router;
