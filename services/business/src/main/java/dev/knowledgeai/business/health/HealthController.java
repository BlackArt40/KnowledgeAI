package dev.knowledgeai.business.health;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 业务服务存活探针 —— 与现有 Next 侧 /api/health 语义对齐（service-split.md 6.4）：
 * liveness 恒 200，供 compose/K8s 探针使用；依赖级就绪（DB/Redis/AI）在 M2/M3
 * 引入 /api/health/ready 时对齐 revocationDegraded / queueBackpressured 语义
 * （ADR-0006 / ADR-0007）。
 */
@RestController
public class HealthController {

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        body.put("service", "business");
        body.put("time", Instant.now().toString());
        return body;
    }
}
