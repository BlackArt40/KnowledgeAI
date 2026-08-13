// ---------------------------------------------------------------------------
// API-key scope enforcement for the versioned public API (P7-1).
//
// ApiKey.scopes are stored at creation time (see SCOPES in apikeys/types.ts)
// but the legacy routes never enforced them. The /api/v1/* surface DOES:
//   - requests authenticated with an API key (Bearer kai_sk_...) must carry
//     the scope required by the route, otherwise 403;
//   - JWT-authenticated requests (cookie/bearer session token) pass - they
//     are the key owner's own session and already carry full privileges.
// ---------------------------------------------------------------------------

import { validateApiKey } from "@/lib/apikeys/store";
import type { ApiKey } from "@/lib/apikeys/types";

export interface ScopeCheck {
  /** The validated API key when this request authenticated via an API key. */
  key: ApiKey | null;
  /** Non-null when authentication via API key failed (401) or the key lacks
   *  the required scope (403). The route must short-circuit with this. */
  error: Response | null;
}

/**
 * Enforce `scope` for API-key callers of a v1 route.
 * JWT callers are never rejected here (routes apply their own RBAC checks).
 */
export async function requireApiKeyScope(req: Request, scope: string): Promise<ScopeCheck> {
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken || !bearerToken.startsWith("kai_sk_")) {
    return { key: null, error: null };
  }

  const key = validateApiKey(bearerToken);
  if (!key) {
    return { key: null, error: Response.json({ error: "无效的 API Key" }, { status: 401 }) };
  }
  if (!key.scopes.includes(scope)) {
    return {
      key: null,
      error: Response.json(
        { error: `API Key 缺少所需权限: ${scope}` },
        { status: 403, headers: { "X-KAI-Required-Scope": scope } }
      ),
    };
  }
  return { key, error: null };
}
