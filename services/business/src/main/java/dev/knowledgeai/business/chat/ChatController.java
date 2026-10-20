package dev.knowledgeai.business.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.knowledgeai.business.ai.AiClient;
import dev.knowledgeai.business.auth.ApiKeyService;
import dev.knowledgeai.business.auth.KaiJwtService;
import dev.knowledgeai.business.auth.UserRepository;
import dev.knowledgeai.business.ratelimit.RateLimiter;
import dev.knowledgeai.business.usage.UsageService;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * 问答（手册 4.4 + 4.8）：业务侧只做鉴权/租户/落库/计量，SSE 透传 Python 生成流。
 *
 * 事件契约（与现网一致，tests 断言锁定）：`data: {"type":"sources"|"token"|"done"}`。
 * done 帧由业务服务重组：Python done 帧提供 text/citations，业务服务补
 * messageId/conversationId 后转发 —— 与现网 BFF 行为一致。
 * 落库语义（4.4）：用户消息在流开始前写入，助手消息在 done 后写入；
 * 计量（4.5）：问答成功落库后 recordQa。
 */
@RestController
@Profile("pg")
public class ChatController {

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final AiClient ai;
    private final UsageService usage;
    private final RateLimiter limiter;
    private final ObjectMapper objectMapper;
    private final int kbLimit;

    public ChatController(JdbcTemplate jdbc, UserRepository users, AiClient ai, UsageService usage,
                          RateLimiter limiter, ObjectMapper objectMapper,
                          @Value("${ratelimit.kb-per-minute:60}") int kbLimit) {
        this.jdbc = jdbc;
        this.users = users;
        this.ai = ai;
        this.usage = usage;
        this.limiter = limiter;
        this.objectMapper = objectMapper;
        this.kbLimit = kbLimit;
    }

    public record ChatRequest(String kbId, String query, String conversationId) {
    }

    @PostMapping("/api/chat")
    public ResponseEntity<StreamingResponseBody> chat(Authentication authentication, @RequestBody ChatRequest body) {
        return chatStream(authentication, body);
    }

    /** G2 契约：/api/v1/chat（P7-1 版本化 API，SDK ask 使用）——同一 SSE 管线，
     *  API Key 必须携带 chat:read scope（JWT 用户不受影响）。 */
    @PostMapping("/api/v1/chat")
    public ResponseEntity<StreamingResponseBody> chatV1(Authentication authentication, @RequestBody ChatRequest body) {
        String scopeDenial = ApiKeyService.scopeDenied(authentication, "chat:read");
        if (scopeDenial != null) {
            return ResponseEntity.status(403)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(bufferOf("{\"error\":\"" + scopeDenial + "\"}"));
        }
        return chatStream(authentication, body);
    }

    private ResponseEntity<StreamingResponseBody> chatStream(Authentication authentication, ChatRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (body == null || body.kbId() == null || body.query() == null || body.query().isBlank()) {
            return ResponseEntity.badRequest().body(null);
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());

        // KB 维度限流（in-route，与现网同理由：filter 读不到路径/载荷参数）
        RateLimiter.Result kbRl = limiter.hit("kb:" + body.kbId(), kbLimit);
        if (!kbRl.allowed()) {
            return ResponseEntity.status(429)
                    .header("Retry-After", String.valueOf(kbRl.retryAfterSeconds()))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(bufferOf("{\"error\":\"该知识库请求过于频繁，请稍后重试\",\"dimension\":\"kb\"}"));
        }

        // KB 归属校验（ADR-0003：workspace 必须匹配，越权 404/403 语义与现网一致）
        List<Map<String, Object>> kb = jdbc.query(
                "SELECT id, name FROM \"KnowledgeBase\" WHERE id = ? AND \"workspaceId\" = ?",
                (rs, n) -> Map.<String, Object>of("id", rs.getString(1), "name", rs.getString(2)),
                body.kbId(), workspaceId);
        if (kb.isEmpty()) {
            return ResponseEntity.status(404).contentType(MediaType.APPLICATION_JSON)
                    .body(bufferOf("{\"error\":\"知识库不存在\"}"));
        }

        // 会话：复用（归属校验）或新建；标题取 query 前 24 字符（对齐现网）
        String conversationId = body.conversationId();
        if (conversationId != null && !conversationId.isBlank()) {
            List<Map<String, Object>> owned = jdbc.query(
                    "SELECT id FROM \"Conversation\" WHERE id = ? AND \"userId\" = ? AND \"kbId\" = ?",
                    (rs, n) -> Map.<String, Object>of("id", rs.getString(1)),
                    conversationId, user.id(), body.kbId());
            if (owned.isEmpty()) {
                return ResponseEntity.status(403).contentType(MediaType.APPLICATION_JSON)
                        .body(bufferOf("{\"error\":\"无权访问该会话\"}"));
            }
        } else {
            conversationId = "conv_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            jdbc.update("INSERT INTO \"Conversation\" (id, \"kbId\", \"userId\", title, \"workspaceId\", \"createdAt\", \"updatedAt\") "
                            + "VALUES (?, ?, ?, ?, ?, now(), now())",
                    conversationId, body.kbId(), user.id(),
                    body.query().strip().substring(0, Math.min(24, body.query().strip().length())), workspaceId);
        }

