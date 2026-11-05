/**
 * Rule-based understanding for Lebanese Arabic (Arabic script), Arabizi,
 * English and French. Powers the mock LLM so the product is fully usable and
 * testable without API keys. Real LLM providers don't use this.
 */
import { DateTime } from "luxon";
import { normalizeForMatch } from "../../lib/lang";
import { detectInjection } from "../guard";

export type Flags = {
  greeting: boolean;
  thanks: boolean;
  book: boolean;
  availability: boolean;
  reschedule: boolean;
  cancel: boolean;
  price: boolean;
  hours: boolean;
  location: boolean;
  human: boolean;
  complaint: boolean;
  emergency: boolean;
  medical: boolean;
  injection: boolean;
  offTopic: boolean;
  yes: boolean;
  no: boolean;
  urgentWord: boolean;
};

const has = (re: RegExp, s: string) => re.test(s);

/** Arabic-aware whole-word match (JS \b only understands ASCII word characters). */
const AR_EDGE = "[^\\u0600-\\u06FF]";
const arWord = (words: string) => new RegExp(`(?:^|${AR_EDGE})(?:${words})(?:$|${AR_EDGE})`);

export function parseFlags(raw: string): Flags {
  const t = normalizeForMatch(raw);
  return {
    greeting: has(/^(hi|hello|hey|marhaba|mar7aba|mar7abtein|ahla|ahlan|bonjour|bonsoir|salut|salam|good (morning|afternoon|evening)|sabah|saba7|kifak|kifik)\b/, t) || has(/^(مرحبا|مرحبتين|هلا|اهلا|سلام|صباح|مسا الخير|كيفك)/, t),
    thanks: has(/(merci|thanks|thank you|thx|yislamo|yeslamo|yislamu|shukran|shokran|tekram|شكرا|يسلمو|تسلم)/, t),
    book: has(/(7jez|7ajez|7ajz|e7jez|a7joz|ehjoz|ahjoz|7ajzeh|book|appointment|maw3ad|maw3id|mow3ad|موعد|احجز|حجز|rendez|rdv|r\.d\.v|reserver|prendre)/, t),
    availability: has(/(fi chi|fi shi|fi ayya|available|availability|free (slot|time)|any (slot|time|opening)|disponib|في شي|في موعد|في مواعيد|فاضي|fadi)/, t),
    reschedule: has(/(ghayer|ghayyer|ghayir|ghayyir|2ajjel|ajjel|a2ajjel|reschedule|change my|change the|move my|move the|postpone|deplacer|changer|reporter|decaler|غير|غيّر|اجل|بدل|بدّل|نقل)/, t),
    cancel: has(/(ilghi|elghe|elghi|2lghe|lghi|2elghe|cancel|annuler|annul|الغي|الغاء|بطل|batel|baddel)/, t) && !/no cancel/.test(t),
    price: has(/(adesh|addesh|2adesh|adde2|2adde2|eddesh|2addesh|how much|price|cost|combien|prix|tarif|\bsi3r\b|\bsa3r\b|قديش|بقديش|سعر)/, t) || has(arWord("كم|بكم"), t),
    hours: has(/(dawam|dawem|wa2t el dawam|open|opening|hours|closing|close at|ouvert|horaire|ferme|دوام|بتفتحو|بتسكرو|مفتوح|ساعات)/, t),
    location: has(/(\bwen\b|\bwein\b|where|address|location|adresse|ou se trouve|ou etes|وين|عنوان|موقع|\bmaps?\b)/, t),
    human: has(/(human|real person|a person|someone|talk to|speak to|speak with|staff member|operator|7ake 7ada|e7ke ma3|e7ke 7ada|7ake ma3|bade 7ada|parler a|quelqu.un|une personne|موظف|احكي مع|حدا من الفريق|انسان)/, t),
    complaint: has(/(complain|complaint|angry|terrible|worst|rude|unacceptable|plainte|inadmissible|scandal|inacceptable|زعلان|مش مقبول|شكوى|معيب|z3lan|za3len|za3lan|mesh ma2boul|msh ma2boul|ma bta3rfo)/, t),
    emergency: has(/(bleeding|swollen|swelling|accident|severe pain|really bad pain|can.?t breathe|broken tooth|saign|gonfl|douleur (forte|intense)|نزيف|عم ينزف|ورم|منفوخ|وجع كتير|مكسور|nazif|3am yenzof|wej3 ktir|waja3 ktir|wajaa ktir|ktir 3am yewja3|manfou5|manfoukh)/, t),
    medical: has(/(antibiotic|painkiller|medicine|medication|should i take|dosage|\bdose\b|ibuprofen|panadol|advil|\bdawa\b|\bdwa\b|medicament|antibiotique|is it normal|c.est normal)/, t) || has(arWord("دوا|دواء|مسكن|مضاد حيوي|حبوب|طبيعي"), t),
    injection:
      has(/(ignore (all|previous|your)|system prompt|you are now|pretend|developer mode|discount|khasm|5asm|خصم|remise|reduction|for free|majjanan|ببلاش|other (patients|customers)|everyone.s appointments|list (all )?(patients|customers)|tell me who)/, t) ||
      detectInjection(raw).kinds.some((k) => k === "override" || k === "data_exfiltration" || k === "prompt_leak"),
    offTopic: has(/(joke|weather|politic|president|football|recipe|homework|write (me )?(a|an) (poem|essay|code)|nokta|نكتة|طقس|سياسة)/, t),
    yes: has(/^(yes|yeah|yep|ok|okay|sure|eh|ee|aywa|ah|tamem|tamam|mashi|oui|d.accord)\b/, t) || has(/^(نعم|اي|ايه|تمام|ماشي|اوكي)(?:$|[^\u0600-\u06FF])/, t),
    no: has(/^(no|nope|la|la2|lae|non)\b/, t) || has(/^لا(?:$|[^\u0600-\u06FF])/, t),
    urgentWord: has(/(urgent|urgence|emergency|طارئ|tare2|daruri|ضروري)/, t),
  };
}

