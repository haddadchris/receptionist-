"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { simulateInboundAction } from "@/app/dashboard/inbox/actions";

const EXAMPLES = ["badde 7jez checkup bukra ba3d el dohr", "adesh el tanzif?", "bade ghayer maw3ade", "بدي موعد تنظيف السبت الصبح", "Je voudrais un rendez-vous demain"];

export function WhatsAppSimulator({ defaultPhone, defaultName }: { defaultPhone?: string | null; defaultName?: string | null } = {}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(defaultPhone ?? "+961 70 555 123");
  const [name, setName] = useState(defaultName ?? "Joelle Haddad");
  const [text, setText] = useState("");

  const send = (body: string) =>
    start(async () => {
      const res = await simulateInboundAction({ from, text: body, name });
      if (!res.ok) return void toast.error(res.error);
      setText("");
      if (res.data.conversationId) router.push(`/dashboard/inbox/${res.data.conversationId}`);
      router.refresh();
    });

  return (
    <div className="grid gap-3 rounded-xl border border-dashed bg-card p-4">
      <div className="flex items-center gap-2 font-medium">
        <FlaskConical className="size-4 text-primary" /> {t("inbox.simulator")}
      </div>
      <p className="text-xs text-muted-foreground">{t("inbox.simulatorHint")}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("inbox.simulatorPhone")} htmlFor="sim-phone">
          <Input id="sim-phone" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("inbox.simulatorName")} htmlFor="sim-name">
          <Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send(text.trim());
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="badde 7jez…" dir="auto" data-testid="sim-input" />
        <Button type="submit" disabled={pending || !text.trim()} aria-label={t("inbox.simulatorSend")}>
          <Send className="rtl:rotate-180" />
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" disabled={pending} onClick={() => send(ex)} className="rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent" dir="auto">
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
