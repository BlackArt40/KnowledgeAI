package dev.knowledgeai.business.kb;

import dev.knowledgeai.business.ai.AiClient;
import dev.knowledgeai.business.auth.ApiKeyService;
import dev.knowledgeai.business.auth.KaiJwtService;
import dev.knowledgeai.business.auth.UserRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.RestController;

/**
 * KB 元数据写路径（手册 4.3）+ 文档状态机（uploaded → ready/failed）+ Python
 * 索引调用（4.8）。租户与 RBAC（4.2）：读 = workspace 成员；写/删 =
 * OWNER/ADMIN/EDITOR 且 workspace 匹配（对齐现网 canEditKb / canEditDoc）。
 * 文档状态机（M2 简化）：text 文档 inline content → 同步调 Python
 * /internal/index → ready（chunks 回写）或 failed；binary/异步入队归 M3。
 */
@RestController
@Profile("pg")
public class KbWriteController {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(KbWriteController.class);

    private static final List<String> EDIT_ROLES = List.of("OWNER", "ADMIN", "EDITOR");

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final AiClient ai;
    private final dev.knowledgeai.business.agent.WebhookService webhooks;

    public KbWriteController(JdbcTemplate jdbc, UserRepository users, AiClient ai,
                             dev.knowledgeai.business.agent.WebhookService webhooks) {
        this.jdbc = jdbc;
        this.users = users;
        this.ai = ai;
        this.webhooks = webhooks;
    }

    public record CreateKbRequest(String name, String desc) {
    }

    public record CreateDocRequest(String name, String content) {
    }

