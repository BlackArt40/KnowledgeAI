package dev.knowledgeai.business.auth;

import java.nio.charset.StandardCharsets;

/**
 * AUTH_SECRET 启动校验（安全评审 P0）。
 *
 * JWT 签名、API Key 密文解密、审计 HMAC 共用同一根密钥。过去三处配置都带有
 * 公开默认值 {@code dev-secret-change-in-production}，一旦部署遗漏环境变量，
 * 任何人都能伪造任意角色的 kai-token 并解出全部 API Key 明文。
 *
 * 这里把所有使用点收敛到一次校验：空值 / 公开默认值直接抛异常拒绝启动。
 */
public final class AuthSecret {

    /** 历史公开默认值，仅用于识别并拒绝，绝不再作为回退值使用。 */
    static final String PUBLIC_DEFAULT = "dev-secret-change-in-production";

    private AuthSecret() {
    }

    /** 校验并返回密钥字节；不合法时终止启动。 */
    public static byte[] require(String secret, String consumer) {
        if (secret == null || secret.isBlank() || PUBLIC_DEFAULT.equals(secret)) {
            throw new IllegalStateException(
                    "AUTH_SECRET 未配置或仍为公开默认值（使用方: " + consumer + "）："
                            + "拒绝启动。JWT 签名 / API Key 解密 / 审计 HMAC 共用该密钥，"
                            + "缺省值会导致任意账号伪造与敏感数据解密。");
        }
        return secret.getBytes(StandardCharsets.UTF_8);
    }
}
