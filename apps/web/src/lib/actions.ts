import "server-only";
import { isDomainError } from "@fekerte/core/lib/errors";
import { logger } from "@fekerte/core/lib/logger";
import { withTenant, type Tx } from "@fekerte/core/db/tenant";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { requireWritableBusiness, type BusinessContext } from "./auth/current";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code?: string; field?: string };

/** Translate a thrown error into a user-facing message in the current locale. */
export async function errorResult(e: unknown): Promise<{ ok: false; error: string; code?: string; field?: string }> {
  const { t } = await getT();
  if (isDomainError(e)) {
    const field = typeof e.details?.field === "string" ? e.details.field : undefined;
    let error = e.message;
    if (e.code === "SLOT_UNAVAILABLE" && typeof e.details?.reason === "string") {
      error = t(`appointment.reasons.${e.details.reason}` as TKey);
    } else if (e.code === "TOO_LATE") error = t("manage.tooLate");
    else if (e.code === "NOT_FOUND") error = t("errors.notFound");
    else if (e.code === "FORBIDDEN") error = t("errors.forbidden");
    else if (e.code === "VALIDATION" && field === "phone") error = t("errors.invalidPhone");
    return { ok: false, error, code: e.code, field };
  }
  logger.error("action failed", { err: e });
  return { ok: false, error: t("common.error") };
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return errorResult(e);
  }
}

/** Server action body executed in the current business's tenant transaction. */
export async function tenantAction<T>(
  fn: (tx: Tx, ctx: BusinessContext) => Promise<T>,
  opts: { ownerOnly?: boolean } = {},
): Promise<ActionResult<T>> {
  return runAction(async () => {
    const ctx = await requireWritableBusiness(opts);
    return withTenant(ctx.business.id, (tx) => fn(tx, ctx));
  });
}
