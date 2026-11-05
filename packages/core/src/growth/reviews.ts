/**
 * Review requests: after a completed visit the customer gets a WhatsApp rating
 * request (1–5). 4–5 → thank + Google review link. 1–3 → apologise and ask
 * what went wrong; the next message is stored as private feedback for the
 * owner (never posted publicly). Ratings are parsed without the LLM.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { withTenant, type Tx } from "../db/tenant";
import { appointments, customers, reviewRequests, type Appointment, type Business, type ConversationLanguage, type Job } from "../db/schema";
import { hasFeature } from "../billing/features";
import { enqueueJob } from "../jobs/queue";
import { audit } from "../lib/audit";
import { sendCustomerTemplate } from "../notifications/customer";
import { intoSendingWindow } from "./schedule";

export const REVIEW_REQUEST_JOB = "review.request";
const DELAY_MINUTES = () => Number(process.env.REVIEW_REQUEST_DELAY_MINUTES ?? 120);

export async function scheduleReviewRequest(tx: Tx, business: Business, appt: Pick<Appointment, "id" | "businessId" | "endsAt">, now = new Date()) {
  if (!hasFeature(business, "reviews")) return false;
  // Visits marked completed long after the fact (back-office catch-up) don't get a review request.
  if (appt.endsAt.getTime() < now.getTime() - 3 * 86_400_000) return false;
  const base = new Date(Math.max(now.getTime(), appt.endsAt.getTime()) + DELAY_MINUTES() * 60_000);
  await enqueueJob(tx, {
    type: REVIEW_REQUEST_JOB,
    businessId: appt.businessId,
    runAt: intoSendingWindow(base, business.timezone),
    payload: { appointmentId: appt.id },
    dedupeKey: `review:${appt.id}`,
  });
  return true;
}

export async function handleReviewRequestJob(job: Job): Promise<void | { skipped: string }> {
  const businessId = job.businessId;
  const { appointmentId } = job.payload as { appointmentId: string };
  if (!businessId) return { skipped: "no business" };
  const prepared = await withTenant(businessId, async (tx) => {
    const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, businessId)));
    if (!appt || appt.status !== "completed") return { skip: "not completed" } as const;
    const [existing] = await tx.select({ id: reviewRequests.id }).from(reviewRequests).where(eq(reviewRequests.appointmentId, appt.id));
    if (existing) return { skip: "already requested" } as const;
    // Don't ask regulars more than once a month.
    const [recent] = await tx
      .select({ id: reviewRequests.id })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.customerId, appt.customerId), gte(reviewRequests.createdAt, sql`now() - interval '30 days'`)));
    if (recent) return { skip: "asked recently" } as const;
    const [row] = await tx
      .insert(reviewRequests)
      .values({ businessId, appointmentId: appt.id, customerId: appt.customerId, status: "scheduled" })
      .onConflictDoNothing()
      .returning();
    if (!row) return { skip: "already requested" } as const;
    return { requestId: row.id, customerId: appt.customerId };
  });
  if ("skip" in prepared) return { skipped: prepared.skip ?? "skipped" };
  const res = await sendCustomerTemplate({
    businessId,
    customerId: prepared.customerId,
    appointmentId,
    template: "review_request",
    variables: ({ customer, business }) => [customer.name?.split(" ")[0] ?? "", business.name],
  });
  await withTenant(businessId, (tx) =>
    tx
      .update(reviewRequests)
      .set(res.status === "sent" ? { status: "sent", sentAt: new Date() } : { status: "expired" })
      .where(eq(reviewRequests.id, prepared.requestId)),
  );
  if (res.status === "skipped") return { skipped: res.reason ?? "skipped" };
}

const THANKS_GOOGLE: Record<ConversationLanguage, (url: string) => string> = {
  ar: (u) => `شكراً كتير! 🙏 بيفرحنا إذا بتكتبلنا رأيك عـ Google، بياخد دقيقة: ${u}`,
  arabizi: (u) => `Merci ktir! 🙏 Bifra7na iza btektebelna ra2yak 3a Google, byekhod d2i2a: ${u}`,
  en: (u) => `Thank you so much! 🙏 It would mean a lot if you shared it on Google — it takes a minute: ${u}`,
  fr: (u) => `Merci beaucoup ! 🙏 Cela nous aiderait énormément si vous laissiez un avis sur Google, ça prend une minute : ${u}`,
};
const THANKS: Record<ConversationLanguage, string> = {
  ar: "شكراً كتير على تقييمك! 🙏",
  arabizi: "Merci ktir 3a ta2yimak! 🙏",
  en: "Thank you so much for your rating! 🙏",
  fr: "Merci beaucoup pour votre note ! 🙏",
};
export const FEEDBACK_PROMPT: Record<ConversationLanguage, string> = {
  ar: "منعتذر إنو التجربة ما كانت متل ما لازم 🙏 فيك تخبرنا شو صار؟ رح نوصّل رأيك مباشرة لصاحب العيادة.",
  arabizi: "Mn3tezer enno el tajrobe ma kenet metel ma lezem 🙏 Fik tkhabbirna shu sar? Ra7 nwassel ra2yak la sa7eb el 3iyade direct.",
  en: "We're sorry it wasn't a great experience 🙏 Could you tell us what went wrong? It goes straight to the owner.",
  fr: "Nous sommes désolés que l'expérience n'ait pas été à la hauteur 🙏 Pouvez-vous nous dire ce qui s'est passé ? Votre message va directement au responsable.",
};
const FEEDBACK_THANKS: Record<ConversationLanguage, string> = {
  ar: "شكراً إنك خبّرتنا. وصلت ملاحظتك للإدارة ورح ياخدوها بعين الاعتبار 🙏",
  arabizi: "Merci enno khabbartna. Wislet mola7aztak lal edara w ra7 yekhdouwa b 3ayn el e3tibar 🙏",
  en: "Thank you for telling us. Your feedback has reached the management and they'll follow up 🙏",
  fr: "Merci de nous l'avoir dit. Votre retour a été transmis à la direction 🙏",
};

const ARABIC_DIGITS: Record<string, string> = { "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5" };

/** "5", "٥", "4/5", "5 ⭐", "⭐⭐⭐⭐" → rating, else null. */
export function parseRating(text: string): number | null {
  const t = text.trim().replace(/[١-٥]/g, (d) => ARABIC_DIGITS[d]!);
  const m = t.match(/^([1-5])\s*(?:\/\s*5)?\s*(?:[⭐★]️?\s*)*[.!]?$/u);
  if (m) return Number(m[1]);
  const stars = t.match(/^(?:[⭐★]️?\s*){1,5}$/u);
  if (stars) return (t.match(/[⭐★]/gu) ?? []).length;
  return null;
}

