"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useT } from "@/i18n/client";
import { cancelCampaignAction, createCampaignAction, previewAudienceAction, sendCampaignAction } from "@/app/dashboard/growth-actions";

type Preset = "all" | "lapsed" | "vip" | "no_shows" | "tag";
type Segment = { tags?: string[]; noVisitDays?: number; minNoShows?: number };

const PRESET_LABEL: Record<Exclude<Preset, "tag">, "segments.marketing" | "segments.lapsed" | "segments.vip" | "segments.noShows"> = {
  all: "segments.marketing",
  lapsed: "segments.lapsed",
  vip: "segments.vip",
  no_shows: "segments.noShows",
};

function toSegment(preset: Preset, tag: string): Segment {
  if (preset === "lapsed") return { noVisitDays: 180 };
  if (preset === "vip") return { tags: ["VIP"] };
  if (preset === "no_shows") return { minNoShows: 1 };
  if (preset === "tag" && tag) return { tags: [tag] };
  return {};
}

export function CampaignForm({ tags, initialPreset, initialTag }: { tags: string[]; initialPreset: Preset; initialTag: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [tag, setTag] = useState(initialTag || tags[0] || "");
  const [message, setMessage] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [audience, setAudience] = useState<{ matched: number; eligible: number } | null>(null);
  const segment = useMemo(() => toSegment(preset, tag), [preset, tag]);

  useEffect(() => {
    let live = true;
    void previewAudienceAction(segment).then((r) => live && r.ok && setAudience(r.data));
    return () => {
      live = false;
    };
  }, [segment]);

  const submit = (send: boolean) =>
    start(async () => {
      const res = await createCampaignAction({ name, segment, message, send, sendAt: send && sendAt ? new Date(sendAt).toISOString() : null });
      if (!res.ok) return void toast.error(res.error);
      toast.success(send ? t("campaigns.scheduled") : t("campaigns.created"));
      setName("");
      setMessage("");
      router.refresh();
    });

  const valid = name.trim().length >= 2 && message.trim().length >= 5;
  return (
    <div className="grid gap-3">
      <Field label={t("campaigns.name")} htmlFor="camp-name">
        <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label={t("campaigns.segment")} htmlFor="camp-segment">
        <Select id="camp-segment" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          {(Object.keys(PRESET_LABEL) as (keyof typeof PRESET_LABEL)[]).map((p) => (
            <option key={p} value={p}>
              {t(PRESET_LABEL[p])}
            </option>
          ))}
          {tags.length ? <option value="tag">{t("campaigns.tags")}…</option> : null}
        </Select>
      </Field>
      {preset === "tag" ? (
        <Field label={t("campaigns.tags")} htmlFor="camp-tag">
          <Select id="camp-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            {tags.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {audience ? (
        <p className="rounded-lg bg-muted p-2 text-sm" data-testid="campaign-audience">
          {t("campaigns.audience", { eligible: audience.eligible, matched: audience.matched })}
        </p>
      ) : null}
      <Field label={t("campaigns.message")} hint={t("campaigns.messageHint")} htmlFor="camp-message">
        <Textarea id="camp-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={600} />
      </Field>
      <Field label={t("campaigns.scheduleAt")} htmlFor="camp-at">
        <Input id="camp-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !valid} onClick={() => submit(false)}>
          {t("campaigns.create")}
        </Button>
        <Button disabled={busy || !valid || !audience?.eligible} onClick={() => submit(true)}>
          <Send /> {sendAt ? t("campaigns.schedule") : t("campaigns.sendNow")}
        </Button>
      </div>
    </div>
  );
}

export function CampaignRowActions({ id, status }: { id: string; status: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Error");
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      {status === "draft" ? (
        <Button size="sm" disabled={busy} onClick={() => act(() => sendCampaignAction(id))}>
          {t("campaigns.sendNow")}
        </Button>
      ) : null}
      {status === "draft" || status === "scheduled" ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => cancelCampaignAction(id))}>
          {t("campaigns.cancel")}
        </Button>
      ) : null}
    </div>
  );
}
