// KB 实时事件（P4-1）的纯函数归约：把 `GET /api/knowledge-base/[id]/events`
// 的帧映射成「新的文档列表 + 是否要整表刷新」。抽出来的原因：组件里只留副作用
// （刷新 / 路由跳转 / 轮询调度），事件语义可以单测。
//
// 事件契约（服务端 src/lib/kb/store.ts 的 publish）：
//   settings    { kbId, settings, version, updatedAt }
//   docs        { kbId, doc:{id,name,type,size,status,progress,uploadedAt} }
//   doc_status  { kbId, docId, status, progress }        ← 处理管线高频推送
//   doc_deleted { kbId, docId }
//   doc_access  { kbId, docId, access }
//   deleted     { kbId }                                 ← 整库被删
export interface LiveKbDoc {
  id: string;
  status: string;
}

export interface KbEventResult<D extends LiveKbDoc> {
  docs: D[];
  /** 需要重新拉详情（统计 / chunks / error 只有服务端知道） */
  refresh: boolean;
  /** 当前知识库已被其他成员删除 */
  deleted: boolean;
}

/** 终态：只有进入终态才值得整表刷新，进度帧就地更新即可。 */
const TERMINAL = new Set(["ready", "failed"]);

export function applyKbEvent<D extends LiveKbDoc>(
  docs: D[],
  event: Record<string, unknown>
): KbEventResult<D> {
  const type = String(event.type ?? "");
  switch (type) {
    case "docs": {
      const doc = event.doc as D | undefined;
      if (!doc?.id || docs.some((d) => d.id === doc.id)) return { docs, refresh: false, deleted: false };
      return { docs: [doc, ...docs], refresh: false, deleted: false };
    }
    case "doc_status": {
      const idx = docs.findIndex((d) => d.id === event.docId);
      const refresh = TERMINAL.has(String(event.status ?? ""));
      if (idx < 0) return { docs, refresh, deleted: false };
      const next = docs.slice();
      // 通用文档类型上没有 progress 字段（各页面文档形状略有差异），这里按需补
      next[idx] = {
        ...next[idx],
        status: String(event.status ?? next[idx].status),
        progress: Number(event.progress ?? 0),
      } as D;
      return { docs: next, refresh, deleted: false };
    }
    case "doc_deleted":
      return { docs: docs.filter((d) => d.id !== event.docId), refresh: true, deleted: false };
    case "doc_access":
    case "settings":
      return { docs, refresh: true, deleted: false };
    case "deleted":
      return { docs, refresh: false, deleted: true };
    default:
      return { docs, refresh: false, deleted: false };
  }
}
