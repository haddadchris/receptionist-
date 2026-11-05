"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Checkbox, Field, Input, Switch, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/client";
import { fmtPrice } from "@/lib/format";
import { saveServiceAction } from "@/app/dashboard/actions";
import type { LocalizedText } from "@fekerte/core/db/schema";

export type ServiceRow = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  category: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number | null;
  priceFrom: boolean;
  depositRequired: boolean;
  depositCents: number;
  recallIntervalDays: number | null;
  bookableOnline: boolean;
  active: boolean;
  staffIds: string[];
};

const empty = (staffIds: string[]): ServiceRow => ({
  id: "",
  name: {},
  description: {},
  category: null,
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceCents: null,
  priceFrom: false,
  depositRequired: false,
  depositCents: 0,
  recallIntervalDays: null,
  bookableOnline: true,
  active: true,
  staffIds,
});

export function ServicesManager({ services, staff, readOnly }: { services: ServiceRow[]; staff: { id: string; name: string }[]; readOnly?: boolean }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const name = (n: LocalizedText) => n[locale] || n.en || n.ar || n.fr || "—";
  return (
    <div className="grid gap-3">
      {!readOnly ? (
        <Button className="justify-self-start" onClick={() => setEditing(empty(staff.map((s) => s.id)))}>
          <Plus /> {t("services.add")}
        </Button>
      ) : null}
      {services.length === 0 ? <EmptyState title={t("services.empty")} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => !readOnly && setEditing(s)}
            className="rounded-xl border bg-card p-4 text-start transition-colors hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{name(s.name)}</div>
              <div className="text-sm font-semibold">
                {s.priceCents !== null ? fmtPrice(s.priceCents, { from: s.priceFrom }) : <span className="text-xs text-muted-foreground">{t("services.priceOnRequest")}</span>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {s.durationMinutes} {t("common.min")}
              </span>
              {!s.active ? <Badge tone="muted">{t("common.inactive")}</Badge> : null}
              {!s.bookableOnline ? <Badge tone="muted">{t("services.bookableOnline")} ✕</Badge> : null}
              {s.depositRequired ? <Badge tone="warning">{t("services.deposit")}</Badge> : null}
            </div>
            <div className="mt-2 truncate text-xs text-muted-foreground">
              {staff
                .filter((st) => s.staffIds.includes(st.id))
                .map((st) => st.name)
                .join(", ")}
            </div>
          </button>
        ))}
      </div>
      {editing ? <ServiceDialog service={editing} staff={staff} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ServiceDialog({ service, staff, onClose }: { service: ServiceRow; staff: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState(service);
  const [price, setPrice] = useState(service.priceCents === null ? "" : String(service.priceCents / 100));
  const set = <K extends keyof ServiceRow>(k: K, v: ServiceRow[K]) => setS((x) => ({ ...x, [k]: v }));

  const save = () =>
    start(async () => {
      const res = await saveServiceAction({
        id: s.id || null,
        data: {
          name: s.name,
          description: s.description,
          category: s.category,
          durationMinutes: s.durationMinutes,
          bufferBeforeMinutes: s.bufferBeforeMinutes,
          bufferAfterMinutes: s.bufferAfterMinutes,
          priceCents: price === "" ? null : Math.round(Number(price) * 100),
          priceFrom: s.priceFrom,
          depositRequired: s.depositRequired,
          depositCents: s.depositCents,
          recallIntervalDays: s.recallIntervalDays,
          bookableOnline: s.bookableOnline,
          active: s.active,
          staffIds: s.staffIds,
        },
      });
      if (res.ok) {
        toast.success(t("common.saved"));
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{s.id ? t("services.editTitle") : t("services.add")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label={t("services.nameAr")}>
            <Input dir="rtl" value={s.name.ar ?? ""} onChange={(e) => set("name", { ...s.name, ar: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("services.nameEn")}>
              <Input dir="ltr" value={s.name.en ?? ""} onChange={(e) => set("name", { ...s.name, en: e.target.value })} />
            </Field>
            <Field label={t("services.nameFr")}>
              <Input dir="ltr" value={s.name.fr ?? ""} onChange={(e) => set("name", { ...s.name, fr: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t("services.duration")}>
              <Input type="number" min={5} step={5} value={s.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))} />
            </Field>
            <Field label={t("services.bufferBefore")}>
              <Input type="number" min={0} step={5} value={s.bufferBeforeMinutes} onChange={(e) => set("bufferBeforeMinutes", Number(e.target.value))} />
            </Field>
            <Field label={t("services.bufferAfter")}>
              <Input type="number" min={0} step={5} value={s.bufferAfterMinutes} onChange={(e) => set("bufferAfterMinutes", Number(e.target.value))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 items-end gap-2">
            <Field label={t("services.price")} hint={price === "" ? t("services.priceOnRequest") : undefined}>
              <Input type="number" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} dir="ltr" />
            </Field>
            <label className="flex h-10 items-center gap-2 text-sm">
              <Checkbox checked={s.priceFrom} onChange={(e) => set("priceFrom", e.target.checked)} /> {t("services.priceFrom")}
            </label>
          </div>
          <Field label={t("services.staffWho")}>
            <div className="flex flex-wrap gap-2">
              {staff.map((st) => (
                <label key={st.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                  <Checkbox
                    checked={s.staffIds.includes(st.id)}
                    onChange={(e) => set("staffIds", e.target.checked ? [...s.staffIds, st.id] : s.staffIds.filter((x) => x !== st.id))}
                  />
                  {st.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t("services.recall")} hint={t("services.recallHint")}>
            <Input
              type="number"
              min={1}
              value={s.recallIntervalDays ?? ""}
              onChange={(e) => set("recallIntervalDays", e.target.value ? Number(e.target.value) : null)}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={s.depositRequired} onCheckedChange={(v) => set("depositRequired", v)} /> {t("services.deposit")}
            </label>
            {s.depositRequired ? (
              <Field label={t("services.depositAmount")}>
                <Input type="number" min={0} value={s.depositCents / 100} onChange={(e) => set("depositCents", Math.round(Number(e.target.value) * 100))} />
              </Field>
            ) : null}
          </div>
          <Field label="Description (EN)">
            <Textarea rows={2} value={s.description.en ?? ""} onChange={(e) => set("description", { ...s.description, en: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={s.bookableOnline} onCheckedChange={(v) => set("bookableOnline", v)} /> {t("services.bookableOnline")}
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={s.active} onCheckedChange={(v) => set("active", v)} /> {t("common.active")}
            </label>
          </div>
          <Button size="lg" onClick={save} disabled={pending || !(s.name.ar || s.name.en || s.name.fr)}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
