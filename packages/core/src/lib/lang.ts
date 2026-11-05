/**
 * Lightweight language detection tuned for Lebanese customers, who mix
 * Lebanese Arabic (Arabic script), Arabizi (Arabic in Latin letters with
 * digits like 2/3/5/7/8/9 for Arabic sounds), English and French — often in
 * one message. Used to pick the reply language/script and by the mock LLM.
 */
import type { ConversationLanguage, Locale } from "../db/schema";

const ARABIC_RE = /[؀-ۿ]/g;

/** Common Arabizi/Lebanese tokens written in Latin letters. */
const ARABIZI_WORDS = new Set(
  (
    "badde baddi bade bede bdi badna baddak baddik 7ajez 7jez e7jez a7joz ehjoz ahjoz 7ajz maw3ad maw3id mawa3id maw3ade " +
    "bukra bokra bokra ba3d ba3den lyom elyom el yom hala2 halla2 hala2 sa3a se3a nos rebe3 ella wle wlik ya3ne ya3ni " +
    "shu chu shou kif kifak kifik kifkon marhaba mar7aba ahla sahla yislamo yeslamo merci tekram mnih mni7 tamem tamam " +
    "akid ma fi mafi fi chi shi 3am 3an 3anna 3andak 3andkon 3ande wen wein addesh adesh 2adesh adde2 2adde2 eddesh " +
    "ghayer ghayyer ghayyir 2ajjel ajjel ilghi elghe 2lghe lghi sabet sabt a7ad tnen tanen talata arb3a arba3a khamis jem3a jom3a " +
    "dohr do7r ed dohr el dohr sobo7 sob7 masa l masa tanzif tandif fa7es fa7s 7ashwe 7ashweh tabyid 3asab dakhtor doctor " +
    "ma3 ma3ak ma3ik esme esmi isme ana enta ente yalla yala inshalla inshallah habibi heik hek hayda hayde lesh leh"
  ).split(/\s+/),
);

const FRENCH_WORDS = new Set(
  (
    "je j'ai voudrais veux bonjour bonsoir merci rendez-vous rdv demain aujourd'hui après-midi apres-midi matin soir " +
    "pour avec est-ce estce quel quelle combien prix annuler changer déplacer deplacer disponible disponibilité " +
    "s'il svp plait plaît oui non semaine lundi mardi mercredi jeudi vendredi samedi dimanche heure heures nettoyage " +
    "détartrage detartrage consultation c'est vous nous mon ma mes le la les un une des du au aux"
  ).split(/\s+/),
);

const ENGLISH_WORDS = new Set(
  (
    "i i'd i'm want would like book booking appointment tomorrow today afternoon morning evening please thanks thank " +
    "how much price cost cancel change reschedule move available availability what when where is are the a an my me " +
    "can could you do have hours open cleaning checkup hello hi hey yes no next week monday tuesday wednesday thursday friday saturday sunday"
  ).split(/\s+/),
);

export type DetectedLanguage = { language: ConversationLanguage; locale: Locale; mixed: boolean };

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\- ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Arabizi heuristic: Latin word containing an Arabic-sound digit between letters. */
const ARABIZI_DIGIT_RE = /^[a-z]*[a-z][2356789][a-z]+|^[2356789][a-z]{2,}/;

export function detectLanguage(text: string, fallback: ConversationLanguage = "ar"): DetectedLanguage {
  const arabicChars = (text.match(ARABIC_RE) ?? []).length;
  const latinChars = (text.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length;
  const toks = tokens(text);
  let arabizi = 0;
  let fr = 0;
  let en = 0;
  for (const t of toks) {
    if (ARABIZI_WORDS.has(t) || ARABIZI_DIGIT_RE.test(t)) arabizi++;
    if (FRENCH_WORDS.has(t) || /[éèêàçùâîôû]/.test(t)) fr++;
    if (ENGLISH_WORDS.has(t)) en++;
  }
  const latinScores = [
    { l: "arabizi" as const, s: arabizi * 1.2 },
    { l: "fr" as const, s: fr },
    { l: "en" as const, s: en },
  ].sort((a, b) => b.s - a.s);
  const mixed = (arabicChars > 0 && latinChars > 2) || latinScores.filter((x) => x.s > 0).length > 1;

  if (arabicChars > 0 && arabicChars >= latinChars * 0.5) return { language: "ar", locale: "ar", mixed };
  if (latinChars === 0) return { language: fallback, locale: toLocale(fallback), mixed };
  const top = latinScores[0]!;
  if (top.s === 0) return { language: fallback === "ar" ? "en" : fallback, locale: toLocale(fallback === "ar" ? "en" : fallback), mixed };
  return { language: top.l, locale: toLocale(top.l), mixed };
}

export function toLocale(l: ConversationLanguage): Locale {
  return l === "arabizi" ? "ar" : l;
}

/** Normalize text for matching: lowercase, strip Arabic diacritics/tatweel, unify alef/ya/ta marbuta. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
