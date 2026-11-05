import { MessagesSquare } from "lucide-react";
import { getWhatsAppProvider } from "@fekerte/core/providers/index";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { WhatsAppSimulator } from "@/components/inbox/simulator";

export default async function InboxIndex() {
  const ctx = await requireBusiness();
  const { t } = await getT();
  const simulator = getWhatsAppProvider().name === "mock" && !ctx.readOnly;
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-4">
      <div className="grid w-full max-w-md gap-6">
        <div className="hidden text-center text-muted-foreground md:block">
          <MessagesSquare className="mx-auto size-10" />
          <p className="mt-2 text-sm">{t("inbox.noSelection")}</p>
        </div>
        {simulator ? <WhatsAppSimulator /> : null}
      </div>
    </div>
  );
}
