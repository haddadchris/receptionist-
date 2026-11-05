import type { Tx } from "../db/tenant";
import { auditLog } from "../db/schema";

export type Actor =
  | { type: "user"; userId: string; label?: string }
  | { type: "ai"; label?: string }
  | { type: "customer"; label?: string }
  | { type: "system"; label?: string };

export async function audit(
  tx: Tx,
  entry: {
    businessId: string | null;
    actor: Actor;
    action: string;
    entityType: string;
    entityId?: string | null;
    changes?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    businessId: entry.businessId,
    actorType: entry.actor.type,
    actorUserId: entry.actor.type === "user" ? entry.actor.userId : null,
    actorLabel: entry.actor.label ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes ?? null,
  });
}
