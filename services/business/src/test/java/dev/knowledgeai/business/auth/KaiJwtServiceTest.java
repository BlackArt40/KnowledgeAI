package dev.knowledgeai.business.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * kai-token JWT 跨语言兼容测试（ADR-0009 决策 3）。
 * 基准向量由现网 TS 实现（jose SignJWT，src/lib/auth/session.ts createToken）
 * 签发；再生方式：AUTH_SECRET=... npx tsx scripts/local/gen-m1-vectors.ts
 */
class KaiJwtServiceTest {

    private static final String SECRET = "m1-compat-secret-for-cross-language-verify";

    /** TS createToken 的真实输出（AUTH_SECRET=SECRET，365 天，jti 固定）。 */
    private static final String TS_JWT_VECTOR =
            "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InVzcl9tMWNvbXBhdCIsImVtYWlsIjoiY29tcGF0QGtub3dsZWRnZWFpLmRldiIsIm5hbWUiOiLlhbzlrrnmtYvor5UiLCJyb2xlIjoib3duZXIiLCJqdGkiOiJtMS1jb21wYXQtanRpLTAwMDEiLCJleHAiOjE4MjM0MDA0NDd9.j27n9dRf6PjchDCH47HHQQbA3uGxsTxkMTizIDTofxI";

    private final KaiJwtService service = new KaiJwtService(SECRET);

    @Test
    void verifiesTsIssuedToken() {
        Optional<KaiJwtService.VerifiedToken> verified = service.verify(TS_JWT_VECTOR);
        assertTrue(verified.isPresent(), "Java 必须能校验 TS 签发的真实 token");
        KaiJwtService.AuthUser user = verified.get().user();
        assertEquals("usr_m1compat", user.id());
        assertEquals("compat@knowledgeai.dev", user.email());
        assertEquals("兼容测试", user.name());
        assertEquals("owner", user.role());
        assertEquals("m1-compat-jti-0001", verified.get().jti());
    }

    @Test
    void rejectsTamperedAndForeignTokens() {
        assertTrue(service.verify(TS_JWT_VECTOR + "x").isEmpty(), "签名被篡改必须拒绝");
        // nimbus 要求签名密钥 ≥ 256 bits；用足够长的外部密钥验证密钥隔离
        assertTrue(service.verify(new KaiJwtService("another-secret-that-is-long-enough-32bytes").sign(
                new KaiJwtService.AuthUser("u", "e@x.dev", "n", "owner"))).isEmpty(),
                "不同 AUTH_SECRET 签发的 token 必须拒绝");
        assertTrue(service.verify(null).isEmpty());
        assertTrue(service.verify("").isEmpty());
    }

    @Test
    void roundTripsIssuedToken() {
        String token = service.sign(new KaiJwtService.AuthUser("usr_rt", "rt@knowledgeai.dev", "往返", "editor"), 3600, "jti-rt");
        Optional<KaiJwtService.VerifiedToken> verified = service.verify(token);
        assertTrue(verified.isPresent());
        assertEquals("editor", verified.get().user().role());
        assertEquals("jti-rt", verified.get().jti());
    }
}
