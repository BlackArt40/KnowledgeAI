package dev.knowledgeai.business.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.knowledgeai.business.ai.AiClient;
import dev.knowledgeai.business.auth.ApiKeyService;
import dev.knowledgeai.business.auth.KaiJwtService;
import dev.knowledgeai.business.auth.UserRepository;
import dev.knowledgeai.business.usage.UsageService;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * Agent 任务（手册 5.1/5.3/5.4）：
 *
 *   POST /api/v1/agent/run          鉴权（JWT / API Key agent:run）→ 写 task 行 →
 *                                   经 Python /internal/agent/run 入队（Redis
 *                                   `agent:queue`）→ SSE 订阅 `agent:<taskId>` 转发。
 *                                   事件契约与现网一致：init/step/done/error/end
 *                                   （data: {json} 帧；done.task 为完整任务快照）。
 *   GET  /api/agent/tasks           任务列表（workspace 隔离；懒回收：终态快照回填 +
 *                                   超时任务标记失败 —— A5.6 worker 挂掉语义）
 *   GET  /api/agent/tasks/{id}      任务详情
 *   POST /api/agent/tasks/{id}/retry 失败任务重试（重新入队）
 *   PUT  /api/agent/tasks/{id}/share 分享配置（P2-3 语义）
 *   GET  /api/share/report/{id}     公开报告（shareConfig.enabled 才可匿名读，缺省 403）
 *
 * Webhook：agent 完成后投递 agent.completed（WebhookService，HMAC 兼容现网）。
 */
@RestController
@Profile("pg")
public class AgentController {

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final AiClient ai;
    private final AgentEventBus eventBus;
    private final WebhookService webhooks;
    private final UsageService usage;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final int taskTimeoutSeconds;
    private final long streamTimeoutMs;

    public AgentController(JdbcTemplate jdbc, UserRepository users, AiClient ai,
                           AgentEventBus eventBus, WebhookService webhooks, UsageService usage,
                           StringRedisTemplate redis, ObjectMapper objectMapper,
                           @Value("${agent.task-timeout-seconds:900}") int taskTimeoutSeconds,
                           @Value("${agent.stream-timeout-seconds:300}") long streamTimeoutSeconds) {
        this.jdbc = jdbc;
        this.users = users;
        this.ai = ai;
        this.eventBus = eventBus;
        this.webhooks = webhooks;
        this.usage = usage;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.taskTimeoutSeconds = taskTimeoutSeconds;
        this.streamTimeoutMs = streamTimeoutSeconds * 1000;
    }

    public record AgentRunRequest(String topic, String kbId, String outputFormat,
                                  List<String> agents, Integer maxSteps, String template) {
    }

    // ── 5.1 任务 API：POST /api/v1/agent/run → SSE ─────────────────────────

