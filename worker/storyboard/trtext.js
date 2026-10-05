// trtext.js: Turkish display names for characters + suffix re-attachment (vowel harmony, buffer letters, d/t).
// Deterministic, no Node APIs. Used by the lint (postprocess.js) and the scene-rewrite prompt (prompt.v6.js).
import { trLower, trUpper, fold } from "./research.js";

const VOWELS = "aeıioöuü";
const isV = (c) => VOWELS.includes(c);
const BACK = "aıou", ROUND = "oöuü";

// English noun (after "THE ") -> plain Turkish noun. Only a fallback for drafts without name_tr (older drafts or a
// model that skipped the field); the model's own name_tr always wins.
const TR_NOUNS = {
  ELEPHANT: "fil", CAT: "kedi", KITTEN: "yavru kedi", DOG: "köpek", PUPPY: "yavru köpek", HORSE: "at", COW: "inek",
  BIRD: "kuş", FISH: "balık", WHALE: "balina", BEAR: "ayı", LION: "aslan", TIGER: "kaplan", GIRAFFE: "zürafa",
  MONKEY: "maymun", RABBIT: "tavşan", DUCK: "ördek", OWL: "baykuş", PARROT: "papağan", TURTLE: "kaplumbağa",
  SNAIL: "salyangoz", BEE: "arı", BUTTERFLY: "kelebek", ANT: "karınca", PENGUIN: "penguen", DOLPHIN: "yunus",
  SHEEP: "koyun", GOAT: "keçi", CHICKEN: "tavuk", HEN: "tavuk", ROOSTER: "horoz", MOUSE: "fare", SQUIRREL: "sincap",
  FOX: "tilki", WOLF: "kurt", DINOSAUR: "dinozor", DRAGON: "ejderha", ROBOT: "robot", SEAGULL: "martı", GULL: "martı",
  MAN: "adam", WOMAN: "kadın", LADY: "kadın", GIRL: "kız", BOY: "çocuk", CHILD: "çocuk", KID: "çocuk", BABY: "bebek",
  TEENAGER: "genç", STUDENT: "öğrenci", TEACHER: "öğretmen", DOCTOR: "doktor", NURSE: "hemşire", CHEF: "aşçı",
  COOK: "aşçı", BARISTA: "barista", WAITER: "garson", WAITRESS: "garson", COURIER: "kurye", DRIVER: "şoför",
  COMMUTER: "yolcu", PASSENGER: "yolcu", TRAVELER: "yolcu", TRAVELLER: "yolcu", WORKER: "çalışan", EMPLOYEE: "çalışan",
  "OFFICE WORKER": "çalışan", CUSTOMER: "müşteri", SHOPPER: "müşteri", CLIENT: "müşteri", GUEST: "misafir",
  MOTHER: "anne", MOM: "anne", MUM: "anne", FATHER: "baba", DAD: "baba", GRANDMOTHER: "nine", GRANDMA: "nine",
  GRANDFATHER: "dede", GRANDPA: "dede", FAMILY: "aile", COUPLE: "çift", FRIEND: "arkadaş", NEIGHBOR: "komşu",
  NEIGHBOUR: "komşu", SALESMAN: "satıcı", SELLER: "satıcı", VENDOR: "satıcı", SHOPKEEPER: "esnaf", POLICEMAN: "polis",
  POLICE: "polis", FIREFIGHTER: "itfaiyeci", FARMER: "çiftçi", FISHERMAN: "balıkçı", ATHLETE: "sporcu", RUNNER: "koşucu",
  CYCLIST: "bisikletli", TOURIST: "turist", ARCHITECT: "mimar", ENGINEER: "mühendis", GUARD: "bekçi", POSTMAN: "postacı",
  MAILMAN: "postacı", HERO: "kahraman", PERSON: "kişi", CROWD: "kalabalık", SOFA: "kanepe", COUCH: "kanepe",
  ARMCHAIR: "koltuk", CHAIR: "sandalye", CAR: "araba", BUS: "otobüs", TRUCK: "kamyon", BIKE: "bisiklet",
  BICYCLE: "bisiklet", CUP: "fincan", MUG: "kupa", TEAPOT: "demlik", KETTLE: "çaydanlık", BOTTLE: "şişe",
  PHONE: "telefon", BOX: "kutu", PACKAGE: "paket", PARCEL: "paket", SUITCASE: "bavul", BALLOON: "balon", LAMP: "lamba",
  TREE: "ağaç", FLOWER: "çiçek", PLANT: "bitki",
};
const TR_ADJ = { OLD: "yaşlı", ELDERLY: "yaşlı", YOUNG: "genç", LITTLE: "küçük", SMALL: "küçük", TINY: "minik", BIG: "büyük",
  GIANT: "dev", HUGE: "dev", BABY: "yavru", NEW: "yeni" };
