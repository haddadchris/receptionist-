import { AnthropicProvider } from "./anthropic";
import { MockLLMProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openai";
import type { LLMProvider } from "./types";

const g = globalThis as unknown as { __fkLLM?: LLMProvider; __fkLLMOverride?: LLMProvider | null };

/**
 * LLM_PROVIDER = anthropic | openai | mock. Defaults to anthropic when
 * ANTHROPIC_API_KEY is set, otherwise the mock (so local dev needs no keys).
 */
export function llmProviderKind(): "anthropic" | "openai" | "mock" {
  const explicit = process.env.LLM_PROVIDER;
  if (explicit === "anthropic" || explicit === "openai" || explicit === "mock") return explicit;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock";
}

export function getLLMProvider(): LLMProvider {
  if (g.__fkLLMOverride) return g.__fkLLMOverride;
  if (!g.__fkLLM) {
    const kind = llmProviderKind();
    g.__fkLLM = kind === "anthropic" ? new AnthropicProvider() : kind === "openai" ? new OpenAICompatibleProvider() : new MockLLMProvider();
  }
  return g.__fkLLM;
}

/** Test hook. */
export function setLLMProvider(p: LLMProvider | null) {
  g.__fkLLMOverride = p;
}

export { MockLLMProvider, AnthropicProvider, OpenAICompatibleProvider };
export type { LLMProvider };
