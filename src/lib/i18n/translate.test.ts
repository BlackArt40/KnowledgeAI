// P7-5 adapter tests: i18n core backed by i18next (v26). The adapter must
// preserve the contract of the old hand-rolled resolver: dotted keys, {var}
// interpolation, missing keys fall back to the key itself, missing vars keep
// their placeholder (the n8n `{{ $json.question }}` templates rely on it),
// and {count} pluralization degrades to the base key (zh has no plurals).
import { describe, it, expect } from "vitest";
import { normalizeLocale, t, getI18nInstance, MESSAGES, type Locale } from "./translate";

describe("normalizeLocale", () => {
  it("coerces to supported locales (default zh-CN)", () => {
    expect(normalizeLocale(null)).toBe("zh-CN");
    expect(normalizeLocale(undefined)).toBe("zh-CN");
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("fr-FR")).toBe("zh-CN");
  });
});

describe("translation contract (i18next adapter)", () => {
  it("resolves dotted keys against the nested message packs", () => {
    expect(t("zh-CN", "common.save")).toBe("保存");
    expect(t("en", "common.save")).toBe((MESSAGES.en as { common: { save: string } }).common.save);
  });

  it("interpolates {var} placeholders", () => {
    expect(t("zh-CN", "page.knowledge-graph.s17", { mentions: "3", docs: "2", neighbors: "4" }))
      .toContain("3");
  });

  it("keeps placeholders for missing variables (n8n {{ }} templates survive)", () => {
    const s70 = t("zh-CN", "page.developer.s70", { origin: "https://example.com" });
    expect(s70).toContain("https://example.com");
    expect(s70).toContain("{{ $json.question }}");
    // no vars at all: nothing is swallowed
    expect(t("zh-CN", "page.developer.s70")).toContain("{origin}");
  });

  it("falls back to the key itself for missing keys", () => {
    expect(t("zh-CN", "no.such.key")).toBe("no.such.key");
    expect(t("en", "no.such.key")).toBe("no.such.key");
  });

  it("does not double-escape interpolated values (React escapes on render)", () => {
    expect(t("en", "page.developer.s70", { origin: "https://a.com/x?y=1&z=2" }))
      .toContain("https://a.com/x?y=1&z=2");
  });

  it("{count} degrades to the base key without plural variants", () => {
    const out = t("zh-CN", "page.model-settings.s22", { count: "8", chat: "1", emb: "1", latency: "120" });
    expect(out).toContain("8");
    expect(out).not.toContain("s22");
  });

  it("t() is per-locale and getFixedT binds the locale", () => {
    const zhFixed = getI18nInstance().getFixedT("zh-CN");
    const enFixed = getI18nInstance().getFixedT("en");
    const key = "common.save";
    expect(zhFixed(key)).not.toBe(enFixed(key));
  });

  it("normalizeLocale is the single source of truth for locale typing", () => {
    const l: Locale = normalizeLocale("en");
    expect(t(l, "common.save")).toBe((MESSAGES.en as { common: { save: string } }).common.save);
  });
});
