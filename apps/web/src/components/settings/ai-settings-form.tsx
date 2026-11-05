"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { saveAiSettingsAction } from "@/app/dashboard/ai/actions";

export function AiSettingsForm({
  initial,
  readOnly,
}: {
  initial: {
    personaName: string;
    tone: "warm" | "professional" | "casual";
    extraInstructions: string;
    whatsappAutoReply: boolean;
    whatsappNumber: string;
    whatsappPhoneNumberId: string;
    voicePipeline: "cascade" | "realtime";
    voiceMode: "always" | "after_hours" | "overflow";
    overflowRingSeconds: number;
    transferNumber: string;
    voiceNumber: string;
  };
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <fieldset disabled={readOnly} className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("ai.persona")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("ai.personaName")}>
              <Input value={v.personaName} onChange={(e) => set("personaName", e.target.value)} />
            </Field>
            <Field label={t("ai.tone")}>
              <Select value={v.tone} onChange={(e) => set("tone", e.target.value as typeof v.tone)}>
                <option value="warm">{t("ai.toneWarm")}</option>
                <option value="professional">{t("ai.toneProfessional")}</option>
                <option value="casual">{t("ai.toneCasual")}</option>
              </Select>
            </Field>
          </div>
          <Field label={t("ai.extraInstructions")} hint={t("ai.extraHint")}>
            <Textarea rows={4} value={v.extraInstructions} onChange={(e) => set("extraInstructions", e.target.value)} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("ai.whatsapp")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.whatsappAutoReply} onCheckedChange={(x) => set("whatsappAutoReply", x)} /> {t("ai.autoReply")}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("ai.whatsappNumber")}>
              <Input value={v.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} dir="ltr" inputMode="tel" />
            </Field>
            <Field label={t("ai.phoneNumberId")} hint={t("ai.phoneNumberIdHint")}>
              <Input value={v.whatsappPhoneNumberId} onChange={(e) => set("whatsappPhoneNumberId", e.target.value)} dir="ltr" />
            </Field>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("voice.settings")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("voice.voiceNumber")} hint={t("voice.voiceNumberHint")}>
              <Input value={v.voiceNumber} onChange={(e) => set("voiceNumber", e.target.value)} dir="ltr" inputMode="tel" />
            </Field>
            <Field label={t("voice.transferNumber")}>
              <Input value={v.transferNumber} onChange={(e) => set("transferNumber", e.target.value)} dir="ltr" inputMode="tel" />
            </Field>
            <Field label={t("voice.voiceMode")}>
              <Select value={v.voiceMode} onChange={(e) => set("voiceMode", e.target.value as typeof v.voiceMode)}>
                <option value="always">{t("voice.modeAlways")}</option>
                <option value="after_hours">{t("voice.modeAfterHours")}</option>
                <option value="overflow">{t("voice.modeOverflow")}</option>
              </Select>
            </Field>
            <Field label={t("voice.ringSeconds")}>
              <Input type="number" min={5} max={60} value={v.overflowRingSeconds} onChange={(e) => set("overflowRingSeconds", Number(e.target.value))} />
            </Field>
            <Field label={t("voice.pipeline")}>
              <Select value={v.voicePipeline} onChange={(e) => set("voicePipeline", e.target.value as typeof v.voicePipeline)}>
                <option value="cascade">{t("voice.pipelineCascade")}</option>
                <option value="realtime">{t("voice.pipelineRealtime")}</option>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>
      {!readOnly ? (
        <Button
          className="justify-self-start"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveAiSettingsAction({
                ...v,
                whatsappNumber: v.whatsappNumber || null,
                whatsappPhoneNumberId: v.whatsappPhoneNumberId || null,
                transferNumber: v.transferNumber || null,
                voiceNumber: v.voiceNumber || null,
              });
              if (res.ok) {
                toast.success(t("common.saved"));
                router.refresh();
              } else toast.error(res.error);
            })
          }
        >
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      ) : null}
    </fieldset>
  );
}

export function WidgetSnippet({ snippet }: { snippet: string }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ai.widget")}</CardTitle>
        <CardDescription>{t("ai.widgetHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs" dir="ltr">
          {snippet}
        </pre>
      </CardContent>
    </Card>
  );
}
