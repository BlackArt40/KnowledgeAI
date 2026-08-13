// ---------------------------------------------------------------------------
// Entity extraction (NER) for the knowledge graph (P7-3).
//
// Demo path (deterministic, offline): pattern-based extraction for Chinese +
// English - person names (surname + 1-2 chars + optional title), organizations
// (suffixes like 公司/集团/大学/Corp/Inc), quoted concepts (「」/“”/《》/""),
// and events (date + 大会/峰会/发布/签署 ... patterns).
//
// LLM path: when a real chat model is configured, chatComplete returns a JSON
// entity list (person/organization/concept/event). The demo path is the
// default - tests rely on its determinism.
// ---------------------------------------------------------------------------

import type { EntityMention, RelationMention } from "./types";

const SURNAMES = "王李张刘陈杨赵黄周吴徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";

// ── 组织名停用字（tempered token）────────────────────────────────────────
// 组织名不得包含下列字——它们要么是连接词（会把「晨曦科技与蓝海集团」吞成
// 一个组织），要么是常见动词/疑问词（会让「做支付」「哪家公司」「晨曦科技总部」
// 这类过匹配进入名称）。每条按首次触发的过匹配案例注释：
const ORG_STOP_CHARS = [
  "与", "和", "及", // 连接词：晨曦科技**与**蓝海集团 → 两个组织
  "的", "是", "做", "作", "为", "在", "进行", "把", "让", "被", "对", "从", "向", "以", "等", "就", "都", "了", "之", "其", "得", // 功能/动词
  "共", // 共同开发新能源 → 阻止「共同开发新+能源」
  "发", // 开发/发布类动词（发展银行仍可匹配：展不在停用表）
  "总", // 晨曦科技**总**部 → 阻止「总部」被当后缀吞并
  "哪", "何", "什", "谁", "几", "多", "少", "怎么", // 疑问词：哪**家**公司
].join("|");
// NOTE: the tempered token stops org names at the chars above, so
// "晨曦科技与蓝海集团" yields two orgs and "做支付" doesn't swallow a verb.
const ORG_NAME = `(?:(?!${ORG_STOP_CHARS})[\\u4e00-\\u9fa5A-Za-z0-9])`;
// 后缀表：机构词尾。2 字科技后缀（科技/数据/…）用于匹配不带「公司」的短名
// （晨曦科技）；单字「云」被刻意排除——「是云/做云」过匹配远多于「阿里云」。
const ORG_SUFFIX = "公司|集团|大学|学院|研究院|研究所|协会|委员会|银行|医院|机构|实验室|工作室|基金会|出版社|中心|局|部|委|平台|科技|数据|智能|支付|能源|生物|网络|软件|医药|金融|信息";
const CONCEPT_QUOTES = /[「“《]([^」”》]{2,20})[」”》]/g;
const EVENT_PREFIX = "(?:\\d{4}年|\\d{1,2}月|\\d{1,2}日|[一二三四五六七八九十]+月|第\\d+届|首届|年度|20\\d{2})";
const EVENT_SUFFIX = "大会|峰会|论坛|会议|发布会|展览|博览会|活动|赛事|谈判|选举|签署|发布|上线|推出|峰会|年会";

const EN_PERSON = /(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g;
// org suffix is a separate word in English ("CloudBase Inc.") - allow \s?
const EN_ORG = /[A-Z][A-Za-z0-9&']{1,20}\s?(?:Inc|Corp|Ltd|LLC|University|Institute|Association|Foundation|Bank|Group|Agency|Council|Committee|Lab|Studio)/g;
const EN_CONCEPT = /"[^"]{2,30}"/g;
const EN_EVENT = /(?:the\s+)?(?:[A-Z][\w]+\s+)+(?:Summit|Conference|Forum|Expo|Election|Launch|Awards?)/g;

/** Extract entity mentions from a text (pure, deterministic in demo mode). */
export function extractEntities(text: string, opts: { llm?: boolean } = {}): EntityMention[] {
  if (!text || text.length < 2) return [];
  const mentions: EntityMention[] = [];

  // Chinese persons: 姓 + (name+title | 2-3 char bare name at a word
  // boundary). The titled form is tried FIRST so "王建国先生" wins over
  // "王建"; bare names require a boundary because "刘洋负" is ambiguous with
  // a name followed by a verb - demo NER prefers precision here.
  const personRe = new RegExp(
    `[${SURNAMES}](?:[\\u4e00-\\u9fa5]{1,2}(?:先生|女士|总|经理|博士|教授|老师|CEO|CTO|董事长)|[\\u4e00-\\u9fa5]{2,3}(?![\\u4e00-\\u9fa5]))`,
    "g"
  );
  for (const m of text.matchAll(personRe)) {
    mentions.push({ label: m[0], type: "person" });
  }

  // Chinese organizations: name + suffix (name stops at conjunctions).
  const orgRe = new RegExp(`${ORG_NAME}{2,12}(?:${ORG_SUFFIX})`, "g");
  for (const m of text.matchAll(orgRe)) {
    const label = m[0];
    // drop pure-suffix labels like "公司" or "委员会"
    if (label.replace(/[（(].*?[)）]/g, "").length >= 3) {
      mentions.push({ label, type: "organization" });
    }
  }

  // Quoted concepts (「」 “” 《》 —《》 is often a book title -> concept).
  for (const m of text.matchAll(CONCEPT_QUOTES)) {
    mentions.push({ label: m[1], type: "concept" });
  }

  // Events: date/ordinal prefix + event noun.
  const eventRe = new RegExp(`${EVENT_PREFIX}[\\u4e00-\\u9fa5A-Za-z0-9]{0,14}(?:${EVENT_SUFFIX})`, "g");
  for (const m of text.matchAll(eventRe)) {
    mentions.push({ label: m[0], type: "event" });
  }

  // English entities.
  for (const m of text.matchAll(EN_PERSON)) mentions.push({ label: m[0], type: "person" });
  for (const m of text.matchAll(EN_ORG)) mentions.push({ label: m[0], type: "organization" });
  for (const m of text.matchAll(EN_CONCEPT)) {
    mentions.push({ label: m[0].slice(1, -1), type: "concept" });
  }
  for (const m of text.matchAll(EN_EVENT)) mentions.push({ label: m[0], type: "event" });

  // Occurrences are intentionally NOT deduped here - callers that need
  // entity-level counts aggregate them (aggregateMentions in the graph store).
  return mentions;
}

/** Extract sentence co-occurrence relations between entities. */
export function extractRelations(text: string, mentions: EntityMention[]): RelationMention[] {
  if (mentions.length < 2) return [];
  const sentences = text.split(/[。！？!?；;\n]+/).filter((s) => s.trim().length > 1);
  const relations: RelationMention[] = [];
  for (const sentence of sentences) {
    const inSentence = mentions.filter((m) => sentence.includes(m.label));
    if (inSentence.length < 2) continue;
    for (let i = 0; i < inSentence.length; i++) {
      for (let j = i + 1; j < inSentence.length; j++) {
        const a = inSentence[i].label;
        const b = inSentence[j].label;
        if (a === b) continue; // no self-loops (same entity twice in a sentence)
        relations.push({ source: a, target: b });
      }
    }
  }
  return relations;
}

/** Aggregate mentions by label (entity-level counts across a document). */
export function aggregateMentions(mentions: EntityMention[]): Map<string, EntityMention & { count: number }> {
  const map = new Map<string, EntityMention & { count: number }>();
  for (const m of mentions) {
    const key = `${m.type}:${m.label}`;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { ...m, count: 1 });
  }
  return map;
}
