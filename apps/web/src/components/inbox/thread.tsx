"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Bot, ChevronDown, Mic, Send, UserRound, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/card";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { markReadAction, replyAction, setStatusAction } from "@/app/dashboard/inbox/actions";

export type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  sender: "customer" | "ai" | "staff" | "system";
  contentType: string;
  body: string | null;
  transcript: string | null;
  status: string | null;
  createdAt: string;
  toolCalls: { name: string; input: unknown; output?: unknown; error?: string; durationMs?: number }[] | null;
};

export function Thread({
  conversation,
  customer,
  messages,
  tz,
  readOnly,
}: {
  conversation: { id: string; status: "ai_active" | "human_takeover" | "closed"; channel: string; unread: number; phone: string | null };
  customer: { id: string; name: string | null; phone: string } | null;
  messages: ThreadMessage[];
  tz: string;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (conversation.unread && !readOnly) markReadAction(conversation.id).then(() => router.refresh());
  }, [conversation.id, conversation.unread, readOnly, router]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? t("common.error"));
      router.refresh();
    });

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    act(() => replyAction({ conversationId: conversation.id, body }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
          <Link href="/dashboard/inbox" aria-label={t("common.back")}>
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{customer?.name ?? conversation.phone ?? "Web visitor"}</div>
          <div className="ltr-nums text-xs text-muted-foreground">{customer?.phone ?? conversation.phone ?? conversation.channel}</div>
        </div>
        {conversation.status === "ai_active" ? (
          <Badge tone="default">
            <Bot className="size-3" /> {t("inbox.aiBadge")}
          </Badge>
        ) : conversation.status === "human_takeover" ? (
          <Badge tone="warning">
            <UserRound className="size-3" /> {t("inbox.humanBadge")}
          </Badge>
        ) : (
          <Badge tone="muted">{t("inbox.closed")}</Badge>
        )}
        {!readOnly ? (
          conversation.status === "ai_active" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setStatusAction({ conversationId: conversation.id, status: "human_takeover" }))}>
              <UserRound /> {t("inbox.takeOver")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setStatusAction({ conversationId: conversation.id, status: "ai_active" }))}>
              <Bot /> {t("inbox.handBack")}
            </Button>
          )
        ) : null}
        {customer ? (
          <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
            <Link href={`/dashboard/customers/${customer.id}`}>{t("inbox.viewCustomer")}</Link>
          </Button>
        ) : null}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3">
        {messages.map((m) => {
          if (m.contentType === "event") {
            return (
              <div key={m.id} className="mx-auto w-fit max-w-[90%] rounded-full bg-background px-3 py-1 text-center text-[11px] text-muted-foreground shadow-xs">
                {m.body} · {fmtTime(m.createdAt, tz, locale)}
              </div>
            );
          }
          const mine = m.direction === "outbound";
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs sm:max-w-[70%]",
                  !mine && "rounded-ss-sm bg-background",
                  mine && m.sender === "ai" && "rounded-se-sm bg-primary/10",
                  mine && m.sender === "staff" && "rounded-se-sm bg-emerald-100",
                  mine && m.sender === "system" && "rounded-se-sm border border-dashed bg-background",
                )}
              >
                {mine ? (
                  <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                    {m.sender === "ai" ? `🤖 ${t("inbox.aiLabel")}` : m.sender === "staff" ? t("inbox.staffLabel") : "WhatsApp template"}
                  </div>
                ) : null}
                {m.contentType === "audio" ? (
                  <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Mic className="size-3" /> {t("inbox.voiceNote")}
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap" dir="auto">
                  {m.transcript ?? m.body}
                </p>
                {m.toolCalls?.length ? (
                  <details className="mt-1.5 text-xs">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground">
                      <Wrench className="size-3" /> {t("inbox.aiActions")}: {m.toolCalls.map((c) => c.name).join(", ")}
                      <ChevronDown className="size-3" />
                    </summary>
                    <div className="mt-1 grid gap-1">
                      {m.toolCalls.map((c, i) => (
                        <pre key={i} className="max-h-40 overflow-auto rounded bg-background p-2 text-[10px] leading-snug" dir="ltr">
                          {c.name}({JSON.stringify(c.input)}){"\n"}→ {c.error ? `ERROR ${c.error}` : JSON.stringify(c.output)?.slice(0, 600)}
                        </pre>
                      ))}
                    </div>
                  </details>
                ) : null}
                <div className="mt-0.5 text-end text-[10px] text-muted-foreground" title={fmtDateTime(m.createdAt, tz, locale)}>
                  {fmtTime(m.createdAt, tz, locale)}
                  {m.status === "failed" ? <span className="ms-1 text-destructive">· {t("inbox.failed")}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {conversation.status === "human_takeover" ? <p className="bg-warning/15 px-3 py-1.5 text-xs">{t("inbox.humanNotice")}</p> : null}
      {!readOnly && conversation.channel !== "voice" ? (
        <div className="flex items-end gap-2 border-t p-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("inbox.replyPlaceholder")}
            rows={1}
            className="max-h-32 min-h-10 resize-none"
            dir="auto"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button onClick={send} disabled={pending || !text.trim()} size="icon" aria-label={t("inbox.send")}>
            <Send className="rtl:rotate-180" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
