// 团队在线状态（P4-1 presence）：模块级单例 + 引用计数。
// 服务端语义是「打开流即在线、关闭即离线」，并且每次变化都推全量列表，
// 所以这里只需要保存最新快照；AppShell 挂载时 start()、卸载时 stop()，
// 多个消费者共享同一条连接（避免重复计入在线人数）。
import { ref } from "vue";
import { subscribeEvents } from "./event-stream";

export interface PresenceUser {
  id: string;
  name?: string;
  email?: string;
}

const online = ref<PresenceUser[]>([]);
const connected = ref(false);
let handle: { stop: () => void } | null = null;
let refs = 0;

export function usePresence() {
  function start() {
    refs += 1;
    if (handle) return;
    handle = subscribeEvents("/api/team/presence/events", {
      onOpen: () => {
        connected.value = true;
      },
      onError: () => {
        connected.value = false;
      },
      onEvent: (event) => {
        if (event.type === "presence" && Array.isArray(event.online)) {
          online.value = event.online as PresenceUser[];
        }
      },
    });
  }

  function stop() {
    refs = Math.max(0, refs - 1);
    if (refs > 0) return;
    handle?.stop();
    handle = null;
    online.value = [];
    connected.value = false;
  }

  return { online, connected, start, stop };
}
