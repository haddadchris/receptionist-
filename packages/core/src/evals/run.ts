/**
 * `pnpm eval` — run the receptionist eval suite.
 *
 *   EVAL_PROVIDER=mock|anthropic|openai   (default: anthropic if ANTHROPIC_API_KEY else mock)
 *   EVAL_DATABASE_URL                     (default: TEST_DATABASE_URL — reset on every run!)
 *   EVAL_FILTER=az-                       (only scenarios whose id contains this)
 *   EVAL_MIN_PASS_RATE=0.9                (exit 1 below this)
 */
import "../db/env";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.EVAL_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "postgres://fekerte:fekerte@localhost:5432/fekerte_test";
process.env.DATABASE_URL = url;
process.env.LOG_LEVEL ??= "error";
process.env.WHATSAPP_PROVIDER = "mock";

async function main() {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  const { runMigrations } = await import("../db/migrate");
  const { closeDb } = await import("../db/client");
  const { runEvals } = await import("./harness");
  const { AnthropicProvider, MockLLMProvider, OpenAICompatibleProvider, llmProviderKind } = await import("../agent/llm");
  await runMigrations(url);

  const kind = (process.env.EVAL_PROVIDER as "mock" | "anthropic" | "openai" | undefined) ?? llmProviderKind();
  const provider = kind === "anthropic" ? new AnthropicProvider() : kind === "openai" ? new OpenAICompatibleProvider() : new MockLLMProvider();
  const filter = process.env.EVAL_FILTER;
  console.log(`\nFekerte receptionist evals — provider: ${provider.name}${kind === "anthropic" ? ` (${process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5"})` : ""}\n`);

  const report = await runEvals({
    provider,
    filter: filter ? (s) => s.id.includes(filter) : undefined,
    idFilter: filter,
    onResult: (r) => {
      console.log(`${r.pass ? "✓" : "✗"} ${r.id.padEnd(42)} ${String(r.ms).padStart(6)}ms`);
      if (!r.pass) for (const f of r.failures) console.log(`    · ${f}`);
    },
  });

  const by = (key: "category" | "language") => {
    const m = new Map<string, { p: number; t: number }>();
    for (const r of report.results) {
      const k = r[key];
      const v = m.get(k) ?? { p: 0, t: 0 };
      v.t++;
      if (r.pass) v.p++;
      m.set(k, v);
    }
    return [...m.entries()].map(([k, v]) => `${k} ${v.p}/${v.t}`).join(" · ");
  };
  console.log(`\nBy language: ${by("language")}`);
  console.log(`By category: ${by("category")}`);
  console.log(`\nPass rate: ${report.passed}/${report.total} = ${(report.passRate * 100).toFixed(1)}% (provider: ${provider.name})\n`);

  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.eval-report.json");
  writeFileSync(out, JSON.stringify({ provider: provider.name, at: new Date().toISOString(), ...report }, null, 2));
  console.log(`Full transcript report: ${out}`);
  await closeDb(url);
  const min = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.9);
  if (report.passRate < min) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
