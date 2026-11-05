/**
 * Provider-neutral LLM interface used by the receptionist agent. Implementations:
 * - AnthropicProvider (default when ANTHROPIC_API_KEY is set)
 * - OpenAICompatibleProvider (any /chat/completions endpoint with tool calling)
 * - MockLLMProvider (rule-based, deterministic; used locally and in evals without keys)
 */
import type { AgentState, ConversationLanguage } from "../../db/schema";

export type JSONSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDef = { name: string; description: string; inputSchema: JSONSchema };

export type ToolCall = { id: string; name: string; input: unknown };

export type ToolResult = { toolCallId: string; name: string; content: string; isError?: boolean };

export type LLMMessage =
  | { role: "user"; text: string }
  /** `raw` = provider-native content (e.g. Anthropic blocks incl. thinking) replayed unchanged within a tool loop. */
  | { role: "assistant"; text: string; toolCalls?: ToolCall[]; raw?: unknown; provider?: string }
  | { role: "tool"; results: ToolResult[] };

export type LLMRequest = {
  /** Stable per business (cached): persona, services, hours, policies, rules. */
  systemStable: string;
  /** Volatile per turn: current time, customer profile, agent memory. */
  systemDynamic: string;
  messages: LLMMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  /** Stream text deltas (voice cascade). */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
  purpose?: "chat" | "voice";
  /** Structured context; real providers get it via systemDynamic, the mock reads it directly. */
  context: MockContext;
};

/** Structured view of the turn context (used by the mock provider). */
export type MockContext = {
  businessName: string;
  personaName: string;
  language: ConversationLanguage;
  customerName: string | null;
  knownCustomer: boolean;
  state: AgentState;
  channel: "whatsapp" | "voice" | "web_chat";
  timezone: string;
  now: string;
};

export type LLMStop = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export type LLMResponse = {
  text: string;
  toolCalls: ToolCall[];
  stop: LLMStop;
  raw?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  model?: string;
};

export interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}
