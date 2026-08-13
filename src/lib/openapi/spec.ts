// ---------------------------------------------------------------------------
// OpenAPI 3.0.3 spec for the versioned public API (P7-1).
//
// Served at GET /api/openapi.json and rendered interactively by /docs
// (Swagger UI). Hand-maintained for the /api/v1/* surface - legacy routes
// (/api/chat etc.) stay unchanged for backward compatibility.
//
// Auth: either an API key (`Authorization: Bearer kai_sk_...`, scope-gated
// per operation) or a session JWT (same header). Swagger UI's "Authorize"
// button accepts both.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

const bearerAuth = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "kai_sk_... (API key) or session JWT",
  description: "API 密钥（Bearer kai_sk_...，按 scope 授权）或登录会话 JWT",
};

export const OPENAPI_SPEC: Spec = {
  openapi: "3.0.3",
  info: {
    title: "KnowledgeAI API",
    description:
      "KnowledgeAI 开放 API（v1）。支持知识库管理、流式智能问答、Agent 调研与 Webhook 事件订阅。\n\n" +
      "鉴权方式：在 Swagger UI 点击 Authorize，填入 `kai_sk_...` API 密钥（或会话 JWT）。" +
      "API 密钥在创建时分配 scope（kb:read / kb:write / chat:read / agent:run），" +
      "v1 端点按 scope 强制校验。",
    version: "v1",
    contact: { name: "KnowledgeAI" },
  },
  servers: [{ url: "/", description: "同源部署" }],
  tags: [
    { name: "Knowledge Bases", description: "知识库管理" },
    { name: "Chat", description: "流式智能问答（SSE）" },
    { name: "Agent", description: "Agent 调研（SSE）" },
    { name: "Webhooks", description: "Webhook 事件订阅" },
    { name: "Account", description: "身份与账户" },
  ],
  paths: {
    "/api/v1/me": {
      get: {
        tags: ["Account"],
        summary: "当前用户信息",
        description: "返回认证调用者的身份与工作区信息，SDK 可用于校验凭据。",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "用户信息",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/knowledge-bases": {
      get: {
        tags: ["Knowledge Bases"],
        summary: "知识库列表",
        description: "当前工作区内可见的知识库（含共享）。需要 API 密钥 scope: kb:read。",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "知识库列表",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/KbListResponse" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/ForbiddenScope" },
        },
      },
      post: {
        tags: ["Knowledge Bases"],
        summary: "创建知识库",
        description: "新建一个知识库。需要 API 密钥 scope: kb:write。",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateKbRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "创建成功",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/KbResponse" } },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/ForbiddenScope" },
        },
      },
    },
    "/api/v1/chat": {
      post: {
        tags: ["Chat"],
        summary: "流式智能问答（SSE）",
        description:
          "对指定知识库发起问答，返回 text/event-stream。事件：`sources`（引用来源）→ `token`（增量文本）* → `done`（{ messageId, conversationId, citations, followUps }）| `error`。\n" +
          "需要 API 密钥 scope: chat:read。",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ChatRequest" } },
          },
        },
        responses: {
          "200": {
            description: "SSE 流（text/event-stream）",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/TooManyRequests" },
        },
      },
    },
    "/api/v1/agent/run": {
      post: {
        tags: ["Agent"],
        summary: "Agent 调研（SSE）",
        description:
          "发起一次 Agent 调研任务，返回 text/event-stream。事件：`init`（{ taskId }）→ `step` * → `done`（{ task }）| `error`。任务在后台队列执行。\n" +
          "需要 API 密钥 scope: agent:run。",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/AgentRunRequest" } },
          },
        },
        responses: {
          "200": {
            description: "SSE 流（text/event-stream）",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "Webhook 订阅列表",
        description: "当前工作区内的 Webhook 订阅 + 最近投递记录。",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "订阅列表",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WebhookListResponse" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "创建 Webhook 订阅",
        description:
          "注册一个接收事件通知的 HTTPS 端点。投递带 `X-KAI-Signature: sha256=<HMAC(secret, body)>` 签名头，可校验来源真实性。",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateWebhookRequest" } },
          },
        },
        responses: {
          "201": {
            description: "创建成功",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WebhookResponse" } },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/webhooks/{id}": {
      get: {
        tags: ["Webhooks"],
        summary: "Webhook 订阅详情",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/WebhookId" }],
        responses: {
          "200": {
            description: "订阅 + 投递历史",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WebhookResponse" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Webhooks"],
        summary: "更新 Webhook 订阅",
        description: "修改名称 / 地址 / 密钥 / 事件 / 启用状态。",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/WebhookId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UpdateWebhookRequest" } },
          },
        },
        responses: {
          "200": {
            description: "更新成功",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WebhookResponse" } },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Webhooks"],
        summary: "删除 Webhook 订阅",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/WebhookId" }],
        responses: {
          "200": {
            description: "删除成功",
            content: {
              "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/webhooks/{id}/test": {
      post: {
        tags: ["Webhooks"],
        summary: "发送测试事件",
        description: "向该订阅投递一条 `ping` 测试事件，验证端点与签名。",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/WebhookId" }],
        responses: {
          "200": {
            description: "已排队投递",
            content: {
              "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth },
    parameters: {
      WebhookId: {
        name: "id",
        in: "path",
        required: true,
        description: "Webhook 订阅 ID",
        schema: { type: "string" },
      },
    },
    responses: {
      Unauthorized: {
        description: "未登录或 API Key 无效",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "未登录" },
          },
        },
      },
      Forbidden: {
        description: "无权访问",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "无权访问该知识库" },
          },
        },
      },
      ForbiddenScope: {
        description: "API Key 缺少所需 scope",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "API Key 缺少所需权限: kb:read" },
          },
        },
      },
      NotFound: {
        description: "资源不存在",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
      BadRequest: {
        description: "请求参数错误",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
      TooManyRequests: {
        description: "触发限流（Retry-After 秒后重试）",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "请求过于频繁，请稍后再试", retryAfter: 30, dimension: "user" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          retryAfter: { type: "number", description: "限流重试秒数（429 时出现）" },
          dimension: { type: "string", description: "限流维度（429 时出现）" },
        },
      },
      MeResponse: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              name: { type: "string" },
              role: { type: "string", enum: ["owner", "admin", "editor", "viewer"] },
              workspaceId: { type: "string" },
            },
          },
        },
      },
      CreateKbRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "知识库名称", example: "产品文档" },
          desc: { type: "string", description: "描述" },
          color: { type: "string", description: "主题色" },
        },
      },
      KbStats: {
        type: "object",
        properties: {
          total: { type: "number" },
          ready: { type: "number" },
          processing: { type: "number" },
          chunks: { type: "number" },
        },
      },
      KbResponse: {
        type: "object",
        properties: {
          kb: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              ownerId: { type: "string" },
              stats: { $ref: "#/components/schemas/KbStats" },
            },
          },
        },
      },
      KbListResponse: {
        type: "object",
        properties: {
          kbs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                shared: { type: "boolean" },
                ownerName: { type: "string" },
                stats: { $ref: "#/components/schemas/KbStats" },
              },
            },
          },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["kbId", "query"],
        properties: {
          kbId: { type: "string", description: "知识库 ID", example: "kb_xxxxxxxx" },
          query: { type: "string", description: "问题", example: "产品支持哪些格式？" },
          conversationId: { type: "string", description: "续接会话 ID（可选）" },
          webSearch: { type: "boolean", description: "开启联网搜索（默认 false）" },
          temperature: { type: "number", minimum: 0, maximum: 2 },
          topK: { type: "number", minimum: 1, maximum: 20, description: "检索条数" },
          regenerate: { type: "boolean", description: "重新生成上一条回答（P5-3）" },
        },
      },
      AgentRunRequest: {
        type: "object",
        required: ["topic"],
        properties: {
          topic: { type: "string", description: "调研主题", example: "2026 年大模型行业趋势" },
          kbId: { type: "string", description: "限定知识库（须为本人所有）" },
          outputFormat: { type: "string", enum: ["report", "ppt", "mindmap"] },
          agents: {
            type: "array",
            items: { type: "string", enum: ["planner", "searcher", "analyzer", "writer"] },
          },
          maxSteps: { type: "number", default: 5 },
        },
      },
      CreateWebhookRequest: {
        type: "object",
        required: ["url", "events"],
        properties: {
          name: { type: "string" },
          url: {
            type: "string",
            format: "uri",
            description: "接收端 HTTPS 地址",
            example: "https://example.com/webhooks/kai",
          },
          secret: { type: "string", description: "签名密钥（不填则无签名）" },
          events: {
            type: "array",
            items: { type: "string", enum: ["kb.ready", "agent.completed", "usage.alert"] },
            description: "订阅事件",
          },
        },
      },
      UpdateWebhookRequest: {
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string", format: "uri" },
          secret: { type: "string" },
          events: {
            type: "array",
            items: { type: "string", enum: ["kb.ready", "agent.completed", "usage.alert"] },
          },
          active: { type: "boolean" },
        },
      },
      WebhookResponse: {
        type: "object",
        properties: {
          webhook: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              url: { type: "string" },
              events: { type: "array", items: { type: "string" } },
              active: { type: "boolean" },
              createdAt: { type: "number" },
              lastDeliveryAt: { type: ["number", "null"] },
              failures: { type: "number" },
              lastError: { type: ["string", "null"] },
            },
          },
          deliveries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                event: { type: "string" },
                status: { type: "string" },
                ts: { type: "number" },
                latencyMs: { type: "number" },
              },
            },
          },
        },
      },
      WebhookListResponse: {
        type: "object",
        properties: {
          webhooks: {
            type: "array",
            items: { $ref: "#/components/schemas/WebhookResponse" },
          },
        },
      },
    },
  },
};

/** Path count helper for tests/docs. */
export function openapiPathCount(): number {
  return Object.keys(OPENAPI_SPEC.paths).length;
}
