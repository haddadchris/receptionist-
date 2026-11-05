import { z } from "zod";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { handleWebChatMessage, webChatHistory } from "@fekerte/core/channels/webchat";
import { apiError, json, limited } from "@/lib/api";
import { getBusinessContext } from "@/lib/auth/current";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ token: z.string().max(200).nullish(), message: z.string().min(1).max(1000), test: z.boolean().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const tooMany = limited(req, "chat", 20) ?? limited(req, "chat-burst", 4, 5_000);
  if (tooMany) return tooMany;
  try {
    const { slug } = await ctx.params;
    const business = await getBusinessBySlug(slug);
    if (!business) return json({ error: "Not found" }, { status: 404 });
    const p = body.parse(await req.json());
    // "test" (no usage, works during trial pause) only for the business's own signed-in staff.
    let test = false;
    if (p.test) {
      const bc = await getBusinessContext();
      test = !!bc && bc.business.id === business.id;
    }
    const turn = await handleWebChatMessage({ business, token: p.token, text: p.message, test });
    return json(turn);
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const tooMany = limited(req, "chat-history", 30);
  if (tooMany) return tooMany;
  try {
    const { slug } = await ctx.params;
    const business = await getBusinessBySlug(slug);
    if (!business) return json({ error: "Not found" }, { status: 404 });
    const token = new URL(req.url).searchParams.get("token");
    return json({ messages: token ? await webChatHistory(business, token) : [] });
  } catch (e) {
    return apiError(e);
  }
}