    @PostMapping("/api/v1/knowledge-bases")
    public ResponseEntity<Map<String, Object>> createKb(Authentication authentication,
                                                        @RequestBody CreateKbRequest body) {
        String scopeDenial = ApiKeyService.scopeDenied(authentication, "kb:write");
        if (scopeDenial != null) {
            return ResponseEntity.status(403).body(Map.of("error", scopeDenial));
        }
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (body == null || body.name() == null || body.name().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "知识库名称不能为空"));
        }
        if (!EDIT_ROLES.contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "无创建权限"));
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        String id = "kb_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.update(
                "INSERT INTO \"KnowledgeBase\" (id, name, description, \"desc\", color, \"initial\", \"ownerId\", \"workspaceId\", settings, \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, now(), now())",
                id, body.name().trim(), body.desc() == null ? "" : body.desc(),
                body.desc() == null ? "" : body.desc(),
                "from-primary/15", body.name().trim().substring(0, 1).toUpperCase(),
                user.id(), workspaceId, "{}");
        return ResponseEntity.status(201).body(Map.of("kb", Map.of(
                "id", id, "name", body.name().trim(), "workspaceId", workspaceId, "ownerId", user.id())));
    }

    @GetMapping("/api/v1/knowledge-bases/{kbId}/documents")
    public ResponseEntity<Map<String, Object>> listDocuments(Authentication authentication, @PathVariable String kbId) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        List<Map<String, Object>> docs = jdbc.query(
                "SELECT d.id, d.name, d.status, d.progress, d.chunks, d.\"error\" "
                        + "FROM \"KbDocument\" d JOIN \"KnowledgeBase\" k ON d.\"kbId\" = k.id "
                        + "WHERE d.\"kbId\" = ? AND k.\"workspaceId\" = ? ORDER BY d.\"uploadedAt\" DESC",
                (rs, n) -> Map.<String, Object>of(
                        "id", rs.getString("id"), "name", rs.getString("name"),
                        "status", rs.getString("status"), "chunks", rs.getInt("chunks")),
                kbId, workspaceId);
        return ResponseEntity.ok(Map.of("documents", docs));
    }

    @PostMapping("/api/v1/knowledge-bases/{kbId}/documents")
    public ResponseEntity<Map<String, Object>> createDocument(Authentication authentication,
                                                              @PathVariable String kbId,
                                                              @RequestBody CreateDocRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (body == null || body.name() == null || body.name().isBlank()
                || body.content() == null || body.content().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "name 与 content 必填"));
        }
        if (!EDIT_ROLES.contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "无编辑权限"));
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        List<Map<String, Object>> kbRows = jdbc.query(
                "SELECT id FROM \"KnowledgeBase\" WHERE id = ? AND \"workspaceId\" = ?",
                (rs, n) -> Map.<String, Object>of("id", rs.getString(1)), kbId, workspaceId);
        if (kbRows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "知识库不存在"));
        }

        // 状态机：queued →（调 Python）→ ready / failed（手册 4.3）
        String docId = "doc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.update(
                "INSERT INTO \"KbDocument\" (id, \"kbId\", name, size, type, status, progress, content, \"uploadedAt\", \"updatedAt\") "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), now())",
                docId, kbId, body.name().trim(), body.content().length(), "text", "queued", 10,
                body.content());
        try {
            AiClient.IndexResult result = ai.index(workspaceId, kbId, docId,
                    body.name().trim(), "text/plain", body.content(), 500, 50);
            if (result.ok()) {
                jdbc.update("UPDATE \"KbDocument\" SET status = ?, progress = ?, chunks = ? WHERE id = ?",
                        "ready", 100, result.chunks(), docId);
                // A5.5：文档索引完成后向订阅方投递 kb.ready webhook
                fireKbReady(workspaceId, kbId, docId, body.name().trim(), result.chunks());
                return ResponseEntity.status(201).body(Map.of(
                        "doc", Map.of("id", docId, "status", "ready", "chunks", result.chunks())));
            }
            // KbDocument 无 error 列（Prisma 模型如此）——失败原因记日志，状态=failed
            log.error("document index failed: docId={} code={} message={}", docId, result.code(), result.message());
            jdbc.update("UPDATE \"KbDocument\" SET status = ? WHERE id = ?", "failed", docId);
            return ResponseEntity.status(201).body(Map.of(
                    "doc", Map.of("id", docId, "status", "failed", "error",
                            result.message() == null ? "AI 服务索引失败" : result.message())));
        } catch (Exception e) {
            // Python 不可用 → failed（可重试语义由调用方重传触发；不静默回退）
            log.error("document index error: docId={}", docId, e);
            jdbc.update("UPDATE \"KbDocument\" SET status = ? WHERE id = ?", "failed", docId);
            return ResponseEntity.status(503).body(Map.of(
                    "error", "AI 服务暂时不可用，请稍后重试", "docId", docId));
        }
    }

    @DeleteMapping("/api/v1/knowledge-bases/{kbId}/documents/{docId}")
    public ResponseEntity<Map<String, Object>> deleteDocument(Authentication authentication,
                                                              @PathVariable String kbId,
                                                              @PathVariable String docId) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (!EDIT_ROLES.contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "无编辑权限"));
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        int updated = jdbc.update(
                "DELETE FROM \"KbDocument\" d USING \"KnowledgeBase\" k "
                        + "WHERE d.\"kbId\" = k.id AND d.id = ? AND d.\"kbId\" = ? AND k.\"workspaceId\" = ?",
                docId, kbId, workspaceId);
        if (updated == 0) {
            return ResponseEntity.status(404).body(Map.of("error", "文档不存在"));
        }
        // 手册 4.8 + 阶段 3：远端索引清理（workspaceId 随载荷，Python 侧强制过滤）
        try {
            ai.clearIndex(workspaceId, kbId, docId);
        } catch (Exception ignored) {
            // 清理失败不阻断删除响应；远端残留由运维巡检（M3 引入队列重试）
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    /** docId 生成器可见性（测试）。 */
    static String newDocId() {
        return "doc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    // ── 异步 binary 状态机（手册 4.3 迭代项）────────────────────────────────
    // POST /documents/binary：base64 上传 → 202 立即返回（queued）→ 后台线程调
    // Python /internal/index（source.type=binary，服务端按 mime 解析 pdf/docx/xlsx）
    // → ready/failed 回写。文档名重复检查 + 状态回写与现网 upload 语义对齐。

    private final java.util.concurrent.ExecutorService indexExecutor =
            java.util.concurrent.Executors.newFixedThreadPool(2, r -> {
                Thread t = new Thread(r, "kb-index-async");
                t.setDaemon(true);
                return t;
            });

    public record CreateBinaryDocRequest(String name, String mime, String contentB64) {
    }

    @PostMapping("/api/v1/knowledge-bases/{kbId}/documents/binary")
    public ResponseEntity<Map<String, Object>> createBinaryDocument(Authentication authentication,
                                                                    @PathVariable String kbId,
                                                                    @RequestBody CreateBinaryDocRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (body == null || body.name() == null || body.name().isBlank()
                || body.contentB64() == null || body.mime() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "name/mime/contentB64 必填"));
        }
        if (!EDIT_ROLES.contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "无编辑权限"));
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        List<String> kbOk = jdbc.query(
                "SELECT id FROM \"KnowledgeBase\" WHERE id = ? AND \"workspaceId\" = ?",
                (rs, n) -> rs.getString(1), kbId, workspaceId);
        if (kbOk.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "知识库不存在"));
        }
        byte[] bytes;
        try {
            bytes = java.util.Base64.getMimeDecoder().decode(body.contentB64());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "contentB64 不是合法 base64"));
        }
        String docId = "doc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.update(
                "INSERT INTO \"KbDocument\" (id, \"kbId\", name, size, type, status, progress, url, \"uploadedAt\", \"updatedAt\") "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), now())",
                docId, kbId, body.name().trim(), bytes.length, body.mime(), "processing", 10, "inline:binary");
        byte[] payload = bytes;
        String mime = body.mime();
        String name = body.name().trim();
        String ws = workspaceId;
        indexExecutor.submit(() -> {
            try {
                AiClient.IndexResult result = ai.indexBinary(ws, kbId, docId, name, mime, payload, 500, 50);
                if (result.ok()) {
                    jdbc.update("UPDATE \"KbDocument\" SET status = ?, progress = ?, chunks = ?, \"updatedAt\" = now() WHERE id = ?",
                            "ready", 100, result.chunks(), docId);
                    // A5.5：文档索引完成后向订阅方投递 kb.ready webhook
                    fireKbReady(ws, kbId, docId, name, result.chunks());
                } else {
                    log.error("async index failed: docId={} message={}", docId, result.message());
                    jdbc.update("UPDATE \"KbDocument\" SET status = ?, \"updatedAt\" = now() WHERE id = ?",
                            "failed", docId);
                }
            } catch (Exception e) {
                log.error("async index error: docId={}", docId, e);
                jdbc.update("UPDATE \"KbDocument\" SET status = ?, \"updatedAt\" = now() WHERE id = ?",
                        "failed", docId);
            }
        });
        return ResponseEntity.status(202).body(Map.of(
                "doc", Map.of("id", docId, "status", "processing")));
    }

    /** kb.ready webhook（数据形态与 TS kb/store.ts 一致）。 */
    private void fireKbReady(String workspaceId, String kbId, String docId, String docName, int chunks) {
        try {
            List<String> kbNames = jdbc.query(
                    "SELECT name FROM \"KnowledgeBase\" WHERE id = ?", (rs, n) -> rs.getString(1), kbId);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("kbId", kbId);
            data.put("kbName", kbNames.isEmpty() ? "" : kbNames.get(0));
            data.put("docId", docId);
            data.put("docName", docName);
            data.put("chunks", chunks);
            data.put("status", "ready");
            webhooks.emit(workspaceId, dev.knowledgeai.business.agent.WebhookService.KB_READY, data);
        } catch (Exception e) {
            log.error("kb.ready webhook emit failed: {}", e.getMessage());
        }
    }

    /** 文档状态查询（异步轮询用）。 */
    @GetMapping("/api/v1/knowledge-bases/{kbId}/documents/{docId}/status")
    public ResponseEntity<Map<String, Object>> docStatus(Authentication authentication,
                                                         @PathVariable String kbId, @PathVariable String docId) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT d.status, d.progress, d.chunks FROM \"KbDocument\" d "
                        + "JOIN \"KnowledgeBase\" k ON d.\"kbId\" = k.id "
                        + "WHERE d.id = ? AND d.\"kbId\" = ? AND k.\"workspaceId\" = ?",
                (rs, n) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("status", rs.getString(1));
                    m.put("progress", rs.getInt(2));
                    m.put("chunks", rs.getInt(3));
                    return m;
                }, docId, kbId, workspaceId);
        if (rows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "文档不存在"));
        }
        return ResponseEntity.ok(rows.get(0));
    }
}
