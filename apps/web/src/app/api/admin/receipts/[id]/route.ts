import { eq } from "drizzle-orm";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { invoices } from "@fekerte/core/db/schema";
import { getStorage } from "@fekerte/core/providers/storage";
import { getCurrentUser } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/** Payment receipt for an invoice — super admins only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.isSuperAdmin) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [inv] = await withSuperAdmin((tx) => tx.select({ receiptUrl: invoices.receiptUrl }).from(invoices).where(eq(invoices.id, id)));
  if (!inv?.receiptUrl) return new Response("Not found", { status: 404 });
  const file = await getStorage().get(inv.receiptUrl);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, no-store", "Content-Disposition": "inline" },
  });
}
