/**
 * Everyday conversation for Zelvero AI: greetings, thanks, "how are you", goodbyes, and
 * "what can you do". Answers are fixed, friendly, and in the language the person wrote in.
 * No store data is read here.
 */
import type { AiLang } from '../engine';
import { longDate } from './format';

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[!?.,،؟…:;)(]+/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const GREET =
  /^(?:hi|hii|hey|heyy|hello|helo|hola|yo|salam|slm|slam|salamo 3alaykom|salam 3alaykom|assalamu alaykum|marhaba|mar7aba|mar7ba|marhba|hala|halla|ahlan|ahla|ahleen|ahlein|bonjour|bonsoir|good (?:morning|afternoon|evening)|morning|saba7 el ?(?:5er|kher|khayr)|sabe7 el ?(?:5er|kher)|masa el ?(?:5er|kher)|masa2 el ?(?:5er|kher)|مرحبا|مرحبًا|مرحباً|هلا|هلأ|أهلين|اهلين|أهلا|اهلا|أهلاً|السلام عليكم|سلام عليكم|سلام|صباح الخير|صباحو|مسا الخير|مساء الخير|مسا النور|بونجور)(?: (?:ya )?(?:habibi|7abibi|zelvero|ai|يا حبيبي|حبيبي|زيلفيرو))?$/;

