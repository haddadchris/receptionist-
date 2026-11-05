import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../src/agent/llm/anthropic";
import type { LLMRequest } from "../../src/agent/llm/types";

function fakeClient(response: Partial<Anthropic.Beta.BetaMessage>) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
          calls.push(params);
          return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 }, content: [], ...response };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const baseReq = (): LLMRequest => ({
  systemStable: "STABLE",
  systemDynamic: "DYNAMIC",
  tools: [{ name: "list_services", description: "d", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
  messages: [
    { role: "user", text: "adesh?" },
    {
      role: "assistant",
      text: "",
      toolCalls: [{ id: "tu_1", name: "list_services", input: {} }],
      provider: "anthropic",
      raw: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "tu_1", name: "list_services", input: {} }],
    },
    { role: "tool", results: [{ toolCallId: "tu_1", name: "list_services", content: "{}" }] },
  ],
  context: { businessName: "B", personaName: "Maya", language: "en", customerName: null, knownCustomer: false, state: {}, channel: "whatsapp", timezone: "Asia/Beirut", now: new Date().toISOString() },
});

describe("AnthropicProvider request shape", () => {
  it("caches the stable system prompt, sets effort + fallbacks, and replays raw blocks unchanged", async () => {
    const { client, calls } = fakeClient({ content: [{ type: "text", text: "Cleaning is $60.", citations: null }] as never });
    const p = new AnthropicProvider({ client, effort: "low" });
    const res = await p.complete(baseReq());
    const params = calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.thinking).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
    expect(params.system).toEqual([
      { type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
      { type: "text", text: "DYNAMIC" },
    ]);
    expect(params.messages[1]).toEqual({ role: "assistant", content: baseReq().messages[1]!.role === "assistant" ? (baseReq().messages[1] as { raw: unknown }).raw : null });
    expect(params.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "{}", is_error: undefined }] });
    expect(res).toMatchObject({ text: "Cleaning is $60.", stop: "end", toolCalls: [], usage: { cacheReadTokens: 7 } });
  });

  it("never runs tools from a refused turn", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", content: [{ type: "tool_use", id: "x", name: "create_booking", input: {} }] as never });
    const res = await new AnthropicProvider({ client }).complete(baseReq());
    expect(res.stop).toBe("refusal");
    expect(res.toolCalls).toEqual([]);
  });
});
