package dev.knowledgeai.business.usage;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

/**
 * 用量计量（手册 4.5）：问答成功回调 recordQa，按 workspace 按日聚合
 * （V18 "UsageDaily" 表，Flyway 产出）。对齐现网 billing/store.ts recordQa 的
 * 触发时机 —— 仅在问答成功落库后计数；失败/中断不计。
 *
 * usage.alert（手册 5.5）：跨过当日问答阈值时投递一次 webhook（每 workspace
 * 每阈值一次，Redis 去重）。阈值取 env 覆盖（usage.alert-qa-limit，0=关闭），
 * 未覆盖时按 plan 判定（free=100，其余 plan 不限量——对齐现网 plans.ts）。
 */
@Service
@Profile("pg")
public class UsageService {

    private final JdbcTemplate jdbc;
    private final org.springframework.data.redis.core.StringRedisTemplate redis;
    private final dev.knowledgeai.business.agent.WebhookService webhooks;
    private final int alertQaLimit;

    public UsageService(JdbcTemplate jdbc,
                        org.springframework.data.redis.core.StringRedisTemplate redis,
                        dev.knowledgeai.business.agent.WebhookService webhooks,
                        @Value("${usage.alert-qa-limit:0}") int alertQaLimit) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.webhooks = webhooks;
        this.alertQaLimit = alertQaLimit;
    }

    public void recordQa(String workspaceId) {
        recordQa(workspaceId, null);
    }

    public void recordQa(String workspaceId, String userId) {
        LocalDate today = LocalDate.now();
        jdbc.update(
                "INSERT INTO \"UsageDaily\" (\"workspaceId\", \"day\", \"qaCount\", \"agentCount\") "
                        + "VALUES (?, ?, 1, 0) "
                        + "ON CONFLICT (\"workspaceId\", \"day\") DO UPDATE SET \"qaCount\" = \"UsageDaily\".\"qaCount\" + 1",
                workspaceId, today);
        // P1: per-user counters (billing page / admin monthly totals).
        if (userId != null && !userId.isBlank()) {
            jdbc.update(
                    "INSERT INTO \"UserUsageDaily\" (\"userId\", \"day\", \"qaCount\", \"apiCount\", \"agentCount\") "
                            + "VALUES (?, ?, 1, 1, 0) "
                            + "ON CONFLICT (\"userId\", \"day\") DO UPDATE SET "
                            + "\"qaCount\" = \"UserUsageDaily\".\"qaCount\" + 1, "
                            + "\"apiCount\" = \"UserUsageDaily\".\"apiCount\" + 1",
                    userId, today);
        }
        maybeAlert(workspaceId);
    }

    public void recordAgent(String workspaceId) {
        recordAgent(workspaceId, null);
    }

    public void recordAgent(String workspaceId, String userId) {
        LocalDate today = LocalDate.now();
        jdbc.update(
                "INSERT INTO \"UsageDaily\" (\"workspaceId\", \"day\", \"qaCount\", \"agentCount\") "
                        + "VALUES (?, ?, 0, 1) "
                        + "ON CONFLICT (\"workspaceId\", \"day\") DO UPDATE SET \"agentCount\" = \"UsageDaily\".\"agentCount\" + 1",
                workspaceId, today);
        if (userId != null && !userId.isBlank()) {
            jdbc.update(
                    "INSERT INTO \"UserUsageDaily\" (\"userId\", \"day\", \"qaCount\", \"apiCount\", \"agentCount\") "
                            + "VALUES (?, ?, 0, 0, 1) "
                            + "ON CONFLICT (\"userId\", \"day\") DO UPDATE SET "
                            + "\"agentCount\" = \"UserUsageDaily\".\"agentCount\" + 1",
                    userId, today);
        }
    }

    public long qaCountToday(String workspaceId) {
        var list = jdbc.queryForList(
                "SELECT \"qaCount\" FROM \"UsageDaily\" WHERE \"workspaceId\" = ? AND \"day\" = ?",
                Object.class, workspaceId, LocalDate.now());
        return list.isEmpty() ? 0L : ((Number) list.get(0)).longValue();
    }

    /** 阈值判定 + 一次性告警（计量热路径：任何异常吞掉，不影响主流程）。 */
    private void maybeAlert(String workspaceId) {
        try {
            int limit = alertQaLimit;
            if (limit <= 0) {
                // plan 语义（对齐现网 plans.ts：free qaLimit=100，其余不限量）
                List<String> plans = jdbc.query(
                        "SELECT plan FROM \"Workspace\" WHERE id = ?", (rs, n) -> rs.getString(1), workspaceId);
                if (plans.isEmpty() || !"free".equals(plans.get(0))) return;
                limit = 100;
            }
            long used = qaCountToday(workspaceId);
            if (used < limit) return;
            // 每 workspace 每日每阈值一次（Redis 去重，TTL 2 天）
            String dedupeKey = "usage:alerted:" + workspaceId + ":" + LocalDate.now() + ":" + limit;
            Boolean first = redis.opsForValue().setIfAbsent(dedupeKey, "1", java.time.Duration.ofDays(2));
            if (!Boolean.TRUE.equals(first)) return;
            List<String> planRows = jdbc.query(
                    "SELECT plan FROM \"Workspace\" WHERE id = ?", (rs, n) -> rs.getString(1), workspaceId);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("workspaceId", workspaceId);
            data.put("plan", planRows.isEmpty() ? "free" : planRows.get(0));
            data.put("usage", used);
            data.put("limit", limit);
            webhooks.emit(workspaceId, "usage.alert", data);
        } catch (Exception ignored) {
            // metering 热路径不抛
        }
    }
}
