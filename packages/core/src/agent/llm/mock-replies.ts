/** Reply templates for the mock LLM, in Lebanese Arabic, Arabizi, English and French. */
import type { ConversationLanguage } from "../../db/schema";

type L = ConversationLanguage;
type Slot = { option: number; when: string; staff_name: string };

const pick = <T>(l: L, v: Record<L, T>): T => v[l];

const first = (name: string | null) => (name ? name.split(" ")[0] : "");

export const R = {
  offerVoice: (l: L, service: string, whens: string[], dayFull: boolean) => {
    const joined = whens.join(l === "ar" ? "، أو " : l === "fr" ? ", ou " : ", or ");
    return pick(l, {
      ar: `${dayFull ? "للأسف هاليوم مفوّل. " : ""}عنا لـ ${service}: ${joined}. أيّا بيناسبك؟`,
      arabizi: `${dayFull ? "Lal2asaf hayda el yom mfawwal. " : ""}3anna la ${service}: ${joined}. Ayya bi nesbak?`,
      en: `${dayFull ? "Sorry, that day is full. " : ""}For ${service} I have ${joined}. Which works for you?`,
      fr: `${dayFull ? "Désolée, ce jour est complet. " : ""}Pour ${service}, j'ai ${joined}. Lequel vous convient ?`,
    });
  },
  confirmVoice: (l: L, service: string, when: string, staff: string, name: string | null) =>
    pick(l, {
      ar: `تمام${name ? ` ${first(name)}` : ""}، يعني ${service} ${when} مع ${staff}. بأكّدلك ياه؟`,
      arabizi: `Tamem${name ? ` ${first(name)}` : ""}, ya3ne ${service} ${when} ma3 ${staff}. B2akkedlak ya2o?`,
      en: `Great${name ? `, ${first(name)}` : ""}. So that's ${service} ${when} with ${staff}. Shall I book it?`,
      fr: `Parfait${name ? ` ${first(name)}` : ""}. Donc ${service} ${when} avec ${staff}. Je confirme ?`,
    }),
  askOtherTime: (l: L) =>
    pick(l, {
      ar: "ولا يهمك. أي يوم أو ساعة بتفضّل؟",
      arabizi: "Wala yhemmak. Ayya yom aw sa3a btfaddel?",
      en: "No problem. Which day or time would you prefer?",
      fr: "Pas de souci. Quel jour ou quelle heure préférez-vous ?",
    }),
  greet: (l: L, persona: string, business: string, name: string | null) =>
    pick(l, {
      ar: name ? `أهلا ${first(name)} 👋 معك ${persona} من ${business}. كيف فيني ساعدك اليوم؟` : `أهلا وسهلا 👋 معك ${persona} من ${business}. كيف فيني ساعدك؟`,
      arabizi: name ? `Ahla ${first(name)} 👋 ma3ak ${persona} men ${business}. Kif fiye se3dak lyom?` : `Ahla w sahla 👋 ma3ak ${persona} men ${business}. Kif fiye se3dak?`,
      en: name ? `Hi ${first(name)} 👋 this is ${persona} from ${business}. How can I help you today?` : `Hello 👋 this is ${persona} from ${business}. How can I help you?`,
      fr: name ? `Bonjour ${first(name)} 👋 ici ${persona} de ${business}. Comment puis-je vous aider ?` : `Bonjour 👋 ici ${persona} de ${business}. Comment puis-je vous aider ?`,
    }),
  askService: (l: L, services: string[]) =>
    pick(l, {
      ar: `أكيد! لأي خدمة بدك الموعد؟\n${services.map((s) => `• ${s}`).join("\n")}`,
      arabizi: `Akid! La ayya khedme baddak el maw3ad?\n${services.map((s) => `• ${s}`).join("\n")}`,
      en: `Sure! Which service would you like to book?\n${services.map((s) => `• ${s}`).join("\n")}`,
      fr: `Bien sûr ! Pour quelle prestation ?\n${services.map((s) => `• ${s}`).join("\n")}`,
    }),
  offer: (l: L, service: string, slots: Slot[], dayFull: boolean) => {
    const list = slots.map((s) => `${s.option}. ${s.when}${s.staff_name ? ` — ${s.staff_name}` : ""}`).join("\n");
    return pick(l, {
      ar: `${dayFull ? "للأسف هاليوم مفوّل. " : ""}هيدي أقرب مواعيد لـ ${service}:\n${list}\nأيّا بيناسبك؟`,
      arabizi: `${dayFull ? "Lal2asaf hayda el yom mfawwal. " : ""}Hayde a2rab mawa3id la ${service}:\n${list}\nAyya bi nesbak?`,
      en: `${dayFull ? "Sorry, that day is full. " : ""}Here are the next available times for ${service}:\n${list}\nWhich one works for you?`,
      fr: `${dayFull ? "Désolée, ce jour est complet. " : ""}Voici les prochains créneaux pour ${service} :\n${list}\nLequel vous convient ?`,
    });
  },
  noSlots: (l: L, service: string) =>
    pick(l, {
      ar: `للأسف ما في مواعيد فاضية لـ ${service} بالأسابيع الجايي. بدك اترك رسالة للفريق يتصلوا فيك؟`,
      arabizi: `Lal2asaf ma fi mawa3id fadye la ${service} bel asabi3 el jeye. Baddak etrok risele lal team yetteslo fik?`,
      en: `Sorry, there's no availability for ${service} in the coming weeks. Would you like me to leave a message for the team to call you?`,
      fr: `Désolée, aucun créneau pour ${service} dans les prochaines semaines. Voulez-vous que je laisse un message à l'équipe ?`,
    }),
  askName: (l: L) =>
    pick(l, {
      ar: "تمام 👍 شو الاسم الكامل لو سمحت؟",
      arabizi: "Tamem 👍 shu el esem el kemel law sama7t?",
      en: "Great 👍 May I have your full name, please?",
      fr: "Parfait 👍 Puis-je avoir votre nom complet ?",
    }),
  askPhone: (l: L) =>
    pick(l, {
      ar: "وشو رقم الموبايل (واتساب) تبعك؟",
      arabizi: "W shu ra2m el mobile (WhatsApp) tab3ak?",
      en: "And what's your mobile (WhatsApp) number?",
      fr: "Et quel est votre numéro de mobile (WhatsApp) ?",
    }),
  booked: (l: L, service: string, when: string, staff: string, pending: boolean) =>
    pending
      ? pick(l, {
          ar: `وصلنا طلبك لـ ${service} ${when} مع ${staff}. الفريق رح يأكّدلك ياه قريباً ✅`,
          arabizi: `Wosilna talabak la ${service} ${when} ma3 ${staff}. El team ra7 y2akkedlak ya2o 2arib ✅`,
          en: `I've requested ${service} ${when} with ${staff}. The team will confirm shortly ✅`,
          fr: `J'ai enregistré votre demande pour ${service} ${when} avec ${staff}. L'équipe confirmera rapidement ✅`,
        })
      : pick(l, {
          ar: `تمّ ✅ حجزتلك ${service} ${when} مع ${staff}. رح يوصلك تأكيد عالواتساب.`,
          arabizi: `Tamem ✅ 7ajaztellak ${service} ${when} ma3 ${staff}. Ra7 yousalak ta2kid 3al WhatsApp.`,
          en: `Done ✅ You're booked for ${service} ${when} with ${staff}. You'll get a WhatsApp confirmation.`,
          fr: `C'est fait ✅ Rendez-vous ${service} ${when} avec ${staff}. Vous recevrez une confirmation WhatsApp.`,
        }),
  slotTaken: (l: L) =>
    pick(l, {
      ar: "عذراً، هالوقت انحجز هلّق. خليني شوفلك أوقات تانية…",
      arabizi: "Sorry, hal wa2t n7ajaz hala2. Khalline shoflak aw2at tenye…",
      en: "Sorry, that time was just taken. Let me find other times…",
      fr: "Désolée, ce créneau vient d'être pris. Je cherche d'autres horaires…",
    }),
  price: (l: L, service: string, price: string) =>
    pick(l, {
      ar: `${service}: ${price}. بدك احجزلك موعد؟`,
      arabizi: `${service}: ${price}. Baddak e7jezlak maw3ad?`,
      en: `${service}: ${price}. Would you like to book?`,
      fr: `${service} : ${price}. Voulez-vous prendre rendez-vous ?`,
    }),
  priceList: (l: L, lines: string[]) =>
    pick(l, {
      ar: `هيدي أسعارنا:\n${lines.join("\n")}`,
      arabizi: `Hayde as3arna:\n${lines.join("\n")}`,
      en: `Here are our prices:\n${lines.join("\n")}`,
      fr: `Voici nos tarifs :\n${lines.join("\n")}`,
    }),
  hours: (l: L, lines: string[]) =>
    pick(l, {
      ar: `أوقات الدوام:\n${lines.join("\n")}`,
      arabizi: `Aw2at el dawam:\n${lines.join("\n")}`,
      en: `Our opening hours:\n${lines.join("\n")}`,
      fr: `Nos horaires :\n${lines.join("\n")}`,
    }),
  location: (l: L, address: string, maps: string | null) =>
    pick(l, {
      ar: `عنواننا: ${address}${maps ? `\n📍 ${maps}` : ""}`,
      arabizi: `3inwanna: ${address}${maps ? `\n📍 ${maps}` : ""}`,
      en: `We're at ${address}${maps ? `\n📍 ${maps}` : ""}`,
      fr: `Notre adresse : ${address}${maps ? `\n📍 ${maps}` : ""}`,
    }),
  pickAppointment: (l: L, lines: string[]) =>
    pick(l, {
      ar: `عندك هالمواعيد:\n${lines.join("\n")}\nأيّا بتقصد؟`,
      arabizi: `3andak hal mawa3id:\n${lines.join("\n")}\nAyya ba2sod?`,
      en: `You have these appointments:\n${lines.join("\n")}\nWhich one do you mean?`,
      fr: `Vous avez ces rendez-vous :\n${lines.join("\n")}\nLequel ?`,
    }),
  noAppointments: (l: L) =>
    pick(l, {
      ar: "ما لقيت مواعيد جايي على رقمك. بدك احجزلك موعد جديد؟",
      arabizi: "Ma l2ayt mawa3id jeye 3a ra2mak. Baddak e7jezlak maw3ad jdid?",
      en: "I couldn't find any upcoming appointments for your number. Would you like to book one?",
      fr: "Je ne trouve aucun rendez-vous à venir pour votre numéro. Voulez-vous en prendre un ?",
    }),
  askWhen: (l: L, current: string) =>
    pick(l, {
      ar: `موعدك هلّق ${current}. لأيمتى بدك تغيّرو؟`,
      arabizi: `Maw3adak hala2 ${current}. La emta baddak tghayro?`,
      en: `Your appointment is currently ${current}. When would you like to move it to?`,
      fr: `Votre rendez-vous est actuellement ${current}. À quand souhaitez-vous le déplacer ?`,
    }),
  rescheduled: (l: L, when: string) =>
    pick(l, {
      ar: `تمّ ✅ صار موعدك ${when}.`,
      arabizi: `Tamem ✅ sar maw3adak ${when}.`,
      en: `Done ✅ Your appointment is now ${when}.`,
      fr: `C'est fait ✅ Votre rendez-vous est maintenant ${when}.`,
    }),
  cancelled: (l: L, when: string) =>
    pick(l, {
      ar: `تمّ إلغاء موعدك (${when}). إذا بدك موعد جديد بس خبّرني 🙏`,
      arabizi: `Tamem elgheyt maw3adak (${when}). Iza baddak maw3ad jdid bass 5abberne 🙏`,
      en: `Your appointment (${when}) is cancelled. Just message me if you'd like a new one 🙏`,
      fr: `Votre rendez-vous (${when}) est annulé. Écrivez-moi si vous souhaitez en reprendre un 🙏`,
    }),
  tooLate: (l: L) =>
    pick(l, {
      ar: "للأسف صار متأخر نغيّر هالموعد أونلاين. بدك اترك رسالة للفريق أو حوّلك لحدا منهم؟",
      arabizi: "Lal2asaf sar m2akhar nghayer hal maw3ad online. Baddak etrok risele lal team aw 7awwlak la 7ada menhon?",
      en: "Sorry, it's too late to change this appointment online. Shall I leave a message for the team or connect you with someone?",
      fr: "Désolée, il est trop tard pour modifier ce rendez-vous en ligne. Voulez-vous laisser un message ou parler à quelqu'un ?",
    }),
  handoff: (l: L, urgent: boolean) =>
    urgent
      ? pick(l, {
          ar: "سلامتك 🙏 إذا الوضع خطير اتصل فوراً بالصليب الأحمر 140. خبّرت الفريق هلّق ورح يتواصلوا معك بأسرع وقت.",
          arabizi: "Salemtak 🙏 iza el wade3 khatir ettesil fawran bel Red Cross 140. Khabbart el team hala2 w ra7 yetwasalo ma3ak b2asra3 wa2t.",
          en: "I'm sorry to hear that 🙏 If it's life-threatening, call the Red Cross on 140 now. I've alerted the team and someone will contact you right away.",
          fr: "Je suis désolée 🙏 En cas de danger, appelez la Croix-Rouge au 140. J'ai prévenu l'équipe, quelqu'un vous contacte tout de suite.",
        })
      : pick(l, {
          ar: "ولا يهمك، حوّلتك لحدا من الفريق ورح يردّوا عليك بأقرب وقت 🙏",
          arabizi: "Wala yhemmak, 7awwaltak la 7ada men el team w ra7 yraddo 3alek b2a2rab wa2t 🙏",
          en: "No problem — I've passed you to a member of the team; they'll reply shortly 🙏",
          fr: "Pas de souci — je vous mets en relation avec l'équipe, ils vous répondent rapidement 🙏",
        }),
  medical: (l: L) =>
    pick(l, {
      ar: "ما فيني إعطي نصائح طبية، بس الدكتور بيقدر يشوفك ويفيدك. بدك احجزلك موعد؟",
      arabizi: "Ma fiye a3te nase2i7 tebbiye, bass el doctor fi yshoufak w yfidak. Baddak e7jezlak maw3ad?",
      en: "I can't give medical advice, but the doctor can see you and advise. Would you like an appointment?",
      fr: "Je ne peux pas donner d'avis médical, mais le médecin pourra vous conseiller. Voulez-vous un rendez-vous ?",
    }),
  injection: (l: L) =>
    pick(l, {
      ar: "عذراً، ما فيني غيّر الأسعار أو السياسات أو شارك معلومات عن زبائن تانيين. فيني ساعدك بحجز أو بسؤال عن خدماتنا؟",
      arabizi: "Sorry, ma fiye ghayer el as3ar aw el policies aw sharek ma3lumet 3an zabeyen tenyin. Fiye se3dak b 7ajez aw so2al 3an khadamatna?",
      en: "Sorry, I can't change prices or policies or share information about other customers. Can I help you book or answer a question about our services?",
      fr: "Désolée, je ne peux pas modifier les prix ou les conditions, ni partager des informations sur d'autres clients. Puis-je vous aider à réserver ?",
    }),
  offTopic: (l: L) =>
    pick(l, {
      ar: "أنا هون بس لساعدك بالمواعيد والمعلومات عن العيادة 😊 بدك احجزلك؟",
      arabizi: "Ana hon bass la se3dak bel mawa3id w el ma3lumet 3an el clinic 😊 Baddak e7jezlak?",
      en: "I'm only here to help with appointments and questions about us 😊 Would you like to book?",
      fr: "Je suis là uniquement pour les rendez-vous et les questions sur notre cabinet 😊 Voulez-vous réserver ?",
    }),
  confused: (l: L) =>
    pick(l, {
      ar: "عذراً ما فهمت عليك منيح. بدك تحجز، تغيّر أو تلغي موعد، أو عندك سؤال؟",
      arabizi: "Sorry ma fhemet 3alek mnih. Baddak t7ejez, tghayer aw telghe maw3ad, aw 3andak so2al?",
      en: "Sorry, I didn't quite get that. Would you like to book, change or cancel an appointment, or ask a question?",
      fr: "Désolée, je n'ai pas bien compris. Souhaitez-vous réserver, modifier ou annuler un rendez-vous, ou poser une question ?",
    }),
  offerMessage: (l: L) =>
    pick(l, {
      ar: "يبدو إني مش عم فهم عليك منيح 🙏 بدك اترك رسالة للفريق، أو حوّلك لحدا منهم؟",
      arabizi: "Shakle mesh 3am efham 3alek mnih 🙏 Baddak etrok risele lal team, aw 7awwlak la 7ada menhon?",
      en: "I don't seem to be understanding you well 🙏 Shall I take a message for the team, or connect you with someone?",
      fr: "Je crains de mal vous comprendre 🙏 Voulez-vous laisser un message à l'équipe ou parler à quelqu'un ?",
    }),
  messageTaken: (l: L) =>
    pick(l, {
      ar: "تمام، تركت رسالتك للفريق ورح يتواصلوا معك 🙏",
      arabizi: "Tamem, tarakt risaltak lal team w ra7 yetwasalo ma3ak 🙏",
      en: "Got it — I've left your message for the team and they'll get back to you 🙏",
      fr: "C'est noté — j'ai transmis votre message à l'équipe, ils vous recontacteront 🙏",
    }),
  thanks: (l: L) =>
    pick(l, {
      ar: "تكرم عينك 🙏 إذا بدك شي تاني أنا هون.",
      arabizi: "Tekram 3aynak 🙏 iza baddak shi tene ana hon.",
      en: "You're welcome 🙏 I'm here if you need anything else.",
      fr: "Avec plaisir 🙏 Je reste disponible si besoin.",
    }),
  askWhichDay: (l: L, service: string) =>
    pick(l, {
      ar: `تمام، ${service}. أي يوم بيناسبك؟`,
      arabizi: `Tamem, ${service}. Ayya yom bi nesbak?`,
      en: `Great, ${service}. Which day suits you?`,
      fr: `Très bien, ${service}. Quel jour vous convient ?`,
    }),
};