    @PostMapping("/api/v1/agent/run")
    public ResponseEntity<StreamingResponseBody> run(Authentication authentication,
                                                     @RequestBody AgentRunRequest body) {
        String scopeDenial = ApiKeyService.scopeDenied(authentication, "agent:run");
        if (scopeDenial != null) {
            return jsonError(403, "{\"error\":\"" + scopeDenial + "\"}");
        }
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (body == null || body.topic() == null || body.topic().isBlank()) {
            return jsonError(400, "{\"error\":\"调研主题不能为空\"}");
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        String kbName = null;
        if (body.kbId() != null && !body.kbId().isBlank()) {
            List<String> kb = jdbc.query(
                    "SELECT name FROM \"KnowledgeBase\" WHERE id = ? AND \"workspaceId\" = ?",
                    (rs, n) -> rs.getString(1), body.kbId(), workspaceId);
            if (kb.isEmpty()) {
                return jsonError(403, "{\"error\":\"无权访问该知识库\"}");
            }
            kbName = kb.get(0);
        }

        // A5.6：worker 心跳缺失 → 不入队，任务直接标记失败（可重试），SSE 报错误帧
        boolean workerAlive = Boolean.TRUE.equals(redis.hasKey("agent:worker:heartbeat"));
        String taskId = "task_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String agentsJson = toJsonArray(body.agents() == null
                ? List.of("planner", "searcher", "analyzer", "writer") : body.agents());
        String status = workerAlive ? "queued" : "failed";
        jdbc.update("INSERT INTO \"AgentTask\" (id, \"userId\", topic, \"kbId\", \"kbName\", "
                        + "\"outputFormat\", status, agents, \"maxSteps\", template, \"workspaceId\", "
                        + "\"createdAt\", \"updatedAt\") VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, now(), now())",
                taskId, user.id(), body.topic().trim(),
                body.kbId() == null || body.kbId().isBlank() ? null : body.kbId(),
                kbName, body.outputFormat() == null ? "report" : body.outputFormat(),
                status, agentsJson, body.maxSteps() == null ? 5 : body.maxSteps(),
                body.template() == null ? "default" : body.template(), workspaceId);
        usage.recordAgent(workspaceId, user.id());

        // 订阅先于入队（防丢首帧，与 TS run-handler 一致）
        AgentEventBus.FrameChannel channel = eventBus.subscribe(taskId);
        final String ws = workspaceId;
        final String kbNameFinal = kbName;

        StreamingResponseBody stream = out -> {
            try (channel) {
                writeFrame(out, "{\"type\":\"init\",\"taskId\":\"" + taskId + "\"}");
                if (!workerAlive) {
                    writeFrame(out, "{\"type\":\"error\",\"code\":\"worker_offline\","
                            + "\"message\":\"AI worker 离线，任务已标记失败，可稍后重试\"}");
                    writeFrame(out, "{\"type\":\"end\"}");
                    return;
                }
                // 经 Python /internal/agent/run 入队（QUEUE_MAX_DEPTH 背压在 Python 侧判定）
                Map<String, Object> job = new LinkedHashMap<>();
                job.put("taskId", taskId);
                job.put("workspaceId", ws);
                job.put("topic", body.topic().trim());
                if (body.kbId() != null && !body.kbId().isBlank()) job.put("kbId", body.kbId());
                if (kbNameFinal != null) job.put("kbName", kbNameFinal);
                job.put("outputFormat", body.outputFormat() == null ? "report" : body.outputFormat());
                if (body.agents() != null) job.put("agents", body.agents());
                job.put("maxSteps", body.maxSteps() == null ? 5 : body.maxSteps());
                job.put("template", body.template() == null ? "default" : body.template());
                job.put("userId", user.id());
                job.put("createdAt", System.currentTimeMillis());
                HttpResponse<String> enqueueRes;
                try {
                    enqueueRes = ai.postInternal("/internal/agent/run", AiClient.toJson(job));
                } catch (Exception e) {
                    markTaskStatus(taskId, "failed");
                    writeFrame(out, "{\"type\":\"error\",\"code\":\"queue_failed\","
                            + "\"message\":\"排队失败，请稍后重试\"}");
                    writeFrame(out, "{\"type\":\"end\"}");
                    return;
                }
                if (enqueueRes.statusCode() == 429) {
                    // A5.7 背压：队列已满，拒绝并标记失败（code 对齐现网 queue_busy）
                    markTaskStatus(taskId, "failed");
                    writeFrame(out, "{\"type\":\"error\",\"code\":\"queue_busy\","
                            + "\"message\":\"系统繁忙（任务队列已满），请稍后重试\"}");
                    writeFrame(out, "{\"type\":\"end\"}");
                    return;
                }
                if (enqueueRes.statusCode() >= 300) {
                    markTaskStatus(taskId, "failed");
                    writeFrame(out, "{\"type\":\"error\",\"code\":\"queue_failed\","
                            + "\"message\":\"排队失败，请稍后重试\"}");
                    writeFrame(out, "{\"type\":\"end\"}");
                    return;
                }

                // 转发循环：step/done/error 透传；done 落库 + webhook；end 关流
                long deadline = System.currentTimeMillis() + streamTimeoutMs;
                while (System.currentTimeMillis() < deadline) {
                    String frame = channel.poll(25_000);
                    if (frame == null) {
                        out.write(": ping\n\n".getBytes(StandardCharsets.UTF_8)); // SSE 保活
                        out.flush();
                        continue;
                    }
                    out.write(("data: " + frame + "\n\n").getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    String type = frameType(frame);
                    if ("done".equals(type)) {
                        persistDone(taskId, frame);
                        emitAgentCompleted(ws, frame);
                    } else if ("error".equals(type)) {
                        markTaskStatus(taskId, "failed");
                    } else if ("end".equals(type)) {
                        return;
                    }
                }
                // 超时保护：关流（任务由懒回收兜底判定）
                writeFrame(out, "{\"type\":\"error\",\"code\":\"stream_timeout\","
                        + "\"message\":\"等待超时，请稍后在任务列表查看结果\"}");
                writeFrame(out, "{\"type\":\"end\"}");
            } catch (Exception e) {
                // 客户端断开或 IO 异常：订阅已在 try-with-resources 中退订
            } finally {
                // 断连/超时兜底：worker 若已写终态快照则立即回填行状态，
                // 消除「已完成但显示 queued」的失真窗口（仍在跑时快照不存在，
                // 保持 queued 属正确状态，后续由懒回收兜底）
                try {
                    String snap = redis.opsForValue().get("agent:final:" + taskId);
                    if (snap != null) hydrateFinal(taskId, snap);
                } catch (Exception ignored) {
                    // 回填失败留给懒回收
                }
            }
        };
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("text/event-stream;charset=UTF-8"))
                .header("Cache-Control", "no-cache, no-transform")
                .body(stream);
    }