// ---------------------------------------------------------------------------
// Dates

const WEEKDAYS: [number, RegExp][] = [
  [1, /\b(monday|lundi|tnen|tanen|itnen|el tenen|tenen)\b|الاثنين|التنين|تنين|اثنين/],
  [2, /\b(tuesday|mardi|talata|tlete|el talata|tleta)\b|الثلاثاء|التلاتا|تلاتا|الثلاثا/],
  [3, /\b(wednesday|mercredi|arb3a|arba3a|arbe3a|arb3aa)\b|الاربعاء|الاربعا|اربعا/],
  [4, /\b(thursday|jeudi|khamis|5amis|el khamis|khmis)\b|الخميس|خميس/],
  [5, /\b(friday|vendredi|jem3a|jom3a|jum3a|jemaa)\b|الجمعه|الجمعة|جمعه/],
  [6, /\b(saturday|samedi|sabet|sabt|el sabet|sebt)\b|السبت|سبت/],
  [7, /\b(sunday|dimanche|a7ad|ahad|el a7ad|l a7ad)\b|الاحد|احد/],
];

const MONTHS: [number, RegExp][] = [
  [1, /(january|janvier|kenoun el tene|كانون الثاني|كانون التاني|يناير)/],
  [2, /(february|fevrier|shbat|شباط|فبراير)/],
  [3, /(march|mars|adar|اذار|آذار|مارس)/],
  [4, /(april|avril|nisan|نيسان|ابريل)/],
  [5, /(may|mai|ayyar|ايار|مايو)/],
  [6, /(june|juin|7zayran|حزيران|يونيو)/],
  [7, /(july|juillet|tammouz|tamouz|تموز|يوليو)/],
  [8, /(august|aout|\bab\b|آب|اب|اغسطس)/],
  [9, /(september|septembre|aylul|ayloul|ايلول|سبتمبر)/],
  [10, /(october|octobre|tishrin el awwal|tishrin awwal|تشرين الاول|اكتوبر)/],
  [11, /(november|novembre|tishrin el tene|tishrin tene|tishrin|تشرين الثاني|تشرين التاني|تشرين|نوفمبر)/],
  [12, /(december|decembre|kenoun el awwal|كانون الاول|ديسمبر)/],
];

