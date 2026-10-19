// 共享 i18next 单例在 Vue 侧的复用验证：语言包单源（不拷贝）、同步初始化、
// {var} 插值与 key 回退行为必须与 Next 端一致（契约：test-i18n-coverage 同源）。
import { describe, expect, it } from "vitest";
import { getI18nInstance, normalizeLocale } from "@shared/i18n/translate";

describe("shared i18next instance (frontend reuse)", () => {
  it("initializes synchronously from the shared message packs", () => {
    const i18n = getI18nInstance();
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t("common.save")).toBe("保存");
    expect(i18n.t("common.english")).toBe("English");
  });

  it("falls back to the key itself for unknown keys (gaps stay visible)", () => {
    expect(getI18nInstance().t("common.__no_such_key__")).toBe("common.__no_such_key__");
  });

  it("normalizes locale values (default zh-CN)", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("fr")).toBe("zh-CN");
    expect(normalizeLocale(null)).toBe("zh-CN");
  });
});
