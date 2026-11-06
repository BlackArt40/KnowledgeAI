// @vitest-environment jsdom
// Batch 2: first view-level test. The 404 page is the fallback for every
// unmatched route after gateway cut-over, so both escape hatches (home, KB
// list) must exist and point somewhere real.
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => ({ "page.not-found.s0": "页面不存在", "page.not-found.s1": "回到首页", "page.not-found.s2": "浏览知识库", "page.not-found.s3": "链接可能已失效" })[key] ?? key,
  }),
}));

import NotFoundView from "../NotFoundView.vue";

const stubs = {
  RouterLink: {
    props: ["to"],
    template: '<a :href="to"><slot /></a>',
  },
};

describe("NotFoundView", () => {
  it("shows the 404 code and the localized copy", () => {
    const wrapper = mount(NotFoundView, { global: { stubs } });
    expect(wrapper.get(".code").text()).toBe("404");
    expect(wrapper.text()).toContain("页面不存在");
    expect(wrapper.text()).toContain("链接可能已失效");
  });

  it("offers both escape hatches with real targets", () => {
    const wrapper = mount(NotFoundView, { global: { stubs } });
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"));

    expect(hrefs).toEqual(expect.arrayContaining(["/", "/knowledge-base"]));
    expect(wrapper.text()).toContain("回到首页");
    expect(wrapper.text()).toContain("浏览知识库");
  });

  it("keeps the brand logo in the header slot", () => {
    const wrapper = mount(NotFoundView, { global: { stubs } });
    expect(wrapper.find("a.logo").exists()).toBe(true);
  });
});