/**
 * Handle a customer message that answers a review request. Returns the reply
 * to send, or null when the message isn't about the review.
 * `lastOutbound` = the latest outbound message in the conversation.
 */
export async function handleReviewReply(
  business: Business,
  input: { customerId: string; conversationId: string; text: string; language: ConversationLanguage; lastOutbound: { body: string | null; contentType: string; createdAt: Date } | null },
): Promise<{ reply: string; rating?: number; feedback?: string } | null> {
  if (!hasFeature(business, "reviews") || !input.lastOutbound) return null;
  return withTenant(business.id, async (tx) => {
    const [req] = await tx
      .select()
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.businessId, business.id),
          eq(reviewRequests.customerId, input.customerId),
          inArray(reviewRequests.status, ["sent", "feedback_pending"]),
          gte(reviewRequests.sentAt, sql`now() - interval '7 days'`),
        ),
      )
      .orderBy(desc(reviewRequests.sentAt))
      .limit(1);
    if (!req) return null;
    const lang = input.language;
    if (req.status === "sent") {
      // Only right after our rating question (the last thing we sent).
      if (input.lastOutbound!.contentType !== "template" || input.lastOutbound!.createdAt < new Date(req.sentAt!.getTime() - 60_000)) return null;
      const rating = parseRating(input.text);
      if (!rating) return null;
      const positive = rating >= 4;
      await tx
        .update(reviewRequests)
        .set({ rating, status: positive ? "rated" : "feedback_pending", respondedAt: new Date() })
        .where(eq(reviewRequests.id, req.id));
      await audit(tx, { businessId: business.id, actor: { type: "customer" }, action: "review.rated", entityType: "review_request", entityId: req.id, changes: { rating } });
      const reply = positive ? (business.googleReviewUrl ? THANKS_GOOGLE[lang](business.googleReviewUrl) : THANKS[lang]) : FEEDBACK_PROMPT[lang];
      return { reply, rating };
    }
    // feedback_pending: the next free-text message right after our feedback question.
    if (!Object.values(FEEDBACK_PROMPT).includes(input.lastOutbound!.body ?? "")) return null;
    const feedback = input.text.trim().slice(0, 2000);
    if (!feedback) return null;
    await tx.update(reviewRequests).set({ feedback, status: "rated" }).where(eq(reviewRequests.id, req.id));
    await audit(tx, { businessId: business.id, actor: { type: "customer" }, action: "review.feedback", entityType: "review_request", entityId: req.id, changes: { rating: req.rating } });
    return { reply: FEEDBACK_THANKS[lang], rating: req.rating ?? undefined, feedback };
  });
}

export async function listReviews(tx: Tx, businessId: string, opts: { limit?: number; onlyNegative?: boolean } = {}) {
  return tx
    .select({ review: reviewRequests, customerName: customers.name, customerPhone: customers.phone })
    .from(reviewRequests)
    .innerJoin(customers, eq(customers.id, reviewRequests.customerId))
    .where(
      and(
        eq(reviewRequests.businessId, businessId),
        sql`${reviewRequests.rating} is not null`,
        opts.onlyNegative ? sql`${reviewRequests.rating} <= 3` : undefined,
      ),
    )
    .orderBy(desc(reviewRequests.respondedAt))
    .limit(opts.limit ?? 50);
}