        // 用户消息先落库（现网语义：流开始前写入）
        String convId = conversationId;
        jdbc.update("INSERT INTO \"Message\" (id, \"conversationId\", role, content, \"createdAt\") VALUES (?, ?, ?, ?, now())",
                "msg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                convId, "user", body.query());

        // 调 Python（server-side retrieve：租户三元组由业务侧注入并已校验）
        final HttpResponse<InputStream> upstream;
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("workspaceId", workspaceId);
            payload.put("kbId", body.kbId());
            payload.put("conversationId", convId);
            payload.put("query", body.query());
            upstream = ai.chatStream(AiClient.toJson(payload));
        } catch (Exception e) {
            // 阶段 1 降级语义：AI 不可用 → 503 + Retry-After，不回退本地生成
            return ResponseEntity.status(503)
                    .header("Retry-After", "30")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(bufferOf("{\"error\":\"AI 服务暂时不可用，请稍后重试\",\"retryable\":true}"));
        }
        if (upstream.statusCode() != 200) {
            return ResponseEntity.status(503)
                    .header("Retry-After", "30")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(bufferOf("{\"error\":\"AI 服务暂时不可用，请稍后重试\",\"retryable\":true}"));
        }

        final String userId = user.id();
        StreamingResponseBody stream = out -> {
            try (InputStream in = upstream.body();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                StringBuilder frames = new StringBuilder();
                StringBuilder assistantText = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    // 透传：现网与 Python 均为 `data: {json}` 帧
                    out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    if (line.startsWith("data:")) frames.append(line).append('\n');
                    if (line.isBlank()) {
                        // 帧结束：提取 type，done 时落库 + 计量 + 重组 done
                        String payloadText = frames.toString();
                        List<String> payloads = SseFrameParser.extractDataPayloads(payloadText);
                        for (String json : payloads) {
                            String type = SseFrameParser.frameType(json);
                            if ("token".equals(type)) {
                                assistantText.append(extractText(json));
                            } else if ("done".equals(type)) {
                                // Jackson 解析 done 帧（citations 为嵌套 JSON，不能手写正则）
                                JsonNode doneNode = objectMapper.readTree(json);
                                String citations = doneNode.has("citations") && doneNode.get("citations").isArray()
                                        ? doneNode.get("citations").toString() : "[]";
                                String messageId = "msg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
                                jdbc.update("INSERT INTO \"Message\" (id, \"conversationId\", role, content, citations, \"createdAt\") "
                                                + "VALUES (?, ?, ?, ?, ?::jsonb, now())",
                                        messageId, convId, "assistant", assistantText.toString(), citations);
                                usage.recordQa(workspaceId, user.id());
                                // 重组 done（对齐现网：messageId/conversationId/citations）
                                out.write(("data: {\"type\":\"done\",\"messageId\":\"" + messageId
                                        + "\",\"conversationId\":\"" + convId + "\",\"citations\":"
                                        + citations + "}\n\n").getBytes(StandardCharsets.UTF_8));
                                out.flush();
                            }
                            // sources/token 原样透传（已写出）
                        }
                        frames.setLength(0);
                    }
                }
            } catch (Exception e) {
                // 上游中断/落库失败：显式 error 帧（对齐现网 {type:"error"} 语义）
                java.io.StringWriter sw = new java.io.StringWriter();
                e.printStackTrace(new java.io.PrintWriter(sw));
                System.err.println("[chat] stream failed: " + sw.toString().lines().findFirst().orElse("") + " / " + e.getMessage());
                try {
                    out.write("data: {\"type\":\"error\",\"message\":\"生成回答时出错，请重试。\"}\n\n".getBytes(StandardCharsets.UTF_8));
                    out.flush();
                } catch (IOException ignored) {
                    // 客户端已断开
                }
            }
        };
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("text/event-stream;charset=UTF-8"))
                .header("Cache-Control", "no-cache, no-transform")
                .body(stream);
    }

    private static String extractText(String json) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"text\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
        return m.find() ? m.group(1).replace("\\n", "\n").replace("\\\"", "\"") : "";
    }

    private static String extractJsonArray(String json, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"" + key + "\"\\s*:\\s*(\\[[^\\]]*\\])").matcher(json);
        return m.find() ? m.group(1) : "[]";
    }

    private static StreamingResponseBody bufferOf(String json) {
        return out -> out.write(json.getBytes(StandardCharsets.UTF_8));
    }
}