    // ── 任务读取（懒回收：终态快照回填 + 超时判失败，A5.6）───────────────────

    /** 列表/详情读取前的回收：1) worker 已写终态快照但无订阅者 → 回填；
     *  2) 长时间停留在 queued/running（worker 中途挂掉）→ 标记 failed（可重试）。 */
    private void sweepTasks(String workspaceId) {
        List<String> active = jdbc.query(
                "SELECT id FROM \"AgentTask\" WHERE \"workspaceId\" = ? AND status IN ('queued','running')",
                (rs, n) -> rs.getString(1), workspaceId);
        for (String id : active) {
            String snapshot;
            try {
                snapshot = redis.opsForValue().get("agent:final:" + id);
            } catch (Exception e) {
                snapshot = null;
            }
            if (snapshot != null) {
                hydrateFinal(id, snapshot);
            }
        }
        jdbc.update("UPDATE \"AgentTask\" SET status = 'failed', \"updatedAt\" = now() "
                        + "WHERE \"workspaceId\" = ? AND status IN ('queued','running') "
                        + "AND \"updatedAt\" < now() - (? || ' seconds')::interval",
                workspaceId, String.valueOf(taskTimeoutSeconds));
    }

    /** 用 agent:final:{taskId} 快照回填任务行（真实终态优先于超时误判）。 */
    private void hydrateFinal(String taskId, String snapshot) {
        try {
            JsonNode root = objectMapper.readTree(snapshot);
            if (root.path("ok").asBoolean()) {
                JsonNode task = root.path("task");
                jdbc.update("UPDATE \"AgentTask\" SET status = 'done', report = ?, "
                                + "outline = ?::jsonb, citations = ?::jsonb, steps = ?::jsonb, "
                                + "\"durationMs\" = ?, \"updatedAt\" = now() WHERE id = ? AND status IN ('queued','running')",
                        textOrNull(task, "report"), task.path("outline").toString(),
                        task.path("citations").toString(), task.path("steps").toString(),
                        task.path("durationMs").asInt(0), taskId);
            } else {
                markTaskStatus(taskId, "failed");
            }
        } catch (Exception e) {
            // 快照解析失败：留给超时清扫
        }
    }

