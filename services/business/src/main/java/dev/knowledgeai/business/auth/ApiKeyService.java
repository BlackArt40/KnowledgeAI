package dev.knowledgeai.business.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

/**
 * API Key 认证（手册 4.1/4.4，对齐现网 apikeys/store.ts validateApiKey +
 * crypto.ts）：`kai_sk_` 明文 → 查 ApiKey 表（active）→ keyHash 列
 * （AES-256-GCM 密文或 legacy 明文）解密 → 恒时比对 → scopes 矩阵
 * （kb:read/kb:write/chat:read/agent:run/team:read/webhooks:write）。
 * 加密键派生：HKDF-SHA256(AUTH_SECRET, salt="knowledgeai",
 * info="encryption-key", 32B)（与现网 crypto.ts 逐字节对齐）。
 */
@Service
@Profile("pg")
public class ApiKeyService {

    private static final byte[] HKDF_SALT = "knowledgeai".getBytes(StandardCharsets.UTF_8);
    private static final byte[] HKDF_INFO = "encryption-key".getBytes(StandardCharsets.UTF_8);

    private final JdbcTemplate jdbc;
    private final byte[] authSecret;

    public record ApiKeyRow(String id, String userId, String scopes, String status,
                            String secretPlain, Long expiresAt) {
    }

    public ApiKeyService(JdbcTemplate jdbc,
                         @Value("${auth.secret}") String authSecret) {
        this.jdbc = jdbc;
        this.authSecret = AuthSecret.require(authSecret, "ApiKeyService");
    }

    /** 校验 kai_sk_ 明文 secret → 返回（keyId, userId, scopes）或 empty。 */
    public Optional<ApiKeyRow> validate(String secret) {
        if (secret == null || !secret.startsWith("kai_sk_") || secret.length() < 10) return Optional.empty();
        List<ApiKeyRow> rows = jdbc.query(
                "SELECT id, \"userId\", scopes::text, status, \"keyHash\", \"expiresAt\" "
                        + "FROM \"ApiKey\" WHERE status = 'active'",
                (rs, n) -> new ApiKeyRow(
                        rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5),
                        rs.getTimestamp(6) == null ? null : rs.getTimestamp(6).getTime()));
        for (ApiKeyRow row : rows) {
            // P2: expired keys are rejected even if the secret is correct.
            if (row.expiresAt() != null && row.expiresAt() <= System.currentTimeMillis()) continue;

            String stored = row.secretPlain();
            if (stored == null) continue;
            // P2: new keys store `sha256$<hex>` (one-way).
            if (stored.startsWith("sha256$")) {
                if (constantTimeEquals(stored, "sha256$" + sha256Hex(secret))) return Optional.of(row);
                continue;
            }
            // Legacy: keyHash = encryptToString(secret)（JSON {iv,data,tag}）或明文。
            // 快速淘汰（评审 #6）：AES-GCM 密文长度是明文长度的确定性函数（随机 IV
            // 只影响内容不改变长度），长度不符直接跳过——避免每请求 O(活跃键数) 次
            // AES-GCM 解密；密文长度本身公开，不泄漏信息。
            if (stored.length() != expectedStoredLength(secret)
                    && !constantTimeEquals(stored, secret)) {
                continue;
            }
            String plain = decryptStored(stored);
            if (plain.isEmpty()) continue;
            if (constantTimeEquals(plain, secret)) return Optional.of(row);
        }
        return Optional.empty();
    }

    /** encryptToString 产物的确定性长度：JSON 骨架 52 字符 + iv(16B→24 b64)
     *  + tag(16B→24 b64) + data(明文 n 字节 → 4*ceil(n/3) b64)。 */
    static int expectedStoredLength(String plain) {
        return 76 + 4 * ((plain.length() + 2) / 3);
    }

    /** SHA-256 hex (lowercase), matching Node's crypto.createHash("sha256"). */
    static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) sb.append(String.format("%02x", b & 0xff));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** scope 判定（对齐现网 apikeys/scopes.ts 的 scope 矩阵）。
     *  PG `text[]::text` 渲染为 {a,b}，需剥花括号与引号后逐项比对。 */
    public static boolean hasScope(ApiKeyRow key, String required) {
        if (key.scopes() == null) return false;
        for (String s : key.scopes()
                .replace("{", "").replace("}", "")
                .replace("[", "").replace("]", "")
                .replace("\"", "").split(",")) {
            if (required.equals(s.trim())) return true;
        }
        return false;
    }

    /**
     * scope 守卫（KB 端点用）：JWT 用户恒放行；API Key 必须携带所需 scope，
     * 否则返回拒绝消息文本（null = 放行；调用方包装为 JSON）。
     */
    public static String scopeDenied(Authentication authentication, String scope) {
        if (authentication == null) return "未登录";
        Object credentials = authentication.getCredentials();
        if (credentials instanceof ApiKeyRow key) {
            return hasScope(key, scope) ? null : "API Key 缺少所需 scope: " + scope;
        }
        return null; // JWT 用户：角色守卫另行走 ROLE_ 语义
    }

    /** 解密现网 encryptToString 格式（JSON {iv,data,tag}，base64 各段）；
     *  legacy 明文原样返回。解密失败 → ""（视为无效，对齐现网 storedSecretOf）。 */
    String decryptStored(String stored) {
        String trimmed = stored == null ? "" : stored.trim();
        if (!trimmed.startsWith("{")) return trimmed; // legacy 明文
        try {
            String iv = extractField(trimmed, "iv");
            String data = extractField(trimmed, "data");
            String tag = extractField(trimmed, "tag");
            if (iv == null || data == null || tag == null) return "";
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] ivBytes = Base64.getDecoder().decode(iv);
            byte[] dataBytes = Base64.getDecoder().decode(data);
            byte[] tagBytes = Base64.getDecoder().decode(tag);
            // JDK GCM 语义：tag 必须附在密文尾部（TS 的 tag 是独立段）
            byte[] combined = new byte[dataBytes.length + tagBytes.length];
            System.arraycopy(dataBytes, 0, combined, 0, dataBytes.length);
            System.arraycopy(tagBytes, 0, combined, dataBytes.length, tagBytes.length);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(hkdf(), "AES"),
                    new GCMParameterSpec(128, ivBytes));
            byte[] plain = cipher.doFinal(combined);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private byte[] hkdf() {
        try {
            // Extract: PRK = HMAC-SHA256(salt, IKM)
            Mac hmac = Mac.getInstance("HmacSHA256");
            hmac.init(new SecretKeySpec(HKDF_SALT, "HmacSHA256"));
            byte[] prk = hmac.doFinal(authSecret);
            // Expand: OKM = HMAC-SHA256(PRK, info || 0x01)（L=32 单块）
            hmac = Mac.getInstance("HmacSHA256");
            hmac.init(new SecretKeySpec(prk, "HmacSHA256"));
            byte[] block = new byte[HKDF_INFO.length + 1];
            System.arraycopy(HKDF_INFO, 0, block, 0, HKDF_INFO.length);
            block[HKDF_INFO.length] = 0x01;
            return hmac.doFinal(block);
        } catch (Exception e) {
            throw new IllegalStateException("HKDF derivation failed", e);
        }
    }

    private static String extractField(String json, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private static boolean constantTimeEquals(String a, String b) {
        byte[] ba = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        if (ba.length != bb.length) return false;
        int diff = 0;
        for (int i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
        return diff == 0;
    }
}
