// The big shows' cards the owner sent in the chat, put up on /predictions/ with the worker (owner 2026-10-15: «نبدا
// نعمل التوقعات بتاعت المباريات … WWE Crown Jewel 2026 … AEW WrestleDream»). Each event and each match goes in once
// (pred_seeds remembers it): a match added here later joins its event, and whatever the owner edits or deletes in the
// panel stays as the owner left it. Names as in scripts/wrestler-names.json; the posters are the shows' own, in
// assets/predictions/. Times: when the first match airs (the pre-show), when the picks close.
import { ensurePredict } from "./predict";

export type SeedMatch = { key: string; title: string; note: string; options: string[]; points: number; image: string };
export type SeedEvent = { key: string; title: string; title_en: string; starts: number; image: string; matches: SeedMatch[] };

const WD = "/assets/predictions/aew-wrestledream-2026";
const CJ = "/assets/predictions/wwe-crown-jewel-2026";

export const PRED_SEEDS: SeedEvent[] = [
  {
    // Saturday 17 October 2026, Addition Financial Arena, Orlando: the pre-show at 7:00 pm ET (EDT, UTC-4)
    key: "aew-wrestledream-2026", title: "عرض AEW WrestleDream 2026", title_en: "AEW WrestleDream 2026",
    starts: Date.UTC(2026, 9, 17, 23, 0), image: `${WD}.jpg`,
    matches: [
      { key: "clockwork", title: "مواجهة Clockwork Carnage الثمانية", note: "على بطولة AEW العالمية · ويل أوسبراي يدافع عن اللقب أمام سبعة منافسين", points: 3, image: `${WD}-clockwork.jpg`,
        options: ["ويل أوسبراي", "ساموا جو", "سبيدبول مايك بيلي", "آدم كوبلاند", "كونوسوكي تاكيشيتا", "كازوتشيكا أوكادا", "ريكوشيه", "داربي ألين"] },
      { key: "womens", title: "مرسيدس موني ضد ثيكلا", note: "على بطولة AEW العالمية للسيدات · مرسيدس موني البطلة", points: 2, image: `${WD}-womens.jpg`,
        options: ["مرسيدس موني", "ثيكلا"] },
      { key: "tag", title: "ذا يانغ باكس ضد كايل فليتشر وكيفن نايت", note: "على بطولة AEW العالمية للفرق · ذا يانغ باكس الأبطال", points: 1, image: `${WD}-tag.jpg`,
        options: ["ذا يانغ باكس", "كايل فليتشر وكيفن نايت"] },
      { key: "trios", title: "سويرف ستريكلاند وذا نيو ليفل ضد هانغمان آدم بيدج وبروديدو", note: "على بطولة AEW العالمية للثلاثيات · الفائز من يفوز بسقطتين من ثلاث", points: 1, image: `${WD}-trios.jpg`,
        options: ["سويرف ستريكلاند وذا نيو ليفل", "هانغمان آدم بيدج وبروديدو"] },
      { key: "continental", title: "جون موكسلي ضد مارك ديفيس", note: "على بطولة AEW القارية · جون موكسلي البطل", points: 1, image: `${WD}-continental.jpg`,
        options: ["جون موكسلي", "مارك ديفيس"] },
      { key: "national", title: "أندرادي إل إيدولو ضد توماسو تشامبا", note: "على بطولة AEW الوطنية · أندرادي البطل", points: 1, image: `${WD}-national.jpg`,
        options: ["أندرادي إل إيدولو", "توماسو تشامبا"] },
      { key: "tbs", title: "بيرسيفوني ضد داني لونا ضد هايان ضد كوين أميناتا", note: "على بطولة TBS · مواجهة رباعية · بيرسيفوني البطلة", points: 1, image: `${WD}-tbs.jpg`,
        options: ["بيرسيفوني", "داني لونا", "هايان", "كوين أميناتا"] },
      { key: "jericho-wayne", title: "كريس جيريكو ضد نيك واين", note: "نزال فردي", points: 1, image: `${WD}-jericho-wayne.jpg`,
        options: ["كريس جيريكو", "نيك واين"] },
      { key: "ftr-mcmg", title: "إف تي آر ضد موتور سيتي ماشين جانز", note: "قبل العرض الرئيسي · النزال الأول في سلسلة من خمسة نزالات", points: 1, image: `${WD}-ftr-mcmg.jpg`,
        options: ["إف تي آر", "موتور سيتي ماشين جانز"] },
      { key: "divine-sisters", title: "ديفاين دومينيون ضد سيسترز أوف سين", note: "قبل العرض الرئيسي · نزال فرق للسيدات", points: 1, image: `${WD}-divine-sisters.jpg`,
        options: ["ديفاين دومينيون", "سيسترز أوف سين"] },
    ],
  },
  {
    // Saturday 7 November 2026, Riyadh: 12:00 pm ET (EST, UTC-5)
    key: "wwe-crown-jewel-2026", title: "عرض WWE Crown Jewel 2026", title_en: "WWE Crown Jewel 2026",
    starts: Date.UTC(2026, 10, 7, 17, 0), image: `${CJ}.jpg`,
    matches: [
      { key: "reigns-zayn", title: "رومان رينز ضد سامي زين", note: "بطل ضد بطل · بطل العالم للوزن الثقيل ضد بطل WWE بلا منازع", points: 2, image: `${CJ}-reigns-zayn.jpg`,
        options: ["رومان رينز", "سامي زين"] },
      { key: "green-morgan", title: "تشيلسي غرين ضد ليف مورغان", note: "بطلة ضد بطلة · بطلة WWE للسيدات ضد بطلة العالم للسيدات", points: 2, image: `${CJ}-green-morgan.jpg`,
        options: ["تشيلسي غرين", "ليف مورغان"] },
    ],
  },
];

