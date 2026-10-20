package dev.knowledgeai.business.audit;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 审计与登录历史（手册 4.1）：LoginEvent（登录成功/失败）与 SecurityAudit
 * （P3-4：HMAC-SHA256 hash 链 —— hash = HMAC(AUTH_SECRET, prevHash|actor|
 * action|detail|createdAt)，防篡改；对齐 src/lib/security/audit.ts）。
 */
@Service
@Profile("pg")
public class AuditService {

    private final JdbcTemplate jdbc;
    private final byte[] secret;

    public AuditService(JdbcTemplate jdbc,
                        @Value("${auth.secret}") String secret) {
        this.jdbc = jdbc;
        this.secret = dev.knowledgeai.business.auth.AuthSecret.require(secret, "AuditService");
    }

    /** 登录事件（对齐现网 recordLogin）。 */
    public void recordLogin(String userId, String device, String ip, boolean success) {
        jdbc.update("INSERT INTO \"LoginEvent\" (id, \"userId\", device, ip, success, \"createdAt\") "
                        + "VALUES (?, ?, ?, ?, ?, now())",
                "evt_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                userId, device, ip, success);
    }

    /** 安全审计（hash 链）。 */
    public void recordAudit(String actorId, String actor, String action, String target, String detail, String ip) {
        String prevHash = jdbc.query(
                "SELECT hash FROM \"SecurityAudit\" ORDER BY \"createdAt\" DESC LIMIT 1",
                (rs, n) -> rs.getString(1), new Object[] {}).stream().findFirst().orElse("GENESIS");
        String createdAt = Instant.now().toString();
        String hash = hmac(prevHash + "|" + actor + "|" + action + "|" + detail + "|" + createdAt);
        jdbc.update("INSERT INTO \"SecurityAudit\" (id, \"actorId\", actor, action, target, detail, ip, \"prevHash\", hash, \"createdAt\") "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())",
                "aud_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                actorId, actor == null ? "" : actor, action, target == null ? "" : target,
                detail == null ? "" : detail, ip, prevHash, hash);
    }

    /** 审计查询（GET /api/admin/audit，OWNER/ADMIN 由 SecurityConfig 角色外控制）。 */
    public java.util.List<Map<String, Object>> list(String action, int limit) {
        StringBuilder sql = new StringBuilder(
                "SELECT id, actor, action, target, detail, ip, hash, \"createdAt\" FROM \"SecurityAudit\"");
        Object[] args = new Object[0];
        if (action != null && !action.isBlank()) {
            sql.append(" WHERE action = ?");
            args = new Object[]{action};
        }
        sql.append(" ORDER BY \"createdAt\" DESC LIMIT ?");
        Object[] finalArgs = new Object[args.length + 1];
        System.arraycopy(args, 0, finalArgs, 0, args.length);
        finalArgs[args.length] = Math.min(Math.max(limit, 1), 200);
        return jdbc.query(sql.toString(), (rs, n) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getString("id"));
            row.put("actor", rs.getString("actor"));
            row.put("action", rs.getString("action"));
            row.put("detail", rs.getString("detail"));
            row.put("ip", rs.getString("ip"));
            row.put("createdAt", rs.getString("createdAt"));
            return row;
        }, finalArgs);
    }

    private String hmac(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] digest = mac.doFinal(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("audit hmac failed", e);
        }
    }
}
