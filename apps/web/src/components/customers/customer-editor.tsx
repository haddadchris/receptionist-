"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import { updateCustomerAction } from "@/app/dashboard/actions";
import type { Locale } from "@/i18n";

export function CustomerEditor({
  customer,
  readOnly,
}: {
  customer: {
    id: string;
    name: string | null;
    notes: string | null;
    tags: string[];
    preferredLanguage: Locale | null;
    consentWhatsapp: boolean;
    consentMarketing: boolean;
  };
  readOnly?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(customer.name ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [tags, setTags] = useState(customer.tags);
  const [tagInput, setTagInput] = useState("");
  const [lang, setLang] = useState<Locale | "">(customer.preferredLanguage ?? "");
  const [wa, setWa] = useState(customer.consentWhatsapp);
  const [mkt, setMkt] = useState(customer.consentMarketing);

  const save = () =>
    start(async () => {
      const res = await updateCustomerAction({
        id: customer.id,
        name,
        notes,
        tags,
        preferredLanguage: lang || null,
        consentWhatsapp: wa,
        consentMarketing: mkt,
      });
      if (res.ok) {
        toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(res.error);
    });

  const addTag = () => {
    const v = tagInput.trim().toLowerCase();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput("");
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("appointment.customerName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
        </Field>
        <Field label={t("customers.language")}>
          <Select value={lang} onChange={(e) => setLang(e.target.value as Locale | "")} disabled={readOnly}>
            <option value="">—</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </Select>
        </Field>
      </div>
      <Field label={t("customers.tags")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} tone="secondary">
              {tag}
              {!readOnly ? (
                <button type="button" onClick={() => setTags(tags.filter((x) => x !== tag))} aria-label={t("common.remove")}>
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
          {!readOnly ? (
            <Input
              className="h-8 w-32"
              value={tagInput}
              placeholder={t("customers.addTag")}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          ) : null}
        </div>
      </Field>
      <Field label={t("customers.notes")} hint={t("customers.notesHint")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} disabled={readOnly} />
      </Field>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={wa} onCheckedChange={setWa} disabled={readOnly} /> {t("customers.whatsappConsent")}
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={mkt} onCheckedChange={setMkt} disabled={readOnly} /> {t("customers.marketingConsent")}
        </label>
      </div>
      {!readOnly ? (
        <Button onClick={save} disabled={pending} className="justify-self-start">
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      ) : null}
    </div>
  );
}