/** Puts up what isn't up yet. Each key is claimed before anything is written (INSERT OR IGNORE), so two requests at
 *  the same moment never put a card up twice; an event the owner deleted keeps its key and doesn't come back. */
export async function seedPredictions(db: D1Database, seeds: SeedEvent[] = PRED_SEEDS, now = Date.now()): Promise<number> {
  await ensurePredict(db);
  let added = 0;
  for (const s of seeds) {
    const claim = await db.prepare("INSERT OR IGNORE INTO pred_seeds (key, event, at) VALUES (?1, 0, ?2)").bind(s.key, now).run();
    let event = 0;
    if (claim.meta?.changes) {
      event = Number((await db.prepare("INSERT INTO pred_events (title, title_en, starts, image, status, created) VALUES (?1, ?2, ?3, ?4, 'open', ?5) RETURNING id")
        .bind(s.title, s.title_en, s.starts, s.image, now).first<{ id: number }>())?.id || 0);
      await db.prepare("UPDATE pred_seeds SET event = ?1 WHERE key = ?2").bind(event, s.key).run();
      added++;
    } else {
      event = Number((await db.prepare("SELECT event FROM pred_seeds WHERE key = ?1").bind(s.key).first<{ event: number }>())?.event || 0);
    }
    // still being put up by another request, or deleted by the owner
    if (!event || !(await db.prepare("SELECT id FROM pred_events WHERE id = ?1").bind(event).first())) continue;
    for (let i = 0; i < s.matches.length; i++) {
      const m = s.matches[i];
      const mk = await db.prepare("INSERT OR IGNORE INTO pred_seeds (key, event, at) VALUES (?1, ?2, ?3)").bind(`${s.key}/${m.key}`, event, now).run();
      if (!mk.meta?.changes) continue;
      await db.prepare("INSERT INTO pred_matches (event, ord, title, options, points, image, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(event, i, m.title, JSON.stringify(m.options), m.points, m.image, m.note).run();
    }
  }
  return added;
}
