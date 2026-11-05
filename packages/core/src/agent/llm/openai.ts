/**
 * OpenAI-compatible /chat/completions provider (OpenAI, Azure OpenAI, Groq,
 * OpenRouter, local vLLM/Ollama…). Optional alternative to Claude; selected
 * with LLM_PROVIDER=openai. Uses fetch to avoid another SDK dependency.
 */
import type { LLMMessage, LLMProvider, LLMRequest, LLMResponse, LLMStop } from "./types";

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

function toChat(req: LLMRequest): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: `${req.systemStable}\n\n${req.systemDynamic}` }];
  for (const m of req.messages as LLMMessage[]) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        tool_calls: m.toolCalls?.length
          ? m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } }))
          : undefined,
      });
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.toolCallId, content: r.content });
    }
  }
  return out;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai";
  private baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  private apiKey = process.env.OPENAI_API_KEY ?? "";
  private model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      signal: req.signal,
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: toChat(req),
        tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        tool_choice: "auto",
      }),
    });
    if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      model?: string;
      choices: { finish_reason: string; message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = data.choices[0]!;
    const toolCalls = (choice.message.tool_calls ?? []).map((c) => {
      let input: unknown = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = { __invalid_json: c.function.arguments };
      }
      return { id: c.id, name: c.function.name, input };
    });
    const stop: LLMStop = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : choice.finish_reason === "content_filter" ? "refusal" : "end";
    const text = choice.message.content?.trim() ?? "";
    if (text) req.onText?.(text);
    return {
      text,
      toolCalls,
      stop: toolCalls.length ? "tool_use" : stop,
      model: data.model,
      usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined,
    };
  }
}
