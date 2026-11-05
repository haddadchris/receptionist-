/**
 * Claude implementation of LLMProvider (Anthropic TypeScript SDK).
 *
 * - Model defaults to `claude-opus-5-5` (override: ANTHROPIC_MODEL).
 * - Thinking is always on for this model; depth is controlled with
 *   `output_config.effort` (LLM_EFFORT, default "low" — receptionist chat and
 *   voice are latency-sensitive and do well at low effort).
 * - Stable business prompt is sent as the first system block with
 *   `cache_control` so repeat turns hit the prompt cache; volatile context goes
 *   in a second, uncached block.
 * - Within a tool loop the assistant's full native content (including thinking
 *   blocks) is replayed unchanged via `raw`; earlier turns are plain text only.
 * - Server-side refusal fallback is enabled (`fallbacks: "default"`).
 * - `tool_choice` stays "auto" (forced tool choice is rejected on this model).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { LLMMessage, LLMProvider, LLMRequest, LLMResponse, LLMStop, ToolCall } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toParams(messages: LLMMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      if (m.raw && m.provider === "anthropic") {
        out.push({ role: "assistant", content: m.raw as Anthropic.Beta.BetaContentBlockParam[] });
      } else {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (m.text) content.push({ type: "text", text: m.text });
        for (const c of m.toolCalls ?? []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input as Record<string, unknown> });
        if (content.length) out.push({ role: "assistant", content });
      }
    } else {
      // All tool results of one assistant turn go back in a single user message.
      out.push({
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.toolCallId, content: r.content, is_error: r.isError })),
      });
    }
  }
  return out;
}

function mapStop(s: string | null | undefined): LLMStop {
  switch (s) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;
  private effort: Effort;
  private voiceEffort: Effort;

  constructor(opts: { apiKey?: string; model?: string; effort?: Effort; voiceEffort?: Effort; client?: Anthropic } = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
    this.effort = opts.effort ?? ((process.env.LLM_EFFORT as Effort) || "low");
    this.voiceEffort = opts.voiceEffort ?? ((process.env.LLM_VOICE_EFFORT as Effort) || "low");
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: req.maxTokens ?? 4096,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: req.purpose === "voice" ? this.voiceEffort : this.effort },
      system: [
        { type: "text", text: req.systemStable, cache_control: { type: "ephemeral" } },
        { type: "text", text: req.systemDynamic },
      ],
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      messages: toParams(req.messages),
    };

    let message: Anthropic.Beta.BetaMessage;
    if (req.onText) {
      const stream = this.client.beta.messages.stream(params, { signal: req.signal });
      stream.on("text", (delta) => req.onText?.(delta));
      message = await stream.finalMessage();
    } else {
      message = await this.client.beta.messages.create(params, { signal: req.signal });
    }

    const stop = mapStop(message.stop_reason);
    // A refusal can cut a tool_use off mid-input: never run that turn's tools.
    const toolCalls: ToolCall[] =
      stop === "refusal"
        ? []
        : message.content
            .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
            .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return {
      text,
      toolCalls,
      stop,
      raw: message.content,
      model: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
