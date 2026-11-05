import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../../src/db/client";
import { runEvals } from "../../src/evals/harness";
import { MockLLMProvider } from "../../src/agent/llm";
import { SCENARIOS } from "../../src/evals/scenarios";
import { dbAvailable } from "../fixtures";

describe.skipIf(!dbAvailable())("receptionist eval suite (mock LLM)", () => {
  afterAll(() => closeDb());

  it("has at least 30 scenarios across all languages", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    for (const l of ["ar", "arabizi", "en", "fr"]) expect(SCENARIOS.some((s) => s.language === l)).toBe(true);
  });

  it("passes every scenario end-to-end through tools and the database", async () => {
    const report = await runEvals({ provider: new MockLLMProvider() });
    const failed = report.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.failures.join("; ")}`);
    expect(failed).toEqual([]);
  }, 120_000);
});
