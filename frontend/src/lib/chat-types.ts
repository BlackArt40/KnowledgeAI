// Shared chat view-model types for the extracted message/tag components.
import type { Citation } from "@/api/chat";

export interface ChatMsg {
  id: string;
  /** 服务端消息 id（done 事件写入），反馈 API 以它为准 */
  serverId?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  feedback?: "up" | "down";
  feedbackNote?: string;
  followUps?: string[];
}

export interface ChatRecommendation {
  id: string;
  name: string;
  desc: string;
  matched: string[];
}
