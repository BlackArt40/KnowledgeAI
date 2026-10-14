package dev.knowledgeai.business.ratelimit;

import java.time.Duration;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;

/**
 * Redis ZSET 滑动窗口限流（手册 4.6）：算法与现网 src/lib/rate-limit.ts 一致 ——
 * 60s 窗口、ZADD now / ZREMRANGEBYSCORE 清窗口 / ZCARD 计数，超限返回
 * Retry-After（窗口内最早元素距过期秒数）。
 * Redis 不可达时降级放行（fail-open）并在就绪探针暴露 —— 与现网
 * rateLimitDegraded 语义一致（ADR-0006），生产告警依赖该信号。
 */
@Service
public class RateLimiter {

    private static final long WINDOW_MS = 60_000;
    private final StringRedisTemplate redis;
    private final Clock clock;

    /** 可注入时钟（测试用）。 */
    public interface Clock {
        long nowMillis();
    }

    /** 容器注入构造器（多构造器需显式标注；测试用 Clock 注入构造器）。 */
    @org.springframework.beans.factory.annotation.Autowired
    public RateLimiter(StringRedisTemplate redis) {
        this(redis, System::currentTimeMillis);
    }

    public RateLimiter(StringRedisTemplate redis, Clock clock) {
        this.redis = redis;
        this.clock = clock;
    }

    public record Result(boolean allowed, long remaining, long retryAfterSeconds) {
    }

    /** 尝试消费 1 个配额。key 形如 ratelimit:user:usr_x。 */
    public Result hit(String key, int limitPerMinute) {
        long now = clock.nowMillis();
        String windowKey = "ratelimit:" + key;
        try {
            String member = now + ":" + java.util.UUID.randomUUID();
            redis.opsForZSet().add(windowKey, member, now);
            redis.opsForZSet().removeRangeByScore(windowKey, 0, now - WINDOW_MS);
            Long count = redis.opsForZSet().zCard(windowKey);
            long used = count == null ? 1 : count;
            redis.expire(windowKey, Duration.ofSeconds(120));
            if (used > limitPerMinute) {
                long retryAfter = retryAfterSeconds(windowKey, now);
                return new Result(false, 0, retryAfter);
            }
            return new Result(true, Math.max(0, limitPerMinute - used), 0);
        } catch (Exception e) {
            // Redis 不可达：fail-open（降级语义见 ADR-0006）
            return new Result(true, limitPerMinute, 0);
        }
    }

    private long retryAfterSeconds(String windowKey, long now) {
        Set<ZSetOperations.TypedTuple<String>> oldest =
                redis.opsForZSet().rangeWithScores(windowKey, 0, 0);
        if (oldest == null || oldest.isEmpty() || oldest.iterator().next().getScore() == null) {
            return 60;
        }
        long oldestScore = oldest.iterator().next().getScore().longValue();
        return Math.max(1, (oldestScore + WINDOW_MS - now) / 1000);
    }
}
