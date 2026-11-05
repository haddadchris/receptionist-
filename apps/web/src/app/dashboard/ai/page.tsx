import { aiBlockedReason } from "@fekerte/core/billing/features";
import { config } from "@fekerte/core/config";
import { llmProviderKind } from "@fekerte/core/agent/llm/index";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AiSettingsForm, WidgetSnippet } from "@/components/settings/ai-settings-form";
import { ChatWindow } from "@/components/chat/chat-window";

export const metadata = { title: "AI receptionist" };

export default async function AiPage() {
  const ctx = await requireBusiness();
  const { t } = await getT();
  const b = ctx.business;
  const blocked = aiBlockedReason(b, "whatsappAi");
  const snippet = `<script src="${config.appUrl}/widget.js" data-business="${b.slug}" data-color="${b.branding.primaryColor ?? "#0e7490"}" async></script>`;
  const provider = llmProviderKind();
  return (
    <div>
      <PageHeader
        title={t("ai.title")}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={blocked ? "warning" : "success"}>{blocked ? t("ai.blocked", { reason: blocked }) : t("ai.statusOk")}</Badge>
            <Badge tone="outline">LLM: {provider}</Badge>
          </div>
        }
      />
      {blocked === "plan" ? <p className="mb-4 rounded-lg bg-warning/15 p-3 text-sm">{t("ai.planLocked")}</p> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <div className="grid h-fit gap-5">
          <AiSettingsForm
            readOnly={ctx.readOnly || ctx.role === "staff"}
            initial={{
              personaName: b.aiSettings?.personaName ?? "Maya",
              tone: b.aiSettings?.tone ?? "warm",
              extraInstructions: b.aiSettings?.extraInstructions ?? "",
              whatsappAutoReply: b.aiSettings?.whatsappAutoReply !== false,
              whatsappNumber: b.whatsappNumber ?? "",
              whatsappPhoneNumberId: b.whatsappPhoneNumberId ?? "",
            }}
          />
          <WidgetSnippet snippet={snippet} />
        </div>
        <Card className="flex h-[620px] flex-col overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle>{t("ai.test")}</CardTitle>
            <CardDescription>{t("ai.testHint")}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0 sm:p-0">
            <ChatWindow
              slug={b.slug}
              businessName={b.name}
              test
              suggestions={["badde 7jez checkup bukra ba3d el dohr", "adesh el tanzif?", "شو أوقات الدوام؟", "Je voudrais un rendez-vous demain"]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
