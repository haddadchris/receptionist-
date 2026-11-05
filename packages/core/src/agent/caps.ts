/**
 * Per-conversation AI caps (cost + abuse protection). Beyond the cap the
 * conversation is handed to staff instead of generating more AI replies.
 *  AI_MAX_REPLIES_PER_HOUR (default 40) — per WhatsApp / web-chat conversation
 *  AI_MAX_CALLS_PER_HOUR   (default 6)  — AI-answered calls per caller number
 */
import type { ConversationLanguage } from "../db/schema";
import { rateLimit } from "../lib/rate-limit";

const HOUR = 3_600_000;

export async function aiReplyAllowed(conversationId: string): Promise<boolean> {
  return (await rateLimit(`ai-reply:${conversationId}`, Number(process.env.AI_MAX_REPLIES_PER_HOUR ?? 40), HOUR)).ok;
}

export async function aiCallAllowed(businessId: string, from: string | null | undefined): Promise<boolean> {
  if (!from) return true;
  return (await rateLimit(`ai-call:${businessId}:${from}`, Number(process.env.AI_MAX_CALLS_PER_HOUR ?? 6), HOUR)).ok;
}

export const CAP_REPLY: Record<ConversationLanguage, string> = {
  ar: "شكراً على صبرك 🙏 حوّلت المحادثة لحدا من الفريق ورح يكمّل معك هون.",
  arabizi: "Merci 3a sabrak 🙏 7awwalt el mo7adase la 7ada men el team w ra7 ykammel ma3ak hon.",
  en: "Thanks for your patience 🙏 I've passed this conversation to the team and they'll continue with you here.",
  fr: "Merci de votre patience 🙏 J'ai transmis la conversation à l'équipe, qui va prendre le relais ici.",
};
