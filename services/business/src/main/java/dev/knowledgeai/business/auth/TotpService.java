package dev.knowledgeai.business.auth;

import java.nio.ByteBuffer;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.OptionalLong;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

/**
 * RFC 6238 TOTP（手册 4.1，对齐现网 src/lib/security/totp.ts 的 otplib 配置）：
 * HMAC-SHA1、6 位、30s 步长、±1 步容差（epochTolerance = period）。
 * RFC 6238 官方向量测试锁定（TotpServiceTest）。
 */
@Service
public class TotpService {

    private static final int DIGITS = 6;
    private static final long STEP_SECONDS = 30;
    private static final int WINDOW_STEPS = 1;

    /**
     * 校验并返回命中的时间步（30s 计数）。
     *
     * 登录路径必须使用本方法：把命中的步号记入 Redis 才能拒绝同一验证码在
     * ±1 步容差窗口内被重复使用（防重放）。
     */
    public OptionalLong verifyStep(String base32Secret, String code, long epochSeconds) {
        if (code == null || !code.matches("\\d{6}")) return OptionalLong.empty();
        byte[] secret = base32Decode(base32Secret);
        if (secret.length == 0) return OptionalLong.empty();
        long counter = epochSeconds / STEP_SECONDS;
        int target = Integer.parseInt(code);
        for (int i = -WINDOW_STEPS; i <= WINDOW_STEPS; i++) {
            if (hotp(secret, counter + i) == target) return OptionalLong.of(counter + i);
        }
        return OptionalLong.empty();
    }

    /** 校验 base32 编码 secret 的 TOTP 码（允许当前步 ±1）。 */
    public boolean verify(String base32Secret, String code, long epochSeconds) {
        return verifyStep(base32Secret, code, epochSeconds).isPresent();
    }

    public boolean verify(String base32Secret, String code) {
        return verify(base32Secret, code, System.currentTimeMillis() / 1000);
    }

    /** RFC 4226 HOTP 截断（dynamic truncation）+ 6 位取模。 */
    static long hotp(byte[] secret, long counter) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secret, "HmacSHA1"));
            byte[] digest = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array());
            int offset = digest[digest.length - 1] & 0x0F;
            int binary = ((digest[offset] & 0x7F) << 24)
                    | ((digest[offset + 1] & 0xFF) << 16)
                    | ((digest[offset + 2] & 0xFF) << 8)
                    | (digest[offset + 3] & 0xFF);
            return binary % 1_000_000L;
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("TOTP computation failed", e);
        }
    }

    /** RFC 4648 base32（A-Z2-7，忽略空格与 = padding，小写容错）。 */
    static byte[] base32Decode(String input) {
        final String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        StringBuilder clean = new StringBuilder();
        for (char c : input.toUpperCase().replace(" ", "").toCharArray()) {
            if (c != '=' && alphabet.indexOf(c) >= 0) clean.append(c);
        }
        int bitBuffer = 0;
        int bits = 0;
        byte[] out = new byte[clean.length() * 5 / 8];
        int outIndex = 0;
        for (int i = 0; i < clean.length(); i++) {
            bitBuffer = (bitBuffer << 5) | alphabet.indexOf(clean.charAt(i));
            bits += 5;
            if (bits >= 8) {
                out[outIndex++] = (byte) ((bitBuffer >> (bits - 8)) & 0xFF);
                bits -= 8;
            }
        }
        return out;
    }
}
