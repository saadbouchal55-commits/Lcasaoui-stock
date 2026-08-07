import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hashPassword } from '../lib/password.js';
import { writeAudit } from '../lib/audit.js';
import { buildWorkbook, sendXlsx } from '../lib/excel.js';
import { t } from '../lib/i18n.js';

const router = Router();

// User management is DIRECTION-only.
router.use(requireAuth, requireRole('DIRECTION'));

const ROLES = ['DIRECTION', 'ORDER_MANAGER', 'MANAGER'];
// Only MANAGER is tied to a single restaurant; DIRECTION and ORDER_MANAGER see both.
const NO_LOCATION_ROLES = ['DIRECTION', 'ORDER_MANAGER'];

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    locationId: u.locationId,
    locationCode: u.location?.code ?? null,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
  };
}

/** Validate role/location coherence. DIRECTION => no location; MANAGER => a real location. */
async function validateRoleLocation(role, locationId) {
  if (!ROLES.includes(role)) return 'role';
  if (NO_LOCATION_ROLES.includes(role)) return null; // location forced to null
  if (!locationId) return 'locationId';
  const loc = await prisma.location.findUnique({ where: { id: Number(locationId) } });
  if (!loc) return 'locationId';
  return null;
}

/** Number of OTHER active Direction accounts (used to prevent lock-out). */
async function otherActiveDirections(excludeId) {
  return prisma.user.count({ where: { role: 'DIRECTION', active: true, id: { not: excludeId } } });
}

// List
router.get(
  '/',
  ah(async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: [{ active: 'desc' }, { username: 'asc' }], include: { location: true } });
    res.json({ users: users.map(publicUser) });
  }),
);

// Excel export
router.get(
  '/export',
  ah(async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { username: 'asc' }, include: { location: true } });
    const buffer = await buildWorkbook({
      sheetName: 'Utilisateurs',
      title: t('users.title'),
      columns: [
        { key: 'username', header: t('auth.username'), width: 22 },
        { key: 'role', header: 'Rôle' },
        { key: 'locationCode', header: t('common.location') },
        { key: 'active', header: t('items.active') },
      ],
      rows: users.map((u) => ({
        username: u.username,
        role: t(`roles.${u.role}`),
        locationCode: u.location?.code ?? '—',
        active: u.active ? t('common.yes') : t('common.no'),
      })),
    });
    sendXlsx(res, 'utilisateurs.xlsx', buffer);
  }),
);

// Create
router.post(
  '/',
  ah(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = req.body.role;
    const locationId = role === 'MANAGER' ? Number(req.body.locationId) || null : null;

    if (!username) return res.status(400).json({ error: t('errors.validation'), fields: ['username'] });
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe: 8 caractères minimum.', fields: ['password'] });
    const rlErr = await validateRoleLocation(role, locationId);
    if (rlErr) return res.status(400).json({ error: t('errors.validation'), fields: [rlErr] });

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) return res.status(409).json({ error: 'Nom d\'utilisateur déjà pris.', fields: ['username'] });

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        role,
        locationId,
        active: true,
        mustChangePassword: false,
      },
      include: { location: true },
    });
    await writeAudit({ userId: req.user.id, entity: 'user', entityId: user.id, action: 'create', newValue: { username, role, locationId } });
    res.status(201).json({ user: publicUser(user) });
  }),
);

// Update role / location / active
router.put(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: t('errors.notFound') });

    const role = req.body.role ?? before.role;
    const active = req.body.active ?? before.active;
    const locationId = role === 'MANAGER' ? Number(req.body.locationId ?? before.locationId) || null : null;

    const rlErr = await validateRoleLocation(role, locationId);
    if (rlErr) return res.status(400).json({ error: t('errors.validation'), fields: [rlErr] });

    // Prevent locking everyone out of Direction.
    const losingDirection = before.role === 'DIRECTION' && before.active && (role !== 'DIRECTION' || active === false);
    if (losingDirection && (await otherActiveDirections(id)) === 0) {
      return res.status(400).json({ error: 'Impossible : au moins un compte Direction actif est requis.' });
    }
    if (id === req.user.id && active === false) {
      return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role, locationId, active },
      include: { location: true },
    });
    await writeAudit({ userId: req.user.id, entity: 'user', entityId: id, action: 'edit', oldValue: publicUser(before), newValue: publicUser(user) });
    res.json({ user: publicUser(user) });
  }),
);

// Reset password (admin sets a temporary one; user must change it next login)
router.post(
  '/:id/reset-password',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const password = String(req.body.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe: 8 caractères minimum.', fields: ['password'] });
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: t('errors.notFound') });

    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
    await writeAudit({ userId: req.user.id, entity: 'user', entityId: id, action: 'reset_password' });
    res.json({ ok: true });
  }),
);

export default router;
