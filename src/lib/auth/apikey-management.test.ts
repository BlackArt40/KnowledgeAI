import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/api-keys/route";
import { createKey, listKeys } from "@/lib/apikeys/store";

describe("POST /api/api-keys", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__KAI_APIKEY_STORE__;
  });

  it("does not let an API key mint a higher-scope replacement key", async () => {
    const existing = createKey("integration", ["chat:read"], "usr_owner");
    const req = new Request("http://localhost/api/api-keys", {
      method: "POST",
      headers: {
        authorization: `Bearer ${existing.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "escalated", scopes: ["kb:write"] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(listKeys("usr_owner")).toHaveLength(1);
    expect(listKeys("usr_owner")[0]?.name).toBe("integration");
  });
});
