"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Checkbox, Field, Input, Switch } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/client";
import { initials } from "@/lib/utils";
import { fmtDateTime, localToIso } from "@/lib/format";
import { addTimeOffAction, deleteTimeOffAction, saveStaffAction } from "@/app/dashboard/actions";
import { WeeklyHoursEditor, type Rule } from "./weekly-hours-editor";
import type { LocalizedText } from "@fekerte/core/db/schema";

export type StaffRow = {
  id: string;
  name: string;
  title: LocalizedText;
  color: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  bookableOnline: boolean;
  serviceIds: string[];
  hours: Rule[];
  timeOff: { id: string; startsAt: string; endsAt: string; reason: string | null }[];
};

const COLORS = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"];

export function StaffManager({
  staff,
  services,
  businessHours,
  tz,
  readOnly,
}: {
  staff: StaffRow[];
  services: { id: string; name: string }[];
  businessHours: Rule[];
  tz: string;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<StaffRow | null>(null);
  return (
    <div className="grid gap-3">
      {!readOnly ? (
        <Button
          className="justify-self-start"
          onClick={() =>
            setEditing({
              id: "",
              name: "",
              title: {},
              color: COLORS[staff.length % COLORS.length]!,
              phone: null,
              email: null,
              active: true,
              bookableOnline: true,
              serviceIds: services.map((s) => s.id),
              hours: [],
              timeOff: [],
            })
          }
        >
          <Plus /> {t("staff.add")}
        </Button>
      ) : null}
      {staff.length === 0 ? <EmptyState title={t("staff.empty")} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {staff.map((s) => (
          <button key={s.id} type="button" onClick={() => !readOnly && setEditing(s)} className="flex items-center gap-3 rounded-xl border bg-card p-4 text-start hover:border-primary/40">
            <span className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: s.color }}>
              {initials(s.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.name}</div>
              <div className="truncate text-xs text-muted-foreground">{s.title[locale] || s.title.en || ""}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {!s.active ? <Badge tone="muted">{t("common.inactive")}</Badge> : null}
                <Badge tone="secondary">{s.hours.length ? t("staff.customHours") : t("staff.useBusinessHours")}</Badge>
                {s.timeOff.length ? <Badge tone="warning">{t("staff.timeOff")}: {s.timeOff.length}</Badge> : null}
              </div>
            </div>
          </button>
        ))}
      </div>
      {editing ? (
        <StaffDialog
          member={editing}
          services={services}
          businessHours={businessHours}
          tz={tz}
          onClose={() => setEditing(null)}
          fmt={(iso) => fmtDateTime(iso, tz, locale)}
        />
      ) : null}
    </div>
  );
}

function StaffDialog({
  member,
  services,
  businessHours,
  tz,
  onClose,
  fmt,
}: {
  member: StaffRow;
  services: { id: string; name: string }[];
  businessHours: Rule[];
  tz: string;
  onClose: () => void;
  fmt: (iso: string) => string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [m, setM] = useState(member);
  const [custom, setCustom] = useState(member.hours.length > 0);
  const [hours, setHours] = useState<Rule[]>(member.hours.length ? member.hours : businessHours);
  const [off, setOff] = useState({ from: "", to: "", reason: "" });
  const set = <K extends keyof StaffRow>(k: K, v: StaffRow[K]) => setM((x) => ({ ...x, [k]: v }));

  const save = () =>
    start(async () => {
      const res = await saveStaffAction({
        id: m.id || null,
        data: {
          name: m.name,
          title: m.title,
          color: m.color,
          phone: m.phone,
          email: m.email,
          active: m.active,
          bookableOnline: m.bookableOnline,
          serviceIds: m.serviceIds,
          hours: custom ? hours : null,
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m.id ? t("staff.editTitle") : t("staff.add")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("staff.name")}>
              <Input value={m.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label={t("staff.role")}>
              <Input value={m.title[locale] ?? ""} onChange={(e) => set("title", { ...m.title, [locale]: e.target.value })} />
            </Field>
            <Field label={t("settings.phone")}>
              <Input value={m.phone ?? ""} onChange={(e) => set("phone", e.target.value)} dir="ltr" inputMode="tel" />
            </Field>
            <Field label={t("settings.email")}>
              <Input value={m.email ?? ""} onChange={(e) => set("email", e.target.value)} dir="ltr" type="email" />
            </Field>
          </div>
          <Field label={t("staff.color")}>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("color", c)}
                  className="size-7 rounded-full ring-offset-2"
                  style={{ background: c, boxShadow: m.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>
          <Field label={t("staff.services")}>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                  <Checkbox
                    checked={m.serviceIds.includes(s.id)}
                    onChange={(e) => set("serviceIds", e.target.checked ? [...m.serviceIds, s.id] : m.serviceIds.filter((x) => x !== s.id))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </Field>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Switch checked={custom} onCheckedChange={setCustom} />
              {custom ? t("staff.customHours") : t("staff.useBusinessHours")}
            </div>
            {custom ? <WeeklyHoursEditor value={hours} onChange={setHours} /> : null}
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={m.bookableOnline} onCheckedChange={(v) => set("bookableOnline", v)} /> {t("staff.bookableOnline")}
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={m.active} onCheckedChange={(v) => set("active", v)} /> {t("common.active")}
            </label>
          </div>
          <Button size="lg" onClick={save} disabled={pending || !m.name.trim()}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>

          {m.id ? (
            <div className="mt-2 grid gap-2 border-t pt-4">
              <p className="text-sm font-medium">{t("staff.timeOff")}</p>
              {m.timeOff.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span>
                    {fmt(o.startsAt)} → {fmt(o.endsAt)} {o.reason ? `· ${o.reason}` : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      start(async () => {
                        const res = await deleteTimeOffAction(o.id);
                        if (res.ok) {
                          set("timeOff", m.timeOff.filter((x) => x.id !== o.id));
                          router.refresh();
                        }
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input type="datetime-local" value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} />
                <Input type="datetime-local" value={off.to} onChange={(e) => setOff({ ...off, to: e.target.value })} />
                <Input placeholder={t("staff.reason")} value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} />
                <Button
                  variant="outline"
                  disabled={pending || !off.from || !off.to}
                  onClick={() =>
                    start(async () => {
                      const [fd, ft] = off.from.split("T");
                      const [td, tt] = off.to.split("T");
                      const res = await addTimeOffAction({ staffId: m.id, startsAt: localToIso(fd!, ft!, tz), endsAt: localToIso(td!, tt!, tz), reason: off.reason });
                      if (res.ok) {
                        toast.success(t("common.saved"));
                        setOff({ from: "", to: "", reason: "" });
                        onClose();
                        router.refresh();
                      } else toast.error(res.error);
                    })
                  }
                >
                  {t("staff.addTimeOff")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
