// P1 regression: model config create/update/test-result used to be
// memory-only while hydrateModelConfigs() read DB rows, so every restart
// silently dropped the user's provider config (including the API key).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/persist", () => ({
  persistModelConfig: vi.fn(async () => {}),
  deleteModelConfigFromDb: vi.fn(async () => {}),
}));

import { persistModelConfig } from "@/lib/db/persist";
import { createModel, setTestResult, updateModel } from "./store";
import type { ModelConfig } from "./types";

const persist = vi.mocked(persistModelConfig);

beforeEach(() => {
  persist.mockClear();
  (globalThis as unknown as Record<string, unknown>).__KAI_MODEL_STORE__ = undefined;
});

function create(): ModelConfig {
  return createModel("usr_1", {
    name: "my model",
    provider: "openai",
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-4o",
  }) as ModelConfig;
}

describe("model config persistence (P1)", () => {
  it("writes create, update and test-result to the DB", () => {
    const model = create();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toMatchObject({
      id: model.id,
      userId: "usr_1",
      chatModel: "gpt-4o",
    });

    updateModel("usr_1", model.id, { name: "renamed" });
    expect(persist).toHaveBeenCalledTimes(2);

    setTestResult("usr_1", model.id, true);
    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist.mock.calls[2][0]).toMatchObject({ lastTestOk: true });
  });
});