const HOW_ARE_YOU =
  /^(?:(?:hi|hello|hey|marhaba|mar7aba|hala|مرحبا|هلا) )?(?:how are you|how r u|how are u|how is it going|how's it going|kifak|kifik|kifkon|keefak|keefik|kifak ya \w+|kif el 7al|kif l 7al|kif l hal|shu l a5bar|shu el a5bar|shu l akhbar|shu akhbarak|sho l akhbar|كيفك|كيفكم|كيف الحال|كيف حالك|شو الأخبار|شو الاخبار|شو أخبارك|شلونك)$/;

const THANKS =
  /^(?:(?:ok|okay|tamam|طيب|تمام) )?(?:thanks|thank you|thank u|thx|tnx|ty|merci|mersi|merci ktir|shukran|shokran|chokran|yslmo|ysalmo|yeslamo|teslam|tislam|yslamo|شكرا|شكراً|مشكور|يسلمو|تسلم|مرسي|ميرسي)(?: (?:ktir|kteer|a lot|so much|كتير|كثير|حبيبي|habibi|7abibi))*$/;

const BYE = /^(?:bye|bye bye|goodbye|see you|ciao|yalla bye|ma3 salame|ma3 el salame|bshufak|باي|مع السلامة|مع السلامه|يلا باي|بشوفك)$/;

const CAPABILITIES =
  /^(?:help|help me|what can you do|what do you do|who are you|what are you|shu btaamel|shu bta3mel|shu fik ta3mel|shu fik t3mel|shu btaaref ta3mel|meen enta|min enta|shu enta|مساعدة|ساعدني|شو بتعمل|شو فيك تعمل|شو بتقدر تعمل|مين انت|مين إنت|شو انت|شو إنت)$/;

const TIME = /^(?:what(?:'s| is) the time|what time is it|time\??|(?:shu|sho|chou) (?:el |l )?sa3a|addeh (?:el |l )?sa3a|قديش الساعة|كم الساعة|شو الساعة)$/;
const DATE = /^(?:what(?:'s| is) (?:the )?(?:date|day)(?: today)?|what day is (?:it|today)|today'?s date|(?:shu|sho) (?:el |l )?(?:tarikh|tari5|yom) (?:lyom|el yom)?|شو التاريخ(?: اليوم)?|شو اليوم|أي يوم اليوم|قديش بالشهر)$/;
const JOKE = /^(?:tell me a joke|joke|say something funny|a joke|(?:2oule|oulle|2olle|olle) (?:nikte|nekte)|nikte|نكتة|قلي نكتة|قول نكتة|خبرني نكتة)$/;
const WEATHER = /\bweather\b|\btaqs\b|\bta2s\b|الطقس|الطقس اليوم|رح تشتي|عم تشتي/;

export type SmallTalkKind = 'greet' | 'howAreYou' | 'thanks' | 'bye' | 'capabilities' | 'time' | 'date' | 'joke' | 'weather';

export function smallTalkKind(text: string): SmallTalkKind | null {
  const t = fold(text);
  if (!t || t.length > 60) return null;
  if (WEATHER.test(t) && t.length <= 40) return 'weather';
  if (HOW_ARE_YOU.test(t)) return 'howAreYou';
  if (GREET.test(t)) return 'greet';
  if (THANKS.test(t)) return 'thanks';
  if (BYE.test(t)) return 'bye';
  if (CAPABILITIES.test(t)) return 'capabilities';
  if (TIME.test(t)) return 'time';
  if (DATE.test(t)) return 'date';
  if (JOKE.test(t)) return 'joke';
  if (WEATHER.test(t)) return 'weather';
  return null;
}

function partOfDay(now: Date, lang: AiLang): string {
  const h = now.getHours();
  if (lang === 'ar') return h < 12 ? 'صباح الخير' : h < 18 ? 'أهلين' : 'مسا الخير';
  return h < 12 ? 'Good morning' : h < 18 ? 'Hi' : 'Good evening';
}

export function capabilitiesText(lang: AiLang): string {
  return lang === 'ar'
    ? [
        'أنا Zelvero AI، مساعدك بالمحل. بقرا أرقام محلّك وبحكيلك ياها بكلام واضح:',
        '• **الشغل والملخص:** "كيف الشغل اليوم؟"',
        '• **المبيعات والربح:** "قديش ربحت هالجمعة؟"، "قارن هالشهر بالشهر الماضي"',
        '• **البضاعة:** "شو لازم اطلب؟"، "شو رح يخلص؟"، "قديش باقي بيبسي؟"',
        '• **الديون والصندوق:** "مين عليه ديون؟"، "قديش في بالصندوق؟"',
        '• **نصايح:** "كيف بزيد المبيعات؟"',
        '• **طريقة الاستعمال:** "كيف بعمل مرتجع؟"',
        'فيك تكتبلي بالعربي، بالإنكليزي، أو عربي بأحرف إنكليزية.',
      ].join('\n')
    : [
        "I'm Zelvero AI, your store assistant. I read your store's numbers and explain them plainly:",
        '• **Overview:** "How is business today?"',
        '• **Sales & profit:** "What did I make this week?", "Compare this month with last month"',
        '• **Stock:** "What should I reorder?", "What will run out?", "How many Pepsi are left?"',
        '• **Debts & cash:** "Who owes money?", "How much is in the drawer?"',
        '• **Advice:** "How can I increase sales?"',
        '• **How-to:** "How do I make a return?"',
        'Write in English, Arabic, or Arabizi.',
      ].join('\n');
}

export function smallTalkReply(text: string, lang: AiLang, now: Date = new Date()): string | null {
  const kind = smallTalkKind(text);
  if (!kind) return null;
  switch (kind) {
    case 'greet':
      return lang === 'ar'
        ? `${partOfDay(now, lang)}! كيف فيني ساعدك؟ فيك تسألني مثلاً "كيف الشغل اليوم؟" أو "شو لازم اطلب؟"`
        : `${partOfDay(now, lang)}! How can I help? Try "How is business today?" or "What should I reorder?"`;
    case 'howAreYou':
      return lang === 'ar'
        ? 'تمام، شكراً إنك سألت! جاهز ساعدك. بدك شوفلك كيف الشغل اليوم؟'
        : "I'm good, thanks for asking! Want me to check how business is going today?";
    case 'thanks':
      return lang === 'ar' ? 'العفو! إذا بدك شي تاني، أنا هون.' : "You're welcome! I'm here if you need anything else.";
    case 'bye':
      return lang === 'ar' ? 'مع السلامة، الله يوفقك بالشغل!' : 'Bye! Have a good day at the store.';
    case 'capabilities':
      return capabilitiesText(lang);
    case 'time': {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      return lang === 'ar' ? `الساعة هلّق ${hh}:${mm} حسب جهازك.` : `It's ${hh}:${mm} on this device.`;
    }
    case 'date':
      return lang === 'ar' ? `اليوم ${longDate(now, lang)} ${now.getFullYear()}.` : `Today is ${longDate(now, lang)} ${now.getFullYear()}.`;
    case 'joke':
      return lang === 'ar'
        ? 'زبون سأل: "عندك شي ببلاش؟" قلّو صاحب المحل: "إيه، النصيحة!" بدك نصيحة عن محلّك؟ اسألني "كيف بزيد المبيعات؟"'
        : 'A customer asked the shop owner, "Anything here for free?" He said, "Yes — advice!" Want some for your store? Ask "How can I increase sales?"';
    case 'weather':
      return lang === 'ar'
        ? 'ما عندي طقس، أنا بشوف بس أرقام محلّك. بس إذا الطقس عم يأثّر عالحركة، اسألني "قارن اليوم بمبارح".'
        : "I don't have weather — I only see your store's numbers. If weather is affecting traffic, ask me to compare today with yesterday.";
  }
}
