"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import type { ServiceOption, StaffOption } from "@/lib/dto";
import { fmtPrice, fmtTime, localClockOf, localToIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createAppointmentAction, getSlotsAction } from "@/app/dashboard/actions";

export type NewAppointmentDefaults = { date: string; time?: string; staffId?: string | null; serviceId?: string };

export function NewAppointmentDialog({
  open,
  onOpenChange,
  services,
  staff,
  tz,
  defaults,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  services: ServiceOption[];
  staff: StaffOption[];
  tz: string;
  defaults: NewAppointmentDefaults;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serviceId, setServiceId] = useState(defaults.serviceId ?? services[0]?.id ?? "");
  const [staffId, setStaffId] = useState<string>(defaults.staffId ?? "");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time ?? "");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const [notify, setNotify] = useState(true);
  const [slots, setSlots] = useState<{ start: string; staffIds: string[] }[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(defaults.date);
    setTime(defaults.time ?? "");
    setStaffId(defaults.staffId ?? "");
    if (defaults.serviceId) setServiceId(defaults.serviceId);
  }, [open, defaults]);

  const service = services.find((s) => s.id === serviceId);
  const staffForService = useMemo(() => staff.filter((s) => !service || service.staffIds.includes(s.id)), [staff, service]);

  useEffect(() => {
    if (!open || !serviceId || !date) return;
    let cancelled = false;
    setSlots(null);
    getSlotsAction({ serviceId, staffId: staffId || null, date }).then((res) => {
      if (!cancelled) setSlots(res.ok ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, serviceId, staffId, date]);

  const slotTimes = (slots ?? []).map((s) => localClockOf(s.start, tz));
  const timeIsSlot = slotTimes.includes(time);

  const submit = () =>
    start(async () => {
      const res = await createAppointmentAction({
        serviceId,
        staffId: staffId || null,
        startsAt: localToIso(date, time, tz),
        phone,
        name,
        internalNotes: notes || undefined,
        override: override || !timeIsSlot,
        notifyCustomer: notify,
      });
      if (res.ok) {
        toast.success(t("appointment.created"));
        onOpenChange(false);
        setPhone("");
        setName("");
        setNotes("");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("calendar.newAppointment")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("appointment.phone")}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="03 123 456" dir="ltr" autoFocus />
            </Field>
            <Field label={t("appointment.customerName")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label={t("appointment.service")}>
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.durationMinutes} {t("common.min")}
                  {s.priceCents !== null ? ` · ${fmtPrice(s.priceCents)}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("appointment.staff")}>
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">{t("appointment.anyStaff")}</option>
                {staffForService.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("appointment.date")}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label={t("appointment.time")}>
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
              {slots === null ? (
                <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
              ) : slots.length === 0 ? (
                <span className="text-xs text-muted-foreground">{t("booking.noSlots")}</span>
              ) : (
                slots.map((s) => {
                  const clock = localClockOf(s.start, tz);
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => setTime(clock)}
                      className={cn(
                        "ltr-nums rounded-md border px-2 py-1 text-xs",
                        time === clock ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                      )}
                    >
                      {fmtTime(s.start, tz, locale)}
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              {time && !timeIsSlot ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} /> {t("appointment.override")}
                </label>
              ) : null}
            </div>
          </Field>
          <Field label={t("appointment.internalNotes")}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t("appointment.notifyCustomer")}
          </label>
          <Button size="lg" disabled={pending || !phone || !time || !serviceId || (!timeIsSlot && !override)} onClick={submit}>
            {pending ? t("common.saving") : t("appointment.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
