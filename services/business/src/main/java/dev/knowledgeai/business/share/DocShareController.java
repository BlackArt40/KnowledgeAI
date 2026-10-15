package dev.knowledgeai.business.share;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.knowledgeai.business.auth.ApiKeyService;
import dev.knowledgeai.business.auth.KaiJwtService;
import dev.knowledgeai.business.auth.Pbkdf2PasswordService;
import dev.knowledgeai.business.auth.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 文档分享链接（手册 4.2，P4-2 语义迁移，对齐 src/lib/kb/doc-share.ts）：
 *   POST   /api/v1/knowledge-bases/{kbId}/documents/{docId}/share   创建/替换（一文档一链接）
 *   DELETE 同上                                                       撤销
 *   GET    /api/share/doc/{token}?password=                          公开访问（token 即凭证）
 *   （公开端点在 SecurityConfig 匿名清单中）
 * 状态存 Redis（跨实例；TTL = 过期时间 + 1 天）。密码哈希沿用现网
 * `pbkdf2$<iters>$<salt>$<hash>` 格式（Pbkdf2PasswordService.verify 直接兼容）。
 * 访问语义对齐 checkDocShare：410 撤销/过期、401 需密码、403 密码错、429 次数耗尽。
 */
@RestController
@Profile("pg")
public class DocShareController {

    private static final String KEY_PREFIX = "share:doc:";

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Pbkdf2PasswordService passwords;

    public DocShareController(JdbcTemplate jdbc, UserRepository users, StringRedisTemplate redis,
                              ObjectMapper objectMapper, Pbkdf2PasswordService passwords) {
        this.jdbc = jdbc;
        this.users = users;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.passwords = passwords;
    }

    public record CreateShareRequest(Integer expiryDays, String password, Integer maxViews) {
    }

