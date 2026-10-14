package dev.knowledgeai.business.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/**
 * Webhook 签名字节级兼容（A5.5 + P7-1 契约）：X-KAI-Signature: sha256=HMAC-SHA256(secret, body)。
 * 参考值与 src/lib/webhooks/store.ts signWebhookPayload 同算法（WebCrypto HMAC-SHA256 → 小写 hex）。
 */
class WebhookSignTest {

    private static String referenceHmac(String secret, String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(
                mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void signatureFormatMatchesTsContract() throws Exception {
        String body = "{\"event\":\"kb.ready\",\"ts\":1728800000000,\"data\":{\"docId\":\"doc_x\"}}";
        String sig = WebhookService.sign("whsec_stage5", body);
        assertTrue(sig.startsWith("sha256="), "必须带 sha256= 前缀（TS 契约）");
        assertEquals("sha256=" + referenceHmac("whsec_stage5", body), sig);
    }

    @Test
    void emptySecretStillSigns() {
        // TS signWebhookPayload 以 secret || "" 参与 HMAC —— 空密钥同样有签名
        String sig = WebhookService.sign("", "payload");
        assertTrue(sig.startsWith("sha256="));
        assertNotEquals("sha256=", sig);
    }

    @Test
    void knownVector() throws Exception {
        // 与 Python services/ai/tests/test_agent.py 的同一向量互验
        String sig = WebhookService.sign("whsec_test", "{\"event\":\"kb.ready\"}");
        assertEquals("sha256=" + referenceHmac("whsec_test", "{\"event\":\"kb.ready\"}"), sig);
        assertEquals(71, sig.length()); // "sha256=" + 64 hex
    }

    @Test
    void ssrfBaselineBlocksPrivateTargets() {
        // A5.4 同源语义：投递目标拒绝内网/回环/元数据（fail-closed）
        String[] blocked = {
                "http://169.254.169.254/latest/meta-data/",
                "http://127.0.0.1:9000/hook",
                "http://10.1.2.3/hook",
                "http://192.168.1.10/hook",
                "http://172.16.0.9/hook",
                "http://localhost:5099/hook",
                "http://metadata.google.internal/computeMetadata/v1/",
                "file:///etc/passwd",
        };
        for (String url : blocked) {
            assertTrue(!WebhookService.targetAllowed(url, false), "应当拒绝: " + url);
        }
        String[] allowed = {"https://hooks.example.com/x", "https://webhook.company.cn/receive"};
        for (String url : allowed) {
            assertTrue(WebhookService.targetAllowed(url, false), "应当放行: " + url);
        }
        // 本地验收接收器策略：SSRF_ALLOW_PRIVATE_HOSTS=true 放行
        assertTrue(WebhookService.targetAllowed("http://127.0.0.1:5099/hook", true));
    }
}
