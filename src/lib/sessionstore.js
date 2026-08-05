// Prisma-backed express-session store. Keeps sessions in the DB so they survive
// process restarts (Hostinger recycles the Node process) and stay portable to
// PostgreSQL later — no MySQL-specific session store.
import session from 'express-session';
import prisma from './prisma.js';

const Store = session.Store;
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12h fallback

function expiryFrom(sess) {
  const ms = sess?.cookie?.maxAge;
  if (sess?.cookie?.expires) return new Date(sess.cookie.expires);
  return new Date(Date.now() + (ms || DEFAULT_TTL_MS));
}

export class PrismaSessionStore extends Store {
  constructor() {
    super();
    // Periodic sweep of expired sessions (unref so it never blocks shutdown).
    this.sweeper = setInterval(() => {
      prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    }, 1000 * 60 * 60);
    this.sweeper.unref?.();
  }

  get(sid, cb) {
    prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expiresAt < new Date()) {
          return prisma.session.delete({ where: { sid } }).then(() => cb(null, null)).catch(() => cb(null, null));
        }
        let data;
        try { data = JSON.parse(row.data); } catch { return cb(null, null); }
        cb(null, data);
      })
      .catch((err) => cb(err));
  }

  set(sid, sess, cb) {
    const data = JSON.stringify(sess);
    const expiresAt = expiryFrom(sess);
    prisma.session
      .upsert({ where: { sid }, update: { data, expiresAt }, create: { sid, data, expiresAt } })
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  destroy(sid, cb) {
    prisma.session
      .delete({ where: { sid } })
      .then(() => cb(null))
      .catch(() => cb(null)); // deleting a missing session is not an error
  }

  touch(sid, sess, cb) {
    prisma.session
      .update({ where: { sid }, data: { expiresAt: expiryFrom(sess) } })
      .then(() => cb(null))
      .catch(() => cb(null));
  }
}

export default PrismaSessionStore;
