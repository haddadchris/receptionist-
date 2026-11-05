export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "SLOT_UNAVAILABLE"
  | "OUTSIDE_HOURS"
  | "TOO_LATE"
  | "FORBIDDEN"
  | "CONFLICT"
  | "PLAN_LIMIT"
  | "INVALID_TOKEN";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

/** Postgres exclusion_violation (double booking). */
export function isExclusionViolation(e: unknown): boolean {
  return pgCode(e) === "23P01";
}

export function isUniqueViolation(e: unknown): boolean {
  return pgCode(e) === "23505";
}

function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