    private void persistDone(String taskId, String doneFrame) {
        try {
            JsonNode task = objectMapper.readTree(doneFrame).path("task");
            jdbc.update("UPDATE \"AgentTask\" SET status = 'done', report = ?, "
                            + "outline = ?::jsonb, citations = ?::jsonb, steps = ?::jsonb, "
                            + "\"durationMs\" = ?, \"updatedAt\" = now() WHERE id = ?",
                    textOrNull(task, "report"), task.path("outline").toString(),
                    task.path("citations").toString(), task.path("steps").toString(),
                    task.path("durationMs").asInt(0), taskId);
        } catch (Exception e) {
            // done 落库失败：终态快照 + 懒回收兜底
        }
    }

    /** agent.completed webhook（数据形态与 TS handlers.ts 一致）。 */
    private void emitAgentCompleted(String workspaceId, String doneFrame) {
        try {
            JsonNode task = objectMapper.readTree(doneFrame).path("task");
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("taskId", task.path("id").asText());
            data.put("topic", task.path("topic").asText());
            if (!task.path("kbId").isNull() && !task.path("kbId").isMissingNode()) {
                data.put("kbId", task.path("kbId").asText());
            }
            if (!task.path("kbName").isNull() && !task.path("kbName").isMissingNode()) {
                data.put("kbName", task.path("kbName").asText());
            }
            data.put("status", task.path("status").asText("done"));
            data.put("outputFormat", task.path("outputFormat").asText("report"));
            data.put("durationMs", task.path("durationMs").asInt(0));
            webhooks.emit(workspaceId, WebhookService.AGENT_COMPLETED, data);
        } catch (Exception e) {
            // webhook 投递失败不影响主流程
        }
    }

    // ── 任务列表 / 详情 / 重试 / 分享 ────────────────────────────────────────

