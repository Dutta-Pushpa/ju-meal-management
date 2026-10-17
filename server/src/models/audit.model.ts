import type { Queryable } from '../db/pool.js';

/**
 * The audit trail.
 *
 * Every state change worth remembering writes a row here: account creation,
 * sign-in, and administrative edits to locations. The `metadata` column is a
 * JSON blob and is readable by anyone with audit access, so a credential, a
 * password hash, or a token must never be put in it.
 */

export interface AuditEntry {
  /** Null for an action taken by the system itself rather than a signed-in user. */
  actorUserId: number | undefined;
  action: string;
  entityType: string;
  entityId: number | undefined;
  metadata: Record<string, unknown>;
}

export async function writeAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actorUserId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.metadata),
    ],
  );
}
