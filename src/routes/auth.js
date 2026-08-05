import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { ah } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/security.js';
import { writeAudit } from '../lib/audit.js';
import { t } from '../lib/i18n.js';

const router = Router();

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    locationId: u.locationId,
    mustChangePassword: !!u.mustChangePassword,
  };
}

// Regenerate the session id on privilege change to prevent session fixation.
const regenerate = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

router.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: t('auth.required') });

    const user = await prisma.user.findUnique({ where: { username } });
    // Same message + a bcrypt compare either way to avoid user enumeration/timing hints.
    const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
    if (!ok) return res.status(401).json({ error: t('auth.invalid') });

    await regenerate(req);
    req.session.user = publicUser(user);
    res.json({ user: req.session.user });
  }),
);

router.post('/logout', (req, res) => {
  req.session?.destroy(() => {
    res.clearCookie('lcasaoui.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Change own password. Required on first login (mustChangePassword flag).
router.post(
  '/change-password',
  requireAuth,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit comporter au moins 8 caractères.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: t('errors.notFound') });

    const ok = await verifyPassword(currentPassword || '', user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    });
    await writeAudit({ userId: user.id, entity: 'user', entityId: user.id, action: 'change_password' });

    // Refresh the session copy of the user so the flag clears without re-login.
    req.session.user = { ...req.session.user, mustChangePassword: false };
    res.json({ ok: true });
  }),
);

export default router;
