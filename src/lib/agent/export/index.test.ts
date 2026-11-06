// Unit tests for the export entry point: format -> (content, contentType,
// filename) mapping plus the filename sanitiser. The sanitiser is security
// relevant - the filename lands in Content-Disposition - so path separators
// must never survive into the returned name.
import { describe, expect, it } from "vitest";

import type { AgentTask, ExportFormat } from "../types";
import { exportReport } from "./index";

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task_1",
    topic: "年度调研",
    workspaceId: "ws_default",
    outputFormat: "report",
    agents: ["planner", "writer"],
    maxSteps: 4,
    status: "done",
    steps: [],
    report: "# 结论\n\n- 甲",
    citations: [],
    outline: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("exportReport - markdown", () => {
  it("returns the report verbatim with a markdown content type", () => {
    const result = exportReport(makeTask(), "md");
    expect(result).toEqual({
      content: "# 结论\n\n- 甲",
      contentType: "text/markdown; charset=utf-8",
      filename: "年度调研.md",
    });
  });

  it("returns an empty string when the report was never generated", () => {
    expect(exportReport(makeTask({ report: undefined }), "md").content).toBe("");
  });

  it("derives the filename from the topic", () => {
    expect(exportReport(makeTask({ topic: "2026 Q4 规划" }), "md").filename).toBe("2026 Q4 规划.md");
  });
});

describe("exportReport - mindmap (OPML)", () => {
  it("wraps the report in an OPML document titled by the topic", () => {
    const result = exportReport(makeTask({ topic: "主题", report: "# 甲" }), "mindmap");
    expect(result.contentType).toBe("application/xml; charset=utf-8");
    expect(result.filename).toBe("主题.opml");
    expect(result.content).toContain('<opml version="2.0">');
    expect(result.content).toContain("<title>主题</title>");
    expect(result.content).toContain('<outline text="甲"/>');
  });

  it("still produces a valid document for an empty report", () => {
    const content = exportReport(makeTask({ report: undefined }), "mindmap").content as string;
    expect(content).toContain("<body>");
    expect(content).toContain("</opml>");
  });
});

describe("exportReport - pdf (print html)", () => {
  it("returns a printable HTML document", () => {
    const result = exportReport(makeTask({ topic: "主题" }), "pdf");
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(result.filename).toBe("主题.html");
    expect(result.content).toMatch(/^<!DOCTYPE html>/);
    expect(result.content).toContain("<h1>结论</h1>");
  });
});

describe("exportReport - pptx", () => {
  it("returns PPTX bytes with the OOXML content type", () => {
    const result = exportReport(makeTask({ topic: "主题" }), "pptx");
    expect(result.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(result.filename).toBe("主题.pptx");
    expect(result.content).toBeInstanceOf(Uint8Array);
    const bytes = result.content as Uint8Array;
    expect(Buffer.from(bytes.subarray(0, 4)).readUInt32LE(0)).toBe(0x04034b50); // "PK\x03\x04"
  });
});

describe("exportReport - filename sanitising", () => {
  it("replaces every path-unsafe character with an underscore", () => {
    const result = exportReport(makeTask({ topic: `a/b\\c:d*e?f"g<h>i|j` }), "md");
    expect(result.filename).toBe("a_b_c_d_e_f_g_h_i_j.md");
  });

  it("neutralises path traversal attempts", () => {
    expect(exportReport(makeTask({ topic: "../../etc/passwd" }), "md").filename).toBe(
      ".._.._etc_passwd.md",
    );
    expect(exportReport(makeTask({ topic: "C:\\Windows\\win.ini" }), "md").filename).toBe(
      "C__Windows_win.ini.md",
    );
  });

  it("caps the base name at 60 characters", () => {
    const result = exportReport(makeTask({ topic: "x".repeat(200) }), "pptx");
    expect(result.filename).toBe(`${"x".repeat(60)}.pptx`);
  });

  it("falls back to `report` when the topic is empty", () => {
    expect(exportReport(makeTask({ topic: "" }), "md").filename).toBe("report.md");
    expect(exportReport(makeTask({ topic: "" }), "mindmap").filename).toBe("report.opml");
  });

  it("falls back to `report` for markdown when the topic is missing at runtime", () => {
    // md only passes the topic through safeName; the other renderers escape it
    // into markup and therefore require it (see the contract test below)
    const task = makeTask({ topic: undefined as unknown as string });
    expect(exportReport(task, "md").filename).toBe("report.md");
  });

  it("keeps CJK and spaces in the filename", () => {
    expect(exportReport(makeTask({ topic: "周报 第 3 期" }), "pdf").filename).toBe("周报 第 3 期.html");
  });
});

describe("exportReport - contract boundaries", () => {
  it("does not mutate the task it is given", () => {
    const task = makeTask();
    const snapshot = JSON.parse(JSON.stringify(task));
    exportReport(task, "md");
    exportReport(task, "mindmap");
    exportReport(task, "pdf");
    exportReport(task, "pptx");
    expect(task).toEqual(snapshot);
  });

  it("requires a topic for the renderers that escape it (mindmap / pdf / pptx)", () => {
    const task = makeTask({ topic: undefined as unknown as string });
    expect(() => exportReport(task, "mindmap")).toThrow(TypeError);
    expect(() => exportReport(task, "pdf")).toThrow(TypeError);
    expect(() => exportReport(task, "pptx")).toThrow(TypeError);
  });

  it("returns undefined for a format outside the union (callers must pre-validate)", () => {
    expect(exportReport(makeTask(), "docx" as ExportFormat)).toBeUndefined();
  });
});