    @PostMapping("/api/v1/knowledge-bases/{kbId}/documents/{docId}/share")
    public ResponseEntity<Map<String, Object>> create(Authentication authentication,
                                                      @PathVariable String kbId, @PathVariable String docId,
                                                      @RequestBody CreateShareRequest body) {
        // G2 评审修复：写类 /api/v1 路由必须校验 scope——API Key principal 角色硬编码
        // EDITOR，无此守卫时任意 scope 的 key 可创建分享链接（含设置访问密码）
        String scopeDenial = ApiKeyService.scopeDenied(authentication, "kb:write");
        if (scopeDenial != null) {
            return ResponseEntity.status(403).body(Map.of("error", scopeDenial));
        }
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (!List.of("OWNER", "ADMIN", "EDITOR").contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "无编辑权限"));
        }
        String workspaceId = users.findWorkspaceIdByUserId(user.id());
        List<String> docs = jdbc.query(
                "SELECT d.name FROM \"KbDocument\" d JOIN \"KnowledgeBase\" k ON d.\"kbId\" = k.id "
                        + "WHERE d.id = ? AND d.\"kbId\" = ? AND k.\"workspaceId\" = ?",
                (rs, n) -> rs.getString(1), docId, kbId, workspaceId);
        if (docs.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "文档不存在"));
        }
        // 一文档一链接：先删旧 token
        String oldToken = redisGet("share:index:doc:" + docId);
        if (oldToken != null) redis.delete(KEY_PREFIX + oldToken);

        String token = "docshare_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        Map<String, Object> share = new LinkedHashMap<>();
        share.put("docId", docId);
        share.put("kbId", kbId);
        share.put("docName", docs.get(0));
        share.put("createdBy", user.id());
        int expiryDays = body == null || body.expiryDays() == null ? 7 : Math.min(body.expiryDays(), 90);
        share.put("expiresAt", Instant.now().plusSeconds(expiryDays * 86400L).toString());
        share.put("maxViews", body == null || body.maxViews() == null ? 0 : body.maxViews());
        share.put("views", 0);
        share.put("revoked", false);
        String pwd = body == null ? null : body.password();
        if (pwd != null && !pwd.isBlank()) {
            share.put("passwordHash", passwords.hash(pwd));
        }
        try {
            redis.opsForValue().set(KEY_PREFIX + token, objectMapper.writeValueAsString(share),
                    Duration.ofDays(expiryDays + 1));
            redis.opsForValue().set("share:index:doc:" + docId, token, Duration.ofDays(expiryDays + 1));
        } catch (Exception e) {
            return ResponseEntity.status(503).body(Map.of("error", "存储不可用，请稍后重试"));
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("token", token);
        res.put("expiresAt", share.get("expiresAt"));
        res.put("requiresPassword", share.containsKey("passwordHash"));
        return ResponseEntity.status(201).body(res);
    }

    @DeleteMapping("/api/v1/knowledge-bases/{kbId}/documents/{docId}/share")
    public ResponseEntity<Map<String, Object>> revoke(Authentication authentication,
                                                      @PathVariable String kbId, @PathVariable String docId) {
        String scopeDenial = ApiKeyService.scopeDenied(authentication, "kb:write");
        if (scopeDenial != null) {
            return ResponseEntity.status(403).body(Map.of("error", scopeDenial));
        }
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (!List.of("OWNER", "ADMIN", "EDITOR").contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "无编辑权限"));
        }
        String token = redisGet("share:index:doc:" + docId);
        if (token != null) {
            try {
                String raw = redis.opsForValue().get(KEY_PREFIX + token);
                if (raw != null) {
                    Map<String, Object> share = objectMapper.readValue(raw, Map.class);
                    share.put("revoked", true);
                    redis.opsForValue().set(KEY_PREFIX + token, objectMapper.writeValueAsString(share),
                            Duration.ofDays(1));
                }
            } catch (Exception ignored) {
                // 撤销写失败按未撤销处理（下轮创建会替换）
            }
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    /** 公开访问（匿名）。返回文档内容（对齐现网 checkDocShare 语义码）。 */
    @GetMapping("/api/share/doc/{token}")
    public ResponseEntity<Map<String, Object>> access(@PathVariable String token,
                                                      @org.springframework.web.bind.annotation.RequestParam(required = false) String password) {
        String raw = redisGet(KEY_PREFIX + token);
        if (raw == null) {
            return ResponseEntity.status(410).body(Map.of("code", "expired", "error", "链接不存在或已过期"));
        }
        Map<String, Object> share;
        try {
            share = objectMapper.readValue(raw, Map.class);
        } catch (Exception e) {
            return ResponseEntity.status(410).body(Map.of("code", "expired", "error", "链接已失效"));
        }
        if (Boolean.TRUE.equals(share.get("revoked"))) {
            return ResponseEntity.status(410).body(Map.of("code", "revoked", "error", "链接已被撤销"));
        }
        if (share.get("expiresAt") != null
                && Instant.parse(share.get("expiresAt").toString()).isBefore(Instant.now())) {
            return ResponseEntity.status(410).body(Map.of("code", "expired", "error", "链接已过期"));
        }
        int views = share.get("views") == null ? 0 : ((Number) share.get("views")).intValue();
        int maxViews = share.get("maxViews") == null ? 0 : ((Number) share.get("maxViews")).intValue();
        if (maxViews > 0 && views >= maxViews) {
            return ResponseEntity.status(429).body(Map.of("code", "maxViews", "error", "访问次数已达上限"));
        }
        String passwordHash = (String) share.get("passwordHash");
        if (passwordHash != null) {
            if (password == null || password.isBlank()) {
                return ResponseEntity.status(401).body(Map.of("code", "password_required", "error", "该链接需要访问密码"));
            }
            if (!passwords.verify(password, passwordHash)) {
                return ResponseEntity.status(403).body(Map.of("code", "wrong_password", "error", "访问密码不正确"));
            }
        }
        // 次数 +1
        share.put("views", views + 1);
        try {
            redis.opsForValue().set(KEY_PREFIX + token, objectMapper.writeValueAsString(share), Duration.ofDays(1));
        } catch (Exception ignored) {
            // 计数失败不阻断访问
        }
        String content = jdbc.query(
                "SELECT content FROM \"KbDocument\" WHERE id = ?",
                (rs, n) -> rs.getString(1), share.get("docId")).stream().findFirst().orElse("");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("docName", share.get("docName"));
        res.put("content", content);
        res.put("views", views + 1);
        return ResponseEntity.ok(res);
    }

    private String redisGet(String key) {
        try {
            return redis.opsForValue().get(key);
        } catch (Exception e) {
            return null;
        }
    }
}
