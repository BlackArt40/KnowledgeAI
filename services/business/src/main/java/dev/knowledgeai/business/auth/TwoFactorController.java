package dev.knowledgeai.business.auth;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 2FA 绑定/解绑（手册 4.1，对齐现网 /api/auth/2fa/*）：
 *   POST /api/auth/2fa/setup   生成 base32 secret + otpauth URI（暂存 Redis pending）
 *   POST /api/auth/2fa/enable  验证码确认 → 写 Redis 2fa:secret + User.twoFactorEnabled=true
 *   POST /api/auth/2fa/disable 关闭（清 secret + 标志）
 * setup 与 enable 之间 secret 暂存 `2fa:pending:{userId}`（10 分钟），确认后才生效——
 * 避免未验证的 secret 直接启用。
 */
@RestController
@Profile("pg")
public class TwoFactorController {

    private static final String B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final TotpService totp;

    public TwoFactorController(JdbcTemplate jdbc, StringRedisTemplate redis, TotpService totp) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.totp = totp;
    }

    @PostMapping("/api/auth/2fa/setup")
    public ResponseEntity<Map<String, Object>> setup(Authentication authentication) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        StringBuilder secret = new StringBuilder();
        SecureRandom random = new SecureRandom();
        // 16 字符 base32 = 80 bit（标准 TOTP 长度，且无需 padding 即可被验证器解码）
        for (int i = 0; i < 16; i++) {
            secret.append(B32_ALPHABET.charAt(random.nextInt(32)));
        }
        String b32 = secret.toString();
        try {
            redis.opsForValue().set("2fa:pending:" + user.id(), b32, Duration.ofMinutes(10));
        } catch (Exception e) {
            return ResponseEntity.status(503).body(Map.of("error", "存储不可用，请稍后重试"));
        }
        String uri = "otpauth://totp/KnowledgeAI:" + user.email()
                + "?secret=" + b32 + "&issuer=KnowledgeAI&algorithm=SHA1&digits=6&period=30";
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("secret", b32);
        res.put("otpauthUrl", uri);
        res.put("message", "请使用验证器 App 扫码，然后提交验证码完成绑定");
        return ResponseEntity.ok(res);
    }

    public record CodeRequest(String code) {
    }

    @PostMapping("/api/auth/2fa/enable")
    public ResponseEntity<Map<String, Object>> enable(Authentication authentication, @RequestBody CodeRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String pending = get("2fa:pending:" + user.id());
        if (pending == null || pending.isEmpty()) {
            return ResponseEntity.status(400).body(Map.of("error", "请先调用 setup 生成绑定信息"));
        }
        if (body == null || body.code() == null || !totp.verify(pending, body.code().trim())) {
            return ResponseEntity.status(401).body(Map.of("error", "两步验证码不正确"));
        }
        try {
            redis.opsForValue().set("2fa:secret:" + user.id(), pending);
            redis.delete("2fa:pending:" + user.id());
        } catch (Exception e) {
            return ResponseEntity.status(503).body(Map.of("error", "存储不可用，请稍后重试"));
        }
        jdbc.update("UPDATE \"User\" SET \"twoFactorEnabled\" = true WHERE id = ?", user.id());
        return ResponseEntity.ok(Map.of("ok", true, "enabled", true));
    }

    @PostMapping("/api/auth/2fa/disable")
    public ResponseEntity<Map<String, Object>> disable(Authentication authentication,
                                                       @RequestBody(required = false) CodeRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        // 已启用时需提供有效验证码（防会话劫持后直接关闭——对齐现网语义）
        String secret = get("2fa:secret:" + user.id());
        if (secret != null && !secret.isEmpty()) {
            if (body == null || body.code() == null || !totp.verify(secret, body.code().trim())) {
                return ResponseEntity.status(401).body(Map.of("error", "两步验证码不正确"));
            }
        }
        try {
            redis.delete("2fa:secret:" + user.id());
            redis.delete("2fa:pending:" + user.id());
        } catch (Exception ignored) {
            // Redis 不可达时仍更新 DB 标志
        }
        jdbc.update("UPDATE \"User\" SET \"twoFactorEnabled\" = false WHERE id = ?", user.id());
        return ResponseEntity.ok(Map.of("ok", true, "enabled", false));
    }

    private String get(String key) {
        try {
            return redis.opsForValue().get(key);
        } catch (Exception e) {
            return null;
        }
    }
}