// Turkish words that are common nouns, so a capitalised name_tr ("Adam") is lowercased and glued ("adamın").
const COMMON_TR = new Set([...Object.values(TR_NOUNS), ...Object.values(TR_ADJ), "teyze", "amca", "abla", "abi", "hanım",
  "bey", "usta", "karakter", "diğer", "ikinci", "tekir", "sokak", "kedisi", "esnafı", "kız çocuk", "erkek", "delikanlı"]
  .flatMap((x) => x.split(" ")).map(fold));

const OBJECTS = new Set("SOFA COUCH ARMCHAIR CHAIR CAR BUS TRUCK BIKE BICYCLE CUP MUG TEAPOT KETTLE BOTTLE PHONE BOX PACKAGE PARCEL SUITCASE BALLOON LAMP".split(" "));
// Loanwords whose last syllable takes FRONT suffix vowels (gayrimenkulün, golü, saati, kalbi).
const FRONT_LAST = new Set("gayrimenkul menkul gol rol kontrol alkol futbol voleybol basketbol petrol protokol sembol metropol hal ihtimal meşgul kabul usul saat dikkat hayal kalp harf".split(" ").map(fold));
const nounOf = (id) => String(id || "").replace(/^THE\s+/i, "").trim();

// "THE OLD MAN" -> "yaşlı adam"; look decides when the noun is unknown; last resort "karakter".
export function defaultNameTr(id, look = "") {
  const words = trUpper(nounOf(id)).split(/\s+/).filter(Boolean);
  const full = words.join(" ");
  if (TR_NOUNS[full]) return TR_NOUNS[full];
  const head = words[words.length - 1] || "";
  let noun = TR_NOUNS[head];
  if (!noun) {
    const l = String(look || "").toLowerCase();
    noun = /\b(woman|lady|mother)\b/.test(l) ? "kadın" : /\bgirl\b/.test(l) ? "kız" : /\b(boy|child|kid)\b/.test(l) ? "çocuk"
      : /\b(man|guy|father)\b/.test(l) ? "adam" : "karakter";
    return noun;
  }
  const adj = words.slice(0, -1).map((w) => (w === "OLD" && OBJECTS.has(head) ? "eski" : TR_ADJ[w])).filter(Boolean);
  return [...adj.slice(-1), noun].join(" ");
}

