import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { usageEvents } from "../db/schema";
import { periodKey } from "./time";

export type UsageType = "ai_message" | "voice_minute" | "whatsapp_template" | "stt_second";

export async function recordUsage(
  tx: Tx,
  businessId: string,
  type: UsageType,
  quantity = 1,
  opts: { timezone?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await tx.insert(usageEvents).values({
    businessId,
    type,
    quantity,
    period: periodKey(opts.timezone ?? "Asia/Beirut"),
    metadata: opts.metadata ?? {},
  });
}

export async function usageForPeriod(tx: Tx, businessId: string, period: string): Promise<Record<UsageType, number>> {
  const rows = await tx
    .select({ type: usageEvents.type, total: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.businessId, businessId), eq(usageEvents.period, period)))
    .groupBy(usageEvents.type);
  const out: Record<UsageType, number> = { ai_message: 0, voice_minute: 0, whatsapp_template: 0, stt_second: 0 };
  for (const r of rows) out[r.type as UsageType] = Number(r.total);
  return out;
}
