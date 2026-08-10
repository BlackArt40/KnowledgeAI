"use client";
import * as React from "react";
import { useSse } from "@/lib/use-sse";

export interface PresenceUser {
  userId: string;
  name: string;
  email: string;
  lastSeen: number;
}

interface PresenceContextValue {
  /** Members currently online (userId set, plus the ordered list). */
  online: Set<string>;
  onlineUsers: PresenceUser[];
  connected: boolean;
}

const PresenceContext = React.createContext<PresenceContextValue>({
  online: new Set(),
  onlineUsers: [],
  connected: false,
});

/** Global presence provider - mounts one SSE stream per app session so the
 *  user counts as ONLINE while the app is open (P4-1). */
export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [onlineUsers, setOnlineUsers] = React.useState<PresenceUser[]>([]);

  const { connected } = useSse("/api/team/presence/events", (event) => {
    if (event.type === "presence" && Array.isArray(event.online)) {
      setOnlineUsers(event.online);
    }
  });

  const value = React.useMemo<PresenceContextValue>(() => {
    const online = new Set(onlineUsers.map((u) => u.userId));
    return { online, onlineUsers, connected };
  }, [onlineUsers, connected]);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): PresenceContextValue {
  return React.useContext(PresenceContext);
}
