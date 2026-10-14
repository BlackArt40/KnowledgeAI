package dev.knowledgeai.business.health;

import dev.knowledgeai.business.ai.AiClient;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 就绪探针（手册 4.6/6.4 + ADR-0006/0007 语义）：db / redis / ai 三维。
 * unconfigured = skipped（不降级）；configured-but-unreachable = degraded → 503。
 * 限流降级位（rateLimitDegraded）由 RateLimitFilter 暴露。
 */
@RestController
@Profile("pg")
public class ReadyController {

    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final AiClient ai;
    private final dev.knowledgeai.business.ratelimit.RateLimitFilter rateLimitFilter;

    public ReadyController(JdbcTemplate jdbc, StringRedisTemplate redis, AiClient ai,
                           dev.knowledgeai.business.ratelimit.RateLimitFilter rateLimitFilter,
                           @Value("${spring.data.redis.host:localhost}") String redisHost) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.ai = ai;
        this.rateLimitFilter = rateLimitFilter;
        this.redisHost = redisHost;
    }

    private final String redisHost;

    @GetMapping("/api/health/ready")
    public ResponseEntity<Map<String, Object>> ready() {
        List<String> degraded = new ArrayList<>();
        Map<String, Object> checks = new LinkedHashMap<>();

        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
            checks.put("db", "ok");
        } catch (Exception e) {
            checks.put("db", "unreachable");
            degraded.add("db");
        }

        try {
            String pong = redis.getConnectionFactory().getConnection().ping();
            checks.put("redis", "ok");
        } catch (Exception e) {
            checks.put("redis", "unreachable (" + redisHost + ")");
            degraded.add("redis");
        }

        boolean aiOk = ai.healthy();
        checks.put("ai", aiOk ? "ok" : "unreachable");
        if (!aiOk) degraded.add("ai");

        checks.put("rateLimitDegraded", rateLimitFilter.isDegraded());

        // A5.7：Agent 队列背压暴露（深度达 QUEUE_MAX_DEPTH 时 /api/v1/agent/run
        // 拒绝新任务；此处仅暴露观测值，不参与 degraded 判定）
        try {
            Long depth = redis.opsForList().size("agent:queue");
            Boolean workerAlive = redis.hasKey("agent:worker:heartbeat");
            checks.put("agentQueueDepth", depth == null ? 0 : depth.intValue());
            checks.put("agentWorker", Boolean.TRUE.equals(workerAlive) ? "alive" : "offline");
        } catch (Exception e) {
            checks.put("agentQueueDepth", "unavailable");
            checks.put("agentWorker", "unknown");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", degraded.isEmpty());
        body.put("checks", checks);
        if (!degraded.isEmpty()) body.put("degraded", degraded);
        return degraded.isEmpty() ? ResponseEntity.ok(body) : ResponseEntity.status(503).body(body);
    }
}