    @GetMapping("/api/agent/tasks")
    public ResponseEntity<Map<String, Object>> listTasks(
            Authentication authentication, @RequestParam(required = false) String kbId) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        sweepTasks(workspaceId);
        List<Map<String, Object>> tasks = jdbc.query(
                "SELECT id, topic, \"kbId\", \"kbName\", \"outputFormat\", status, \"workspaceId\", "
                        + "report, outline, citations, steps, \"durationMs\", \"shareConfig\", template, "
                        + "(EXTRACT(EPOCH FROM \"createdAt\") * 1000)::bigint, (EXTRACT(EPOCH FROM \"updatedAt\") * 1000)::bigint "
                        + "FROM \"AgentTask\" WHERE \"userId\" = ? AND \"workspaceId\" = ? "
                        + "ORDER BY \"createdAt\" DESC LIMIT 100",
                (rs, n) -> {
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("id", rs.getString(1));
                    t.put("topic", rs.getString(2));
                    t.put("kbId", rs.getString(3));
                    t.put("kbName", rs.getString(4));
                    t.put("outputFormat", rs.getString(5));
                    t.put("status", rs.getString(6));
                    t.put("workspaceId", rs.getString(7));
                    t.put("report", rs.getString(8));
                    t.put("outline", parseJsonArray(rs.getString(9)));
                    t.put("citations", parseJsonArray(rs.getString(10)));
                    t.put("steps", parseJsonArray(rs.getString(11)));
                    Number dur = (Number) rs.getObject(12);
                    t.put("durationMs", dur == null ? null : dur.intValue());
                    t.put("shareConfig", parseJsonObject(rs.getString(13)));
                    t.put("template", rs.getString(14));
                    t.put("createdAt", rs.getLong(15));
                    t.put("updatedAt", rs.getLong(16));
                    return t;
                },
                user.id(), workspaceId);
        if (kbId != null && !kbId.isBlank()) {
            tasks.removeIf(t -> !kbId.equals(t.get("kbId")));
        }
        return ResponseEntity.ok(Map.of("tasks", tasks));
    }

    @GetMapping("/api/agent/tasks/{taskId}")
    public ResponseEntity<Map<String, Object>> getTask(Authentication authentication,
                                                       @PathVariable String taskId) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        sweepTasks(workspaceId);
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT id, topic, \"kbId\", \"kbName\", \"outputFormat\", status, \"userId\", \"workspaceId\", "
                        + "report, outline, citations, steps, \"durationMs\", \"shareConfig\", template, "
                        + "(EXTRACT(EPOCH FROM \"createdAt\") * 1000)::bigint, (EXTRACT(EPOCH FROM \"updatedAt\") * 1000)::bigint "
                        + "FROM \"AgentTask\" WHERE id = ? AND \"workspaceId\" = ?",
                (rs, n) -> {
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("id", rs.getString(1));
                    t.put("topic", rs.getString(2));
                    t.put("kbId", rs.getString(3));
                    t.put("kbName", rs.getString(4));
                    t.put("outputFormat", rs.getString(5));
                    t.put("status", rs.getString(6));
                    t.put("userId", rs.getString(7));
                    t.put("workspaceId", rs.getString(8));
                    t.put("report", rs.getString(9));
                    t.put("outline", parseJsonArray(rs.getString(10)));
                    t.put("citations", parseJsonArray(rs.getString(11)));
                    t.put("steps", parseJsonArray(rs.getString(12)));
                    Number dur = (Number) rs.getObject(13);
                    t.put("durationMs", dur == null ? null : dur.intValue());
                    t.put("shareConfig", parseJsonObject(rs.getString(14)));
                    t.put("template", rs.getString(15));
                    t.put("createdAt", rs.getLong(16));
                    t.put("updatedAt", rs.getLong(17));
                    return t;
                },
                taskId, workspaceId);
        if (rows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "任务不存在"));
        }
        return ResponseEntity.ok(rows.get(0));
    }

    /** 失败任务重试（A5.6：失败/可重试）。 */
    @PostMapping("/api/agent/tasks/{taskId}/retry")
    public ResponseEntity<Map<String, Object>> retry(Authentication authentication,
                                                     @PathVariable String taskId) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        sweepTasks(workspaceId);
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT status, topic, \"kbId\", \"kbName\", \"outputFormat\", agents, \"maxSteps\", template "
                        + "FROM \"AgentTask\" WHERE id = ? AND \"workspaceId\" = ?",
                (rs, n) -> {
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("status", rs.getString(1));
                    t.put("topic", rs.getString(2));
                    t.put("kbId", rs.getString(3));
                    t.put("kbName", rs.getString(4));
                    t.put("outputFormat", rs.getString(5));
                    t.put("agents", rs.getString(6));
                    t.put("maxSteps", (Number) rs.getObject(7));
                    t.put("template", rs.getString(8));
                    return t;
                }, taskId, workspaceId);
        if (rows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "任务不存在"));
        }
        Map<String, Object> task = rows.get(0);
        if (!"failed".equals(task.get("status"))) {
            return ResponseEntity.status(400).body(Map.of("error", "仅失败任务可重试"));
        }
        if (!Boolean.TRUE.equals(redis.hasKey("agent:worker:heartbeat"))) {
            return ResponseEntity.status(503).body(Map.of("error", "AI worker 离线，请稍后重试"));
        }
        Map<String, Object> job = new LinkedHashMap<>();
        job.put("taskId", taskId);
        job.put("workspaceId", workspaceId);
        job.put("topic", task.get("topic"));
        if (task.get("kbId") != null) job.put("kbId", task.get("kbId"));
        if (task.get("kbName") != null) job.put("kbName", task.get("kbName"));
        job.put("outputFormat", task.get("outputFormat"));
        // 透传原任务的自定义 agent 角色选择（PG text[] ::text 渲染 {a,b}）
        String agentsStr = task.get("agents") == null ? "" : task.get("agents").toString();
        if (!agentsStr.isBlank()) {
            java.util.List<String> agents = new java.util.ArrayList<>();
            for (String s : agentsStr.replace("{", "").replace("}", "")
                    .replace("[", "").replace("]", "").replace("\"", "").split(",")) {
                if (!s.isBlank()) agents.add(s.trim());
            }
            if (!agents.isEmpty()) job.put("agents", agents);
        }
        job.put("maxSteps", task.get("maxSteps") == null ? 5 : ((Number) task.get("maxSteps")).intValue());
        job.put("template", task.get("template") == null ? "default" : task.get("template"));
        job.put("userId", user.id());
        job.put("createdAt", System.currentTimeMillis());
        jdbc.update("UPDATE \"AgentTask\" SET status = 'queued', \"updatedAt\" = now() WHERE id = ?", taskId);
        try {
            HttpResponse<String> res = ai.postInternal("/internal/agent/run", AiClient.toJson(job));
            if (res.statusCode() >= 300) {
                markTaskStatus(taskId, "failed");
                return ResponseEntity.status(503).body(Map.of("error", "重新入队失败，请稍后重试"));
            }
        } catch (Exception e) {
            markTaskStatus(taskId, "failed");
            return ResponseEntity.status(503).body(Map.of("error", "AI 服务不可用，请稍后重试"));
        }
        return ResponseEntity.ok(Map.of("ok", true, "taskId", taskId, "status", "queued"));
    }

    public record ShareRequest(Boolean enabled, Long expiresAt, String password, Integer maxViews) {
    }

    /** 分享配置（P2-3 语义：PUT 部分更新；密码存 SHA-256 hex，与现网 hashPassword 一致）。 */
    @PutMapping("/api/agent/tasks/{taskId}/share")
    public ResponseEntity<Map<String, Object>> setShare(Authentication authentication,
                                                        @PathVariable String taskId,
                                                        @RequestBody ShareRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        List<String> owned = jdbc.query(
                "SELECT \"shareConfig\"::text FROM \"AgentTask\" WHERE id = ? AND \"workspaceId\" = ?",
                (rs, n) -> rs.getString(1), taskId, workspaceId);
        if (owned.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "任务不存在"));
        }
        Map<String, Object> cfg;
        try {
            cfg = owned.get(0) == null
                    ? new LinkedHashMap<>()
                    : objectMapper.readValue(owned.get(0), Map.class);
        } catch (Exception e) {
            cfg = new LinkedHashMap<>();
        }
        if (body.enabled() != null) cfg.put("enabled", body.enabled());
        if (body.expiresAt() != null) cfg.put("expiresAt", body.expiresAt());
        else if (body.enabled() != null && body.expiresAt() == null) cfg.remove("expiresAt");
        if (body.maxViews() != null) cfg.put("maxViews", body.maxViews());
        if (body.password() != null && !body.password().isBlank()) {
            cfg.put("passwordHash", sha256Hex(body.password()));
        }
        cfg.putIfAbsent("views", 0);
        jdbc.update("UPDATE \"AgentTask\" SET \"shareConfig\" = ?::jsonb, \"updatedAt\" = now() WHERE id = ?",
                toJson(cfg), taskId);
        return ResponseEntity.ok(Map.of("shareConfig", cfg));
    }

    // ── 5.4 公开报告（匿名；shareConfig.enabled 才可读，缺省 403）─────────────

    @GetMapping("/api/share/report/{taskId}")
    public ResponseEntity<Map<String, Object>> publicReport(
            @PathVariable String taskId,
            @org.springframework.web.bind.annotation.RequestHeader(value = "x-share-password", required = false) String sharePwd) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT status, topic, report, citations, \"outputFormat\", \"durationMs\", "
                        + "\"shareConfig\"::text, comments, (EXTRACT(EPOCH FROM \"createdAt\") * 1000)::bigint "
                        + "FROM \"AgentTask\" WHERE id = ?",
                (rs, n) -> {
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("status", rs.getString(1));
                    t.put("topic", rs.getString(2));
                    t.put("report", rs.getString(3));
                    t.put("citations", rs.getString(4));
                    t.put("outputFormat", rs.getString(5));
                    Number dur = (Number) rs.getObject(6);
                    t.put("durationMs", dur == null ? null : dur.intValue());
                    t.put("shareConfig", rs.getString(7));
                    t.put("comments", rs.getString(8));
                    t.put("createdAt", rs.getLong(9));
                    return t;
                }, taskId);
        if (rows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "报告不存在"));
        }
        Map<String, Object> task = rows.get(0);
        if (!"done".equals(task.get("status"))) {
            return ResponseEntity.status(400).body(Map.of("error", "报告尚未完成"));
        }
        Map<String, Object> cfg = parseJsonObject((String) task.get("shareConfig"));
        if (!Boolean.TRUE.equals(cfg.get("enabled"))) {
            return ResponseEntity.status(403).body(Map.of("error", "分享链接已关闭", "code", "disabled"));
        }
        Object expiresAt = cfg.get("expiresAt");
        if (expiresAt instanceof Number n && System.currentTimeMillis() > n.longValue()) {
            return ResponseEntity.status(410).body(Map.of("error", "分享链接已过期", "code", "expired"));
        }
        Object passwordHash = cfg.get("passwordHash");
        if (passwordHash != null) {
            // 与现网一致：密码只走 x-share-password 头（避免进访问日志/历史记录）
            String pwd = sharePwd == null ? "" : sharePwd;
            if (!sha256Hex(pwd).equals(passwordHash)) {
                return ResponseEntity.status(401).body(Map.of("error", "需要访问密码", "code", "needPassword"));
            }
        }
        Object maxViews = cfg.get("maxViews");
        Number viewsNum = cfg.get("views") instanceof Number v ? v : 0;
        if (maxViews instanceof Number mv && mv.intValue() > 0 && viewsNum.intValue() >= mv.intValue()) {
            return ResponseEntity.status(403).body(Map.of("error", "访问次数已用尽", "code", "exhausted"));
        }
        jdbc.update("UPDATE \"AgentTask\" SET \"shareConfig\" = jsonb_set("
                + "COALESCE(\"shareConfig\", '{}'::jsonb), '{views}', to_jsonb(?::int), true), "
                + "\"updatedAt\" = now() WHERE id = ?", viewsNum.intValue() + 1, taskId);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("topic", task.get("topic"));
        res.put("report", task.get("report"));
        res.put("citations", parseJsonArray((String) task.get("citations")));
        res.put("comments", parseJsonArray((String) task.get("comments")));
        res.put("outputFormat", task.get("outputFormat"));
        res.put("durationMs", task.get("durationMs"));
        res.put("createdAt", task.get("createdAt"));
        res.put("protected", true);
        res.put("views", viewsNum.intValue() + 1);
        return ResponseEntity.ok(res);
    }

    // ── 工具 ────────────────────────────────────────────────────────────────

    private void writeFrame(java.io.OutputStream out, String json) throws IOException {
        out.write(("data: " + json + "\n\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private void markTaskStatus(String taskId, String status) {
        try {
            jdbc.update("UPDATE \"AgentTask\" SET status = ?, \"updatedAt\" = now() WHERE id = ?",
                    status, taskId);
        } catch (Exception ignored) {
            // 状态回写失败：懒回收兜底
        }
    }

    private String frameType(String frame) {
        try {
            return objectMapper.readTree(frame).path("type").asText("");
        } catch (Exception e) {
            return "";
        }
    }

    private static String textOrNull(JsonNode node, String field) {
        return node.has(field) && !node.path(field).isNull() ? node.path(field).asText() : null;
    }

    private static ResponseEntity<StreamingResponseBody> jsonError(int status, String body) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(out -> out.write(body.getBytes(StandardCharsets.UTF_8)));
    }

    private Object parseJsonArray(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, List.class);
        } catch (Exception e) {
            return List.of();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJsonObject(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static String toJson(Map<String, Object> map) {
        try {
            return new ObjectMapper().writeValueAsString(map);
        } catch (Exception e) {
            return "{}";
        }
    }

    private static String toJsonArray(List<String> items) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(items.get(i).replace("\"", "\\\"")).append('"');
        }
        return sb.append(']').toString();
    }

    private static String sha256Hex(String input) {
        try {
            byte[] hash = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}
