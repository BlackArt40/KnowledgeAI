package dev.knowledgeai.business.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.SecureRandom;
import java.text.ParseException;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * kai-token JWT —— 与现网 TS 实现（src/lib/auth/session.ts，jose HS256）逐字节
 * 兼容（ADR-0009 决策 3）：
 *
 *   算法   HS256，签名密钥 = AUTH_SECRET 原文 UTF-8 字节（jose TextEncoder 语义）
 *   claims { id, email, name, role, jti } + 标准 exp（秒级 NumericDate）
 *
 * 同一 AUTH_SECRET 下，TS 签发的 token 本服务可验、本服务签发的 token TS 可验
 * （双向由 KaiJwtServiceTest 的跨语言向量 + verify script 双向锁定）。
 */
@Service
public class KaiJwtService {

    private static final long DEFAULT_TTL_SECONDS = 7 * 86400L;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final byte[] secret;

    public KaiJwtService(@Value("${auth.secret:${AUTH_SECRET:dev-secret-change-in-production}}") String secret) {
        this.secret = secret.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    public record AuthUser(String id, String email, String name, String role) {
    }

    public record VerifiedToken(AuthUser user, String jti, Instant expiresAt) {
    }

    /** 签发 kai-token（claims 与 TS createToken 一致；jti 缺省随机 UUID）。 */
    public String sign(AuthUser user, long ttlSeconds, String jti) {
        try {
            Instant expiresAt = Instant.now().plusSeconds(ttlSeconds);
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .claim("id", user.id())
                    .claim("email", user.email())
                    .claim("name", user.name())
                    .claim("role", user.role())
                    .jwtID(jti == null ? UUID.randomUUID().toString() : jti)
                    .expirationTime(Date.from(expiresAt))
                    .build();
            SignedJWT signed = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.HS256).build(), claims);
            signed.sign(new MACSigner(secret));
            return signed.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("JWT signing failed", e);
        }
    }

    public String sign(AuthUser user) {
        return sign(user, DEFAULT_TTL_SECONDS, null);
    }

    /** 校验并解析 token；签名无效 / 过期 / 结构不符 → empty（对齐 TS verifyToken null 语义）。 */
    public Optional<VerifiedToken> verify(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        try {
            SignedJWT parsed = SignedJWT.parse(token);
            if (!parsed.verify(new MACVerifier(secret))) return Optional.empty();
            JWTClaimsSet claims = parsed.getJWTClaimsSet();
            String id = claims.getStringClaim("id");
            String email = claims.getStringClaim("email");
            if (id == null || email == null) return Optional.empty();
            Date exp = claims.getExpirationTime();
            if (exp == null || exp.toInstant().isBefore(Instant.now())) return Optional.empty();
            String jti = claims.getJWTID();
            if (jti == null || jti.isBlank()) return Optional.empty();
            return Optional.of(new VerifiedToken(
                    new AuthUser(id, email,
                            claims.getStringClaim("name") == null ? "" : claims.getStringClaim("name"),
                            claims.getStringClaim("role") == null ? "" : claims.getStringClaim("role")),
                    jti,
                    exp.toInstant()));
        } catch (ParseException | JOSEException e) {
            return Optional.empty();
        }
    }

    /** 随机 jti（与 TS crypto.randomUUID 缺省一致）。 */
    public static String randomJti() {
        return UUID.randomUUID().toString();
    }
}