/** Returns a business-local ISO date the customer referred to, or null. */
export function parseDate(raw: string, now: DateTime): string | null {
  const t = normalizeForMatch(raw);
  const today = now.startOf("day");
  if (/(ba3d ?bu?kra|ba3d bokra|بعد بكر|after tomorrow|apres[- ]demain)/.test(t)) return today.plus({ days: 2 }).toISODate();
  if (/(\bbu?kra\b|\bbokra\b|\bbukrah\b|بكرا|بكره|tomorrow|demain)/.test(t)) return today.plus({ days: 1 }).toISODate();
  if (/(\blyom\b|\bel ?yom\b|\belyom\b|today|aujourd.?hui|اليوم|\bhala2\b|هلق)/.test(t)) return today.toISODate();
  // "12/11", "12-11", "12.11"
  const dm = t.match(/\b(\d{1,2})[/\-.](\d{1,2})\b/);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let dt = DateTime.fromObject({ year: today.year, month: m, day: d }, { zone: now.zone });
      if (dt.isValid && dt < today) dt = dt.plus({ years: 1 });
      if (dt.isValid) return dt.toISODate();
    }
  }
  // "12 tishrin", "le 12 novembre", "12 November"
  const dayNum = t.match(/\b(\d{1,2})\s+(?=[a-z؀-ۿ])/);
  if (dayNum) {
    for (const [m, re] of MONTHS) {
      if (re.test(t)) {
        let dt = DateTime.fromObject({ year: today.year, month: m, day: Number(dayNum[1]) }, { zone: now.zone });
        if (dt.isValid && dt < today) dt = dt.plus({ years: 1 });
        if (dt.isValid) return dt.toISODate();
      }
    }
  }
  const nextWeek = /(next week|el jem3a el jeye|jem3a jeye|الجمعة الجاي|الاسبوع الجاي|semaine prochaine)/.test(t);
  for (const [wd, re] of WEEKDAYS) {
    if (re.test(t)) {
      let diff = (wd - today.weekday + 7) % 7;
      if (diff === 0) diff = 7;
      if (nextWeek && diff < 7) diff += 7;
      return today.plus({ days: diff }).toISODate();
    }
  }
  return null;
}

export function parsePartOfDay(raw: string): "morning" | "afternoon" | "evening" | null {
  const t = normalizeForMatch(raw);
  if (/(ba3d el dohr|ba3d l dohr|ba3d el do7r|ba3d dohr|ba3d el duhr|afternoon|apres[- ]midi|بعد الضهر|بعد الظهر|بعد ضهر|\bpm\b)/.test(t)) return "afternoon";
  if (/(sobo7|sob7|el sebe7|morning|matin|الصبح|الصباح|قبل الضهر|2abl el dohr|abl el dohr|\bam\b)/.test(t)) return "morning";
  if (/(masa|l masa|evening|soir|المسا|المساء|\bbel lel\b)/.test(t)) return "evening";
  return null;
}

const AR_NUM: [RegExp, number][] = [
  [/(طنعش|اثنا عشر|١٢)/, 12],
  [/(حدعش|احدى عشر)/, 11],
  [/(عشره|عشرة)/, 10],
  [/(تسعه|تسعة)/, 9],
  [/(تمانيه|تمانية|ثمانيه|ثمانية)/, 8],
  [/(سبعه|سبعة)/, 7],
  [/(سته|ستة)/, 6],
  [/(خمسه|خمسة)/, 5],
  [/(اربعه|اربعة)/, 4],
  [/(تلاته|تلاتة|ثلاثه|ثلاثة)/, 3],
  [/(تنتين|ثنتين|اثنين)/, 2],
  [/(وحده|وحدة|واحده|واحدة)/, 1],
];

