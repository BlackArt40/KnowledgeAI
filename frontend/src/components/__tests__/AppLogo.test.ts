// @vitest-environment jsdom
// Batch 2: first component-level tests. AppLogo is the brand entry point on
// every marketing/auth page — its link semantics and the `light` variant are
// easy to break by refactor and invisible to the lib-level suite.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppLogo from "../AppLogo.vue";

describe("AppLogo", () => {
  it("links to the site root and renders the wordmark", () => {
    const wrapper = mount(AppLogo);

    const anchor = wrapper.get("a.logo");
    expect(anchor.attributes("href")).toBe("/");
    expect(anchor.text()).toContain("KnowledgeAI");
    expect(wrapper.find("a.logo").classes()).not.toContain("light");
  });

  it("keeps the mark decorative for screen readers", () => {
    const wrapper = mount(AppLogo);
    expect(wrapper.get(".mark").attributes("aria-hidden")).toBe("true");
  });

  it("applies the light variant only when asked", () => {
    const wrapper = mount(AppLogo, { props: { light: true } });
    expect(wrapper.get("a.logo").classes()).toContain("light");
  });
});
