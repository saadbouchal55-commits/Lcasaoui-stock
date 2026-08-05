// AuditLog helper — every edit to items/recipes/stock corrections is recorded
// (who / when / old -> new).
import prisma from './prisma.js';

export async function writeAudit({ userId, entity, entityId, action, oldValue, newValue }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        entity,
        entityId: String(entityId),
        action,
        oldValue: oldValue == null ? null : JSON.stringify(oldValue),
        newValue: newValue == null ? null : JSON.stringify(newValue),
      },
    });
  } catch (err) {
    // Audit must never break the primary operation; log and continue.
    console.error('audit write failed:', err.message);
  }
}

export default writeAudit;
