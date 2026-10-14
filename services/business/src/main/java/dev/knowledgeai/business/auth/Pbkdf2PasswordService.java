package dev.knowledgeai.business.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.stereotype.Service;

/**
 * PBKDF2 密码哈希 —— 与现网 TS 实现（src/lib/auth/session.ts）逐字节兼容
 * （ADR-0009 决策 3，阶段 4 工作包 4.1 的硬约束）：
 *
 *   格式  pbkdf2$&lt;iterations&gt;$&lt;b64url(salt)&gt;$&lt;b64url(hash)&gt;
 *   算法  PBKDF2-HMAC-SHA256，256 位派生，16 字节随机 salt，默认 100000 迭代
 *   编码  base64url 无 padding（jose base64url 语义）
 *
 * 兼容性由跨语言向量测试锁定（Pbkdf2PasswordServiceTest 用 TS 生成的真实
 * 哈希作为基准向量，scripts/local/gen-m1-vectors.ts 可再生）。
 */
@Service
public class Pbkdf2PasswordService {

    private static final int DEFAULT_ITERATIONS = 100_000;
    private static final int SALT_BYTES = 16;
    private static final int KEY_BITS = 256;
    private static final Base64.Decoder B64URL_DECODE = Base64.getUrlDecoder();
    private static final Base64.Encoder B64URL_ENCODE = Base64.getUrlEncoder().withoutPadding();
    private final SecureRandom random = new SecureRandom();

    /** 校验密码与存储哈希。兼容两种现网格式（对齐 TS passwordMatches，auth/store.ts）：
     *  1. pbkdf2$&lt;iters&gt;$&lt;salt&gt;$&lt;hash&gt;（P3-4 起的主流格式）
     *  2. legacy 无盐 SHA-256 hex（seed 账号 / pre-P3-4 行）
     *  格式非法 / 迭代数非法 → false。 */
    public boolean verify(String password, String stored) {
        if (password == null || stored == null) return false;
        if (!stored.startsWith("pbkdf2$")) {
            // legacy：SHA-256 hex（小写），恒时比较
            byte[] legacy = legacySha256(password);
            return constantTimeEquals(legacy, hexToBytes(stored));
        }
        String[] parts = stored.split("\\$");
        if (parts.length != 4 || !"pbkdf2".equals(parts[0])) return false;
        final int iterations;
        try {
            iterations = Integer.parseInt(parts[1]);
        } catch (NumberFormatException e) {
            return false;
        }
        if (iterations <= 0) return false;
        byte[] salt;
        byte[] expected;
        try {
            salt = B64URL_DECODE.decode(parts[2]);
            expected = B64URL_DECODE.decode(parts[3]);
        } catch (IllegalArgumentException e) {
            return false;
        }
        byte[] derived = derive(password, salt, iterations);
        // 恒时比较（对齐 TS timingSafeEqualBytes / F10）
        return constantTimeEquals(derived, expected);
    }

    private static byte[] legacySha256(String password) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(utf8(password));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static byte[] hexToBytes(String hex) {
        if (hex.length() % 2 != 0) return new byte[0];
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(hex.charAt(2 * i), 16);
            int lo = Character.digit(hex.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return new byte[0];
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    /** 生成现网兼容格式的哈希（默认 100000 迭代）。 */
    public String hash(String password) {
        byte[] salt = new byte[SALT_BYTES];
        random.nextBytes(salt);
        byte[] derived = derive(password, salt, DEFAULT_ITERATIONS);
        return "pbkdf2$" + DEFAULT_ITERATIONS + "$"
                + B64URL_ENCODE.encodeToString(salt) + "$"
                + B64URL_ENCODE.encodeToString(derived);
    }

    private byte[] derive(String password, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(
                    password.toCharArray(), salt, iterations, KEY_BITS);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("PBKDF2 derivation failed", e);
        }
    }

    private static boolean constantTimeEquals(byte[] a, byte[] b) {
        if (a.length != b.length) return false;
        int diff = 0;
        for (int i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    /** 供测试访问：与 MessageDigest.isEqual 等价的显式恒时语义。 */
    static boolean timingSafeEquals(byte[] a, byte[] b) {
        return MessageDigest.isEqual(a, b) && constantTimeEquals(a, b);
    }

    static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
