"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useT } from "@/i18n/client";

export function CopyButton({ value, label, ...props }: { value: string; label?: string } & ButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      {...props}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </Button>
  );
}
