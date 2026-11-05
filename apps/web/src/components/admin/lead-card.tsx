"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { useT } from "@/i18n/client";
import type { TKey } from "@/i18n";
import { updateLeadAction } from "@/app/admin/leads/actions";

const STAGES = ["new", "demo_scheduled", "demo_done", "trial", "paying", "lost"] as const;
type Stage = (typeof STAGES)[number];

export type LeadView = {
  id: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  vertical: string | null;
  city: string | null;
  message: string | null;
  notes: string | null;
  stage: Stage;
  createdAt: string;
};

export function LeadCard({ lead, created }: { lead: LeadView; created: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const run = (input: { stage?: Stage; note?: string }) =>
    start(async () => {
      const res = await updateLeadAction({ id: lead.id, ...input });
      if (!res.ok) return void toast.error(res.error);
      setNote("");
      router.refresh();
    });
  return (
    <article className="grid gap-2 rounded-xl border bg-card p-3 text-sm shadow-xs" data-testid="lead-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{lead.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[lead.businessName, lead.vertical, lead.city].filter(Boolean).join(" · ")}</p>
        </div>
        {lead.phone ? (
          <Button asChild size="icon-sm" variant="outline" aria-label={t("leads.contact")}>
            <a href={`https://wa.me/${lead.phone.replace("+", "")}`} target="_blank" rel="noreferrer">
              <MessageCircle />
            </a>
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" dir="ltr">
        {lead.phone}
        {lead.email ? ` · ${lead.email}` : ""} · {created}
      </p>
      {lead.message ? <p className="line-clamp-3 whitespace-pre-line text-xs">{lead.message}</p> : null}
      <Select aria-label={t("leads.moveTo")} value={lead.stage} disabled={busy} onChange={(e) => run({ stage: e.target.value as Stage })} className="h-8 text-xs">
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {t(`leads.stages.${s}` as TKey)}
          </option>
        ))}
      </Select>
      <button type="button" className="justify-self-start text-xs text-primary underline" onClick={() => setOpen((v) => !v)}>
        {t("leads.addNote")}
        {lead.notes ? ` (${lead.notes.split("\n").length})` : ""}
      </button>
      {open ? (
        <div className="grid gap-2">
          {lead.notes ? <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">{lead.notes}</pre> : null}
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} aria-label={t("leads.addNote")} />
          <Button size="sm" disabled={busy || !note.trim()} onClick={() => run({ note })}>
            {t("leads.save")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