// Cleans the model's name_tr: English id or copied English noun -> derived Turkish noun; capitals of a common noun
// ("ADAM", "Genç Kadın") -> lowercase, so it is glued like a noun ("adamın"); a real name ("Ayşe Teyze", "Boncuk") stays
// capitalised and takes an apostrophe.
export function normNameTr(raw, id, look = "") {
  let s = String(raw ?? "").normalize("NFC").replace(/["“”«»[\]()]/g, "").replace(/['’]\p{L}*\s*$/u, "").replace(/\s+/g, " ").trim();
  if (!s || /^the\s/i.test(s) || /[A-Za-z]/.test(s) && fold(s) === fold(nounOf(id)) && !COMMON_TR.has(fold(s)) || s.length > 40)
    return defaultNameTr(id, look);
  const letters = s.match(/\p{L}/gu) || [];
  if (letters.length >= 2 && letters.every((c) => /\p{Lu}/u.test(c))) s = trLower(s);            // "ADAM" -> "adam"
  if (/^\p{Lu}/u.test(s) && s.split(" ").every((w) => COMMON_TR.has(fold(w)))) s = trLower(s);
  return s;
}
export const isProperTr = (s) => /^\p{Lu}/u.test(String(s || ""));
export const capFirst = (s) => { const t = String(s || ""); return t ? trUpper(t[0]) + t.slice(1) : t; };

// Polysyllabic common nouns soften before a vowel suffix: köpek -> köpeği, çocuk -> çocuğu, kitap -> kitabı, ağaç -> ağacı.
function soften(word) {
  const w = String(word);
  if ((trLower(w).match(/[aeıioöuü]/g) || []).length < 2) return w;
  if (/nk$/.test(w)) return w.slice(0, -1) + "g";
  if (/[aeıioöuü]k$/.test(w)) return w.slice(0, -1) + "ğ";
  if (/p$/.test(w)) return w.slice(0, -1) + "b";
  if (/ç$/.test(w)) return w.slice(0, -1) + "c";
  return w;
}

// Re-attaches a suffix that was written after a different word ("THE COMMUTER'ın", "[MARKA ADI]'nın") to `stem`:
// drops the old buffer letter (n/y/s), adds the one the new word needs, d/t after hard consonants, vowel harmony.
// apostrophe: proper nouns and brands ("Sayın Gayrimenkul'ün", "STM'nin"); common nouns are glued ("yolcunun", "köpeği").
export function attachSuffix(stem, suffix, { apostrophe = true } = {}) {
  let s = trLower(String(suffix || "")).replace(/[^a-zçğıöşüâîû]/g, "").replace(/[âîû]/g, (c) => ({ â: "a", î: "i", û: "u" })[c]);
  const base = String(stem || "").trim();
  if (!s || !base) return base;
  let buf = "";
  const m = s.match(/^([nys])(?=[aeıioöuü])/) || s.match(/^(y)(?=l[ae]$)/);
  if (m) { buf = m[1]; s = s.slice(1); }
  const words = base.split(/\s+/);
  const last = words[words.length - 1];
  const caps = /^[\p{Lu}\d&]{2,6}$/u.test(last) && /\p{Lu}/u.test(last);
  let lv, endsV, hard;
  if (caps && ((last.match(/[AEIİOÖUÜ]/g) || []).length === 0 || last.length <= 3)) {   // acronym read letter by letter: "STM" = se-te-me
    const ch = trLower(last[last.length - 1]);
    lv = isV(ch) ? ch : "e"; endsV = true; hard = false;
  } else {
    const lw = trLower(last);
    lv = (lw.match(/[aeıioöuü](?=[^aeıioöuü]*$)/) || ["e"])[0];
    if (FRONT_LAST.has(fold(lw))) lv = { a: "e", ı: "i", o: "ö", u: "ü" }[lv] || lv;
    endsV = isV(lw[lw.length - 1]); hard = /[fstkçşhp]$/.test(lw);
  }
  let head = base, pre = "";
  if (isV(s[0])) {
    if (endsV) pre = buf === "n" || buf === "s" ? buf : /^[ıiuü]n/.test(s) ? "n" : "y";
    else if (!apostrophe) head = words.slice(0, -1).concat(soften(last)).join(" ");
  } else if (/^[dt]/.test(s)) s = (hard ? "t" : "d") + s.slice(1);
  else if (/^l[ae]$/.test(s) && endsV) pre = "y";                                            // kedi + le -> kediyle
  let prev = lv, res = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "i" && i === s.length - 1 && /[dt][ae]k$/.test(res)) { res += c; continue; }  // -daki / -deki
    if (c === "a" || c === "e") { const v = BACK.includes(prev) ? "a" : "e"; res += v; prev = v; }
    else if ("ıiuü".includes(c)) {
      const back = BACK.includes(prev), round = ROUND.includes(prev);
      const v = back ? (round ? "u" : "ı") : (round ? "ü" : "i"); res += v; prev = v;
    } else { res += c; if (c === "o" || c === "ö") prev = c; }
  }
  return head + (apostrophe ? "'" : "") + pre + res;
}