/** Extract a clock time; hours 1–7 without am/morning are read as afternoon (clinic context). */
export function parseTime(raw: string): { h: number; m: number } | null {
  const t = normalizeForMatch(raw);
  let h: number | null = null;
  let m = 0;
  let explicitPm = false;
  let explicitAm = false;
  let r: RegExpMatchArray | null;
  if ((r = t.match(/\b(\d{1,2})\s*[:.h]\s*(\d{2})\b/))) {
    h = Number(r[1]);
    m = Number(r[2]);
  } else if ((r = t.match(/\b(\d{1,2})\s*(am|pm)\b/))) {
    h = Number(r[1]);
    explicitPm = r[2] === "pm";
    explicitAm = r[2] === "am";
  } else if ((r = t.match(/\b(\d{1,2})\s*h\b/))) {
    h = Number(r[1]);
  } else if ((r = t.match(/(?:\bsa3a|\bse3a|\bsa3at|الساعه|الساعة|ساعه|\ba|\bvers|\bat|\baround)\s*(\d{1,2})\b/))) {
    h = Number(r[1]);
  } else {
    const ar = t.match(/(?:الساعه|الساعة|ساعه|ساعة)\s*([؀-ۿ]+)/);
    if (ar) for (const [re, n] of AR_NUM) if (re.test(ar[1]!)) { h = n; break; }
  }
  if (h === null) return null;
  if (/(w nos|wnos|w nus|و نص|ونص|et demie|and a half|half past)/.test(t)) m = 30;
  else if (/(w rebe3|w rob3|و ربع|وربع|et quart|quarter past)/.test(t)) m = 15;
  else if (/(ella rebe3|ella rob3|illa rebe3|الا ربع|moins le quart|quarter to)/.test(t)) {
    h -= 1;
    m = 45;
  }
  if (explicitPm && h < 12) h += 12;
  if (explicitAm && h === 12) h = 0;
  const part = parsePartOfDay(raw);
  if (!explicitAm && !explicitPm) {
    if (part === "afternoon" || part === "evening") {
      if (h < 12) h += 12;
    } else if (part !== "morning" && h >= 1 && h <= 7) h += 12;
  }
  if (h > 23 || m > 59) return null;
  return { h, m };
}

const ORDINALS: [number, RegExp][] = [
  [1, /\b(el awwal|awwal|first|premier|premiere|1st)\b|الاول|اول واحد/],
  [2, /\b(el tene|tene|tani|second|deuxieme|2nd)\b|التاني|الثاني/],
  [3, /\b(el talet|talet|third|troisieme|3rd)\b|التالت|الثالث/],
  [4, /\b(el rebe3|fourth|quatrieme|4th)\b|الرابع/],
];

