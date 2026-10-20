package dev.knowledgeai.business.auth;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** 安全评审 P0：公开默认 AUTH_SECRET 必须拒绝启动。 */
class AuthSecretTest {

    @Test
    void rejectsMissingOrPublicDefaultSecret() {
        assertThrows(IllegalStateException.class, () -> AuthSecret.require(null, "test"));
        assertThrows(IllegalStateException.class, () -> AuthSecret.require("   ", "test"));
        assertThrows(IllegalStateException.class,
                () -> AuthSecret.require("dev-secret-change-in-production", "test"));
    }

    @Test
    void acceptsAnExplicitSecret() {
        assertArrayEquals("real-production-secret".getBytes(StandardCharsets.UTF_8),
                AuthSecret.require("real-production-secret", "test"));
    }
}
