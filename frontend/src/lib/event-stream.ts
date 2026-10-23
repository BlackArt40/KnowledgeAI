// 客户端长连接订阅（SSE）：fetch + @shared/sse 单源切帧 + 断线重连。
//
// 为什么不用原生 EventSource：
//  - 需要带 Cookie（EventSource 同源默认带，但跨域部署 VITE_API_BASE 下无法指定 base）
//  - 需要与服务端共用同一份解析逻辑（`data: {json}\n\n`，`: ping` 注释帧自动跳过）
//  - 需要 401 统一跳登录（与 api/client.ts 一致）
//
// 三条消费方（P4-1 实时能力，V6 后由 Vue 承载）：
//  - /api/knowledge-base/[id]/events  KB 变更（settings/docs/doc_status/doc_deleted/doc_access/deleted）
//  - /api/team/presence/events        在线状态（presence: 全量在线列表）
//  - /api/chat/conversations/[id]/events 共享会话新消息（message）
import { consumeSseStream } from "@shared/sse";
import { apiUrl } from "@/api/client";

export type StreamEvent = Record<string, unknown>;

export interface EventStreamOptions {
  onEvent: (event: StreamEvent) => void;
  /** 连接建立（含重连成功） */
  onOpen?: () => void;
  /** 连接中断，随后按 reconnectMs 重连 */
  onError?: () => void;
  /** 重连间隔（毫秒，默认 3000；<=0 表示不重连） */
  reconnectMs?: number;
}

export interface EventStreamHandle {
  stop: () => void;
}

/**
 * 订阅一个 SSE 端点，返回停止句柄。流被服务端正常结束（连接被复用/超时）
 * 或网络中断都会按 reconnectMs 自动重连；401/403/404 属确定性失败，直接停止
 * （401 额外跳登录页），避免无意义的重连风暴。
 */
export function subscribeEvents(path: string, opts: EventStreamOptions): EventStreamHandle {
  const reconnectMs = opts.reconnectMs ?? 3000;
  let stopped = false;
  let controller: AbortController | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await fetch(apiUrl(path), {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (res.status === 401) {
          stopped = true;
          if (typeof window !== "undefined") window.location.href = "/login";
          break;
        }
        // 403：无权（如未共享的会话）；404：资源已删除 —— 都不重连
        if (res.status === 403 || res.status === 404) {
          stopped = true;
          break;
        }
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        opts.onOpen?.();
        await consumeSseStream(res, (event) => {
          if (!stopped) opts.onEvent(event);
        });
      } catch {
        // 主动 stop() 的 abort 不算错误
        if (stopped) break;
      }
      if (stopped || reconnectMs <= 0) break;
      opts.onError?.();
      await sleep(reconnectMs);
    }
    controller = null;
  };

  void run();

  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
  };
}
