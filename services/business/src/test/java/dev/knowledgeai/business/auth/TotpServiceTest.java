package dev.knowledgeai.business.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.OptionalLong;
import org.junit.jupiter.api.Test;

/** RFC 6238 SHA1 官方向量 + 时步返回（登录防重放的基础）。 */
class TotpServiceTest {

    private final TotpService totp = new TotpService();

    // RFC 6238 test secret: ASCII "12345678901234567890" in base32.
    private static final String SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    @Test
    void verifiesRfcVectorAndReturnsTheMatchedStep() {
        OptionalLong step = totp.verifyStep(SECRET, "287082", 59);
        assertTrue(step.isPresent());
        assertEquals(1, step.getAsLong());
        assertTrue(totp.verify(SECRET, "287082", 59));
    }

    @Test
    void rejectsWrongCodesAndOutsideTheToleranceWindow() {
        assertFalse(totp.verify(SECRET, "000000", 59));
        // Step 1 code is not valid at step 10 (±1 window).
        assertFalse(totp.verify(SECRET, "287082", 300));
    }
}
