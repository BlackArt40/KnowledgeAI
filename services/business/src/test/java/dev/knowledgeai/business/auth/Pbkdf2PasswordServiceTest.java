package dev.knowledgeai.business.auth;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * PBKDF2 跨语言兼容测试（ADR-0009 决策 3，硬约束）。
 * 基准向量由现网 TS 实现（src/lib/auth/session.ts hashPassword）生成，
 * 再生方式：AUTH_SECRET=... npx tsx scripts/local/gen-m1-vectors.ts
 */
class Pbkdf2PasswordServiceTest {

    /** TS 侧 hashPassword("password123") 的真实输出（AUTH_SECRET 无关）。 */
    private static final String TS_HASH_VECTOR =
            "pbkdf2$100000$Gxb0vQkWyZN9n9vYAZacsQ$mA7qoXHh0_x44aj3T-VKZJeUO5RoR_VVw-05lZcU0pM";

    private final Pbkdf2PasswordService service = new Pbkdf2PasswordService();

    @Test
    void verifiesTsGeneratedHash() {
        assertTrue(service.verify("password123", TS_HASH_VECTOR),
                "Java 必须能校验 TS 生成的真实哈希（逐字节兼容）");
    }

    @Test
    void rejectsWrongPasswordOnTsHash() {
        assertFalse(service.verify("password124", TS_HASH_VECTOR));
        assertFalse(service.verify("Password123", TS_HASH_VECTOR));
    }

    @Test
    void roundTripsOwnHash() {
        String hash = service.hash("s3cret-密码");
        assertTrue(hash.startsWith("pbkdf2$100000$"), "格式须与 TS 一致（100000 迭代）");
        assertTrue(service.verify("s3cret-密码", hash));
        assertFalse(service.verify("wrong", hash));
    }

    @Test
    void generatedHashVerifiableByConstruction() {
        // Java 生成 → Java 校验 + TS 校验由 scripts/local verify 脚本在验收时双向复核
        String hash = service.hash("roundtrip");
        assertTrue(service.verify("roundtrip", hash));
    }

    @Test
    void malformedHashesAreRejected() {
        assertFalse(service.verify("password123", ""));
        assertFalse(service.verify("password123", "pbkdf2$abc$salt$hash"));
        assertFalse(service.verify("password123", "pbkdf2$0$abc$def"));
        assertFalse(service.verify("password123", "bcrypt$100000$abc$def"));
        assertFalse(service.verify("password123", null));
    }

    @Test
    void verifiesLegacySha256SeedHashes() {
        // seed 账号（password123）存的是 legacy 无盐 SHA-256 hex（auth/store.ts
        // passwordMatches 的第二分支）—— Java 侧必须同样兼容。
        // 向量即 prisma db seed 后 "User"."passwordHash" 的实际值：
        String seedVector = "ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f";
        assertTrue(service.verify("password123", seedVector),
                "必须能校验 seed 账号的 legacy SHA-256 哈希");
        assertFalse(service.verify("wrong", seedVector));
    }
}
