import { notFound } from "next/navigation";
import { withTenant } from "@fekerte/core/db/tenant";
import { getThread } from "@fekerte/core/agent/inbox";
import { isDomainError } from "@fekerte/core/lib/errors";
import { getWhatsAppProvider } from "@fekerte/core/providers/index";
import { requireBusiness } from "@/lib/auth/current";
import { Thread } from "@/components/inbox/thread";
import { WhatsAppSimulator } from "@/components/inbox/simulator";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireBusiness();
  const data = await withTenant(ctx.business.id, async (tx) => {
    try {
      return await getThread(tx, ctx.business.id, id);
    } catch (e) {
      if (isDomainError(e) && e.code === "NOT_FOUND") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const simulator = getWhatsAppProvider().name === "mock" && !ctx.readOnly && data.conversation.channel === "whatsapp";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <Thread
          tz={ctx.business.timezone}
          readOnly={ctx.readOnly}
          conversation={{ id: data.conversation.id, status: data.conversation.status, channel: data.conversation.channel, unread: data.conversation.unreadCount, phone: data.conversation.externalId }}
          customer={data.customer ? { id: data.customer.id, name: data.customer.name, phone: data.customer.phone } : null}
          messages={data.messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            sender: m.sender,
            contentType: m.contentType,
            body: m.body,
            transcript: m.transcript,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
            toolCalls: m.toolCalls,
          }))}
        />
      </div>
      {simulator ? (
        <details className="border-t bg-card p-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">🧪 Simulator</summary>
          <div className="pt-2">
            <WhatsAppSimulator defaultPhone={data.conversation.externalId} defaultName={data.customer?.name} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
