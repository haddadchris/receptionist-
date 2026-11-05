"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

type Msg = { id: string; role: "user" | "assistant"; text: string; staff?: boolean };

/** Chat UI used by the embeddable widget, the live demo and the owner's test console. */
export function ChatWindow({
  slug,
  businessName,
  test,
  storageKey,
  className,
  suggestions = [],
}: {
  slug: string;
  businessName: string;
  test?: boolean;
  storageKey?: string;
  className?: string;
  suggestions?: string[];
}) {
  const { t } = useI18n();
  const key = storageKey ?? `fk-chat-${slug}${test ? "-test" : ""}`;
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      // storage unavailable (private mode / blocked) — start a fresh session
    }
    if (!saved) return;
    setToken(saved);
    fetch(`/api/public/${slug}/chat?token=${encodeURIComponent(saved)}`)
      .then((r) => r.json())
      .then((d: { messages?: Msg[] }) => d.messages && setMessages(d.messages))
      .catch(() => {});
  }, [key, slug]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  const send = async (body: string) => {
    const message = body.trim();
    if (!message || busy) return;
    setText("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/public/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message, test }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "assistant", text: data.code === "RATE_LIMITED" ? t("errors.rateLimited") : t("chat.unavailable") }]);
        return;
      }
      setToken(data.token);
      try {
        localStorage.setItem(key, data.token);
      } catch {
        // ignore
      }
      if (data.reply) setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", text: data.reply }]);
    } catch {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "assistant", text: t("common.error") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" data-testid="chat-messages">
        <div className="max-w-[85%] rounded-2xl rounded-ss-sm bg-muted px-3 py-2 text-sm">
          <span className="block text-[10px] font-medium text-muted-foreground">{businessName}</span>
          {t("chat.intro")}
        </div>
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? "rounded-se-sm bg-primary text-primary-foreground" : "rounded-ss-sm bg-muted",
              )}
              dir="auto"
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex gap-1 px-3 py-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      {messages.length === 0 && suggestions.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent" dir="auto">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("chat.placeholder")} dir="auto" maxLength={1000} data-testid="chat-input" />
        <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label={t("chat.send")}>
          <Send className="rtl:rotate-180" />
        </Button>
      </form>
    </div>
  );
}
