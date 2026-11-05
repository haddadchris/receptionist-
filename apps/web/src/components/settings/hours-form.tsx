"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { fmtLocalDate } from "@/lib/format";
import { addHolidayAction, deleteHolidayAction, saveBusinessHoursAction } from "@/app/dashboard/actions";
import { BreaksEditor, WeeklyHoursEditor, type Rule } from "./weekly-hours-editor";

export function HoursForm({
  hours,
  breaks,
  holidays,
  readOnly,
}: {
  hours: Rule[];
  breaks: Rule[];
  holidays: { id: string; startDate: string; endDate: string; name: string | null; staffName: string | null }[];
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [h, setH] = useState(hours);
  const [b, setB] = useState(breaks);
  const [hol, setHol] = useState({ startDate: "", endDate: "", name: "" });

  const done = (res: { ok: boolean; error?: string }) => {
    if (res.ok) {
      toast.success(t("common.saved"));
      router.refresh();
    } else toast.error(res.error);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("hours.businessHours")}</CardTitle>
          <CardDescription>{t("hours.businessHoursHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <WeeklyHoursEditor value={h} onChange={setH} disabled={readOnly} />
          <div>
            <p className="mb-1 text-sm font-medium">{t("hours.breaks")}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t("hours.breaksHint")}</p>
            <BreaksEditor value={b} onChange={setB} disabled={readOnly} />
          </div>
          {!readOnly ? (
            <Button disabled={pending} className="justify-self-start" onClick={() => start(async () => done(await saveBusinessHoursAction({ hours: h, breaks: b })))}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t("hours.holidays")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {holidays.length === 0 ? <p className="text-sm text-muted-foreground">{t("hours.noHolidays")}</p> : null}
          <ul className="divide-y rounded-lg border empty:hidden">
            {holidays.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                <div>
                  <div className="font-medium">{x.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtLocalDate(x.startDate, locale, { day: "numeric", month: "short", year: "numeric" })}
                    {x.endDate !== x.startDate ? ` → ${fmtLocalDate(x.endDate, locale, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                    {x.staffName ? ` · ${x.staffName}` : ""}
                  </div>
                </div>
                {!readOnly ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => start(async () => done(await deleteHolidayAction(x.id)))} aria-label={t("common.delete")}>
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {!readOnly ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("common.from")}>
                  <Input type="date" value={hol.startDate} onChange={(e) => setHol({ ...hol, startDate: e.target.value })} />
                </Field>
                <Field label={t("common.to")}>
                  <Input type="date" value={hol.endDate} onChange={(e) => setHol({ ...hol, endDate: e.target.value })} />
                </Field>
              </div>
              <Field label={t("hours.holidayName")}>
                <Input value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} placeholder="Eid al-Fitr, Christmas…" />
              </Field>
              <Button
                variant="outline"
                disabled={pending || !hol.startDate}
                onClick={() =>
                  start(async () => {
                    const res = await addHolidayAction(hol);
                    done(res);
                    if (res.ok) setHol({ startDate: "", endDate: "", name: "" });
                  })
                }
              >
                {t("hours.addHoliday")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
