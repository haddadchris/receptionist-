import { withTenant } from "@fekerte/core/db/tenant";
import { listInbox } from "@fekerte/core/agent/inbox";
import { requireBusiness } from "@/lib/auth/current";
import { ConversationList, type InboxItem } from "@/components/inbox/conversation-list";
import { InboxPanes } from "@/components/inbox/inbox-panes";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata = { title: "Inbox" };

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireBusiness();
  const rows = await withTenant(ctx.business.id, (tx) => listInbox(tx, ctx.business.id, { limit: 150 }));
  const items: InboxItem[] = rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    status: r.status,
    name: r.customerName,
    phone: r.customerPhone ?? (r.channel === "whatsapp" ? r.externalId : null),
    unread: r.unreadCount,
    lastAt: r.lastMessageAt?.toISOString() ?? null,
    preview: r.preview,
    previewSender: r.previewSender,
  }));
  return (
    <>
      <LiveRefresh ms={4000} />
      <InboxPanes list={<ConversationList items={items} tz={ctx.business.timezone} />}>{children}</InboxPanes>
    </>
  );
}