/** "1", "2", "el tene", "the second one" → option index (1-based). */
export function parseOption(raw: string, max: number): number | null {
  const t = normalizeForMatch(raw).trim();
  const bare = t.match(/^(?:option\s*|raqam\s*|رقم\s*|#)?(\d)\s*[.!)]?$/);
  if (bare) {
    const n = Number(bare[1]);
    return n >= 1 && n <= max ? n : null;
  }
  for (const [n, re] of ORDINALS) if (re.test(t) && n <= max) return n;
  return null;
}

const NOT_NAMES = /(maw3ad|موعد|book|bukra|tomorrow|demain|cancel|price|adesh|tamem|ok|yes|merci|thanks|shukran|hello|marhaba|bonjour|لا|نعم|تمام|اوكي)/;

export function parseName(raw: string, allowBare: boolean): string | null {
  const text = raw.trim();
  const latin = text.match(/(?:esme|esmi|isme|ismi|ana esmi|my name is|my name's|i am|i'm|je m'appelle|je suis|moi c'est|c'est|name\s*:)\s+([\p{L}][\p{L}' .-]{1,40})/iu);
  const arabic = text.match(/(?:اسمي|إسمي|انا اسمي|أنا اسمي|انا|أنا)\s+([\p{L} ]{2,40})/u);
  let name = latin?.[1] ?? arabic?.[1] ?? null;
  if (!name && allowBare) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 4 && /^[\p{L}' .-]+$/u.test(text) && !NOT_NAMES.test(normalizeForMatch(text))) name = text;
  }
  if (!name) return null;
  name = name.replace(/[.!,،]+$/, "").replace(/\s+(w|and|et|و)\s.*$/i, "").trim();
  if (name.length < 2) return null;
  if (/^[a-z' .-]+$/i.test(name)) name = name.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return name;
}

// ---------------------------------------------------------------------------
// Services

const SYNONYMS: [RegExp, string[]][] = [
  [/orthodon/i, ["takwim", "takweem", "تقويم", "braces", "orthodont"]],
  [/check|consult/i, ["checkup", "check up", "check-up", "fa7es", "fa7s", "fahes", "fa7ess", "فحص", "معاينه", "كشف", "consultation", "controle", "control"]],
  [/clean/i, ["tanzif", "tandif", "tanzeef", "tandeef", "تنظيف", "cleaning", "clean", "detartrage", "nettoyage", "scaling"]],
  [/fill/i, ["7ashwe", "7ashweh", "7ashwa", "hashwe", "حشوه", "filling", "plombage", "carie"]],
  [/whiten/i, ["tabyid", "tabyeed", "tabyiid", "تبييض", "whitening", "blanchiment"]],
  [/root canal/i, ["3asab", "sa7b 3asab", "عصب", "root canal", "canal", "devitalisation"]],
  [/extract/i, ["2la3", "ale3", "2le3", "2al3", "قلع", "extraction", "pull", "arracher"]],
  [/emergency/i, ["tare2", "طارئ", "طارئه", "emergency visit", "urgence", "toothache", "wej3 snan"]],
  [/haircut \+ beard|hair.*beard/i, ["sha3er w da2en", "sha3r w da2n", "شعر ودقن", "haircut and beard", "cut and beard", "coupe et barbe", "combo"]],
  [/kids/i, ["kids", "child", "wled", "ولاد", "enfant"]],
  [/beard/i, ["da2en", "da2n", "da2n", "دقن", "لحيه", "beard", "barbe"]],
  [/haircut/i, ["2ass", "2as sha3er", "ass sha3er", "2a9", "قص", "haircut", "hair cut", "coupe", "cut"]],
];

export type CatalogEntry = { id: string; names: string[]; en: string };

/** Parse the "# Catalog" section of the stable system prompt. */
export function parseCatalog(systemStable: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const line of systemStable.split("\n")) {
    const m = line.match(/^- service_id=([0-9a-f-]{36}) — (.+?) — \d+ min/);
    if (!m) continue;
    const names = m[2]!.split(" | ").map((p) => p.replace(/^(en|ar|fr): /, "").trim());
    const en = m[2]!.split(" | ").find((p) => p.startsWith("en: "))?.slice(4) ?? names[0]!;
    out.push({ id: m[1]!, names, en });
  }
  return out;
}

export function matchService(raw: string, catalog: CatalogEntry[]): CatalogEntry | null {
  const t = normalizeForMatch(raw);
  let best: { e: CatalogEntry; score: number } | null = null;
  for (const e of catalog) {
    let score = 0;
    for (const n of e.names) {
      const nn = normalizeForMatch(n);
      if (nn && t.includes(nn)) score = Math.max(score, 10 + nn.length);
    }
    for (const [re, words] of SYNONYMS) {
      if (!re.test(e.en)) continue;
      for (const w of words) if (t.includes(normalizeForMatch(w))) score = Math.max(score, 5 + w.length);
      break; // first matching synonym group only (most specific listed first)
    }
    if (score && (!best || score > best.score)) best = { e, score };
  }
  return best?.e ?? null;
}
