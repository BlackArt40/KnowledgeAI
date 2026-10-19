// ---------------------------------------------------------------------------
// Shared base-URL resolution for smoke scripts.
//
// BASE_URL is an operator override for WHICH LOCAL PORT the dev server runs
// on (default :3000; some smokes spawn their own server on another port).
// Smoke scripts must only ever talk to a local server, so the override is
// reduced to a validated port NUMBER and the origin is rebuilt from it - no
// other URL component from the environment is honored.
// ---------------------------------------------------------------------------

export function resolveSmokeBase(): string {
  const raw = process.env.BASE_URL || "http://localhost:3000";
  const u = new URL(raw);
  const port = Number(u.port) || 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`BASE_URL 必须是本地 http URL，收到: ${raw}`);
  }
  return `http://localhost:${port}`;
}

// V6：ui 组脚本的「页面」与「API」分离——页面由 vite preview（frontend dist）
// 承载，API 仍是 :3000。runner 对 ui 组条目注入 PAGE_URL（默认 :4173），
// 脚本内为 `process.env.PAGE_URL || BASE默认`。与 BASE_URL 同样的本地端口校验。
export function resolvePageBase(): string {
  const raw = process.env.PAGE_URL || "http://localhost:4173";
  const u = new URL(raw);
  const port = Number(u.port) || 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PAGE_URL 必须是本地 http URL，收到: ${raw}`);
  }
  return `http://localhost:${port}`;
}
