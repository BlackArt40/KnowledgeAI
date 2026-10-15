package dev.knowledgeai.business.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * ApiKeyService 纯函数校验：密文确定性长度（评审 #6 快速淘汰的基石）+
 * hasScope 对 PG `text[]::text` 花括号渲染的解析（阶段 5 修复的回归锁定）。
 */
class ApiKeyServiceTest {

    @Test
    void expectedStoredLengthMatchesEncryptToStringShape() {
        // encryptToString: {"iv":"<16B→24b64>","data":"<nB→4*ceil(n/3) b64>","tag":"<16B→24b64>"}
        // = 固定 JSON 骨架 76 字符 + data 的 b64 长度
        assertEquals(76 + 20, ApiKeyService.expectedStoredLength("kai_sk_test123")); // 14B → 20 b64
        assertEquals(76 + 28, ApiKeyService.expectedStoredLength("kai_sk_abcdefghijklm")); // 20B → 28 b64
        assertEquals(76 + 32, ApiKeyService.expectedStoredLength("kai_sk_abcdefghijklmnop")); // 23B → 32 b64
    }

    @Test
    void hasScopeParsesPostgresArrayRendering() {
        // PG `text[]::text` 渲染 {a,b}——阶段 4 遗留缺陷（剥 [] 漏 {}）的回归锁定
        ApiKeyService.ApiKeyRow row = new ApiKeyService.ApiKeyRow(
                "ak_1", "usr_1", "{chat:read,agent:run}", "active", "cipher");
        assertTrue(ApiKeyService.hasScope(row, "chat:read"));
        assertTrue(ApiKeyService.hasScope(row, "agent:run"));
        assertFalse(ApiKeyService.hasScope(row, "kb:write"));

        ApiKeyService.ApiKeyRow quoted = new ApiKeyService.ApiKeyRow(
                "ak_2", "usr_1", "{\"kb:read\"}", "active", "cipher");
        assertTrue(ApiKeyService.hasScope(quoted, "kb:read"));
        assertFalse(ApiKeyService.hasScope(quoted, "kb:write"));
    }
}
