// Process/port helpers shared by the infra smoke scripts.
//
// Those scripts spawn throwaway production `next start` instances on :3100.
// `pnpm start` runs the script through `sh -c`, so the tree is
// pnpm -> sh -> next-server: killing the spawned pid alone leaves next-server
// listening. The next script then spawns "its own" instance, the bind fails,
// and its requests silently reach the stale instance - which lacks that
// script's env overrides (mock OAuth issuer, mock Notion URL, ...), so the
// route tries the real internet endpoint and the call hangs until undici's
// 300s headers timeout. Hence: always spawn detached and kill the group.

import type { ChildProcess } from "node:child_process";
import net from "node:net";

/** Spawn options that put the child in its own process group (see above). */
export const DETACHED: { detached: true } = { detached: true };

/** SIGTERM the child's whole process group, falling back to the child itself. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid;
  try {
    if (pid) process.kill(-pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/** True when something is listening on 127.0.0.1:<port>. */
export async function portInUse(port: number): Promise<boolean> {
  return new Promise((res) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (inUse: boolean) => {
      socket.destroy();
      res(inUse);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 1000).unref();
  });
}

/**
 * Refuse to start when a previous run leaked its instance on <port>. Without
 * this the script talks to the stale server and every call hangs.
 */
export async function assertPortFree(port: number, log: (msg: string) => void): Promise<boolean> {
  if (!(await portInUse(port))) return true;
  log(
    `❌ :${port} 已被占用——上一个 infra 脚本残留的 next-server 仍在监听。\n` +
      `   先停止它再重跑：lsof -nP -iTCP:${port} -sTCP:LISTEN -t | xargs kill`
  );
  return false;
}
