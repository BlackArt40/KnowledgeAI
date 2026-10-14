package dev.knowledgeai.business.auth;

import java.time.Duration;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * jti 撤销（手册 4.1/4.8，对齐现网 P1-3/F5）：登录签发的 jti 记入 Redis
 * 活跃集合；设备注销后 revoke() 移除 → 该 token 全实例失效。TTL 8 天对齐
 * 现网 JTI_TTL_MS（7 天 token 的超集）。Redis 不可达时按"未撤销"放行
 * （降级语义见 ADR-0006 revocationDegraded）。
 */
@Service
public class JtiRevocationService {

    private static final String ACTIVE_KEY = "auth:jti:active:";
    private static final String REVOKED_KEY = "auth:jti:revoked:";
    private static final Duration TTL = Duration.ofDays(8);

    private final StringRedisTemplate redis;

    @Autowired
    public JtiRevocationService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** 登录成功：记录活跃 jti。 */
    public void register(String userId, String jti) {
        try {
            redis.opsForValue().set(ACTIVE_KEY + jti, userId, TTL);
        } catch (Exception ignored) {
            // Redis 不可达：记录失败不阻断登录（与现网降级语义一致）
        }
    }

    /** 设备注销：撤销 jti（token 立即失效）。 */
    public void revoke(String jti) {
        try {
            redis.opsForValue().set(REVOKED_KEY + jti, "1", TTL);
            redis.delete(ACTIVE_KEY + jti);
        } catch (Exception ignored) {
            // 同上
        }
    }

    public boolean isRevoked(String jti) {
        try {
            return Boolean.TRUE.equals(redis.hasKey(REVOKED_KEY + jti));
        } catch (Exception e) {
            return false; // 降级：跨实例撤销失效（同实例仍由登录态语义兜底）
        }
    }

    public Optional<String> ownerOf(String jti) {
        try {
            return Optional.ofNullable(redis.opsForValue().get(ACTIVE_KEY + jti));
        } catch (Exception e) {
            return Optional.empty();
        }
    }
}
