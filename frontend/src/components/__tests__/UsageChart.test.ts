// @vitest-environment jsdom
// Batch 2: the usage chart used to draw a made-up rising curve for zero data;
// the empty state is a product decision, so it gets a component test.
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import UsageChart from "../UsageChart.vue";

describe("UsageChart", () => {
  it("shows the empty state when no data is passed", () => {
    const wrapper = mount(UsageChart);
    expect(wrapper.find(".chart-empty").exists()).toBe(true);
    expect(wrapper.find("svg").exists()).toBe(false);
    expect(wrapper.text()).toContain("page.usage-chart.s7");
  });

  it("treats an all-zero window as empty instead of drawing a flat line", () => {
    const wrapper = mount(UsageChart, { props: { data: [0, 0, 0, 0] } });
    expect(wrapper.find(".chart-empty").exists()).toBe(true);
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  it("renders an accessible svg with one line segment per gap", () => {
    const wrapper = mount(UsageChart, { props: { data: [1, 5, 3] } });

    const svg = wrapper.get("svg.usage-chart");
    expect(svg.attributes("role")).toBe("img");
    expect(svg.attributes("viewBox")).toBe("0 0 560 200");

    const line = wrapper.findAll("path").at(-1)!.attributes("d") ?? "";
    expect(line.startsWith("M")).toBe(true);
    expect(line.split("L").length - 1).toBe(2);
    expect(line).not.toContain("NaN");
  });

  it("handles a single data point without producing NaN coordinates", () => {
    const wrapper = mount(UsageChart, { props: { data: [4] } });
    const d = wrapper.findAll("path").at(-1)!.attributes("d") ?? "";
    expect(d).not.toContain("NaN");
  });
});
