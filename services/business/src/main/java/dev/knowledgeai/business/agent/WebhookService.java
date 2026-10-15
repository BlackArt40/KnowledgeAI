package dev.knowledgeai.business.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 出站 Webhook（手册 5.5，P7-1 语义迁移，对齐 src/lib/webhooks/）：
 *   - 订阅来源：WebhookSubscription 表（workspaceId 过滤 + active + events 匹配）
 *   - 载荷：{"event":..,"ts":..,"data":{..}} —— event 名是线上一部分
 *   - 签名：X-KAI-Signature: sha256=HMAC-SHA256(secret, body) 小写 hex
 *     （与 TS signWebhookPayload 字节级兼容，空密钥同样参与签名）
 *   - 头：X-KAI-Event / X-KAI-Signature / X-KAI-Delivery / User-Agent
 *   - 重试：单次投递线程内 3 次尝试（2s/4s 退避），失败写 lastError/failures
 *     （TS 由队列重试承担，语义对齐为「3 次尝试 + 死信标记」）
 *   - 投递记录：进程内环形缓冲（100 条，与 TS store.ts 一致；DB 不落投递流水）
 */
@Service
@Profile("pg")
public class WebhookService {

    private static final Logger log = LoggerFactory.getLogger(WebhookService.class);
    private static final int TIMEOUT_MS = 10_000;
    private static final int MAX_RECORDS = 100;
    /** 事件名（线上格式，勿改）：TS WEBHOOK_EVENTS 一致。 */
    public static final String KB_READY = "kb.ready";
    public static final String AGENT_COMPLETED = "agent.completed";
    public static final String USAGE_ALERT = "usage.alert";

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final HttpClient http;
    private final boolean allowPrivateHosts;
    /** 进程内投递记录环形缓冲（dev portal 观测用）。 */
    private final List<Map<String, Object>> deliveries = new ArrayList<>();

    public WebhookService(JdbcTemplate jdbc, ObjectMapper objectMapper,
                          @Value("${webhook.allow-private-hosts:false}") boolean allowPrivateHosts) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.allowPrivateHosts = allowPrivateHosts;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    /** 记录一条投递结果（环形缓冲）。 */
    private synchronized void record(String subscriptionId, String workspaceId, String event,
                                     Object status, long latencyMs, String detail) {
        Map<String, Object> rec = new LinkedHashMap<>();
        rec.put("id", "dlv_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8));
        rec.put("subscriptionId", subscriptionId);
        rec.put("workspaceId", workspaceId);
        rec.put("event", event);
        rec.put("status", status);
        rec.put("ts", System.currentTimeMillis());
        rec.put("latencyMs", latencyMs);
        if (detail != null) rec.put("detail", detail);
        deliveries.add(0, rec);
        if (deliveries.size() > MAX_RECORDS) deliveries.subList(MAX_RECORDS, deliveries.size()).clear();
    }

    /** 投递记录（workspaceId 租户边界，绝不省略调用）。 */
    public synchronized List<Map<String, Object>> listDeliveries(String workspaceId, int limit) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> d : deliveries) {
            if (workspaceId.equals(d.get("workspaceId"))) {
                out.add(d);
                if (out.size() >= limit) break;
            }
        }
        return out;
    }

    /** X-KAI-Signature 值：sha256=<hex 小写>（与 TS signWebhookPayload 字节级一致）。
     *  采用 RFC 2104 手工构造：JCE SecretKeySpec 拒绝空密钥，而 WebCrypto 允许
     *  0 字节密钥（TS 空密钥订阅同样产生签名）——为字节级兼容统一走本实现。 */
    public static String sign(String secret, String body) {
        try {
            byte[] key = secret.getBytes(StandardCharsets.UTF_8);
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            int blockSize = 64;
            byte[] k = new byte[blockSize];
            if (key.length > blockSize) {
                md.reset();
                k = md.digest(key);
            } else {
                System.arraycopy(key, 0, k, 0, key.length);
            }
            byte[] ipad = new byte[blockSize];
            byte[] opad = new byte[blockSize];
            for (int i = 0; i < blockSize; i++) {
                ipad[i] = (byte) (k[i] ^ 0x36);
                opad[i] = (byte) (k[i] ^ 0x5c);
            }
            md.reset();
            md.update(ipad);
            byte[] inner = md.digest(data);
            md.reset();
            md.update(opad);
            byte[] sig = md.digest(inner);
            StringBuilder sb = new StringBuilder(sig.length * 2);
            for (byte b : sig) sb.append(String.format("%02x", b));
            return "sha256=" + sb;
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 不可用", e);
        }
    }

    /** 向 workspace 内所有匹配订阅投递事件（异步、fire-and-forget，不阻塞业务流）。 */
    public void emit(String workspaceId, String event, Map<String, Object> data) {
        List<Map<String, Object>> subs = jdbc.query(
                "SELECT id, url, secret FROM \"WebhookSubscription\" "
                        + "WHERE \"workspaceId\" = ? AND active = true AND ? = ANY(events)",
                (rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString(1));
                    row.put("url", rs.getString(2));
                    row.put("secret", rs.getString(3));
                    return row;
                },
                workspaceId, event);
        if (subs.isEmpty()) return;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("event", event);
        payload.put("ts", System.currentTimeMillis());
        payload.put("data", data == null ? Map.of() : data);
        String body;
        try {
            body = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.error("[webhook] payload serialize failed: {}", e.getMessage());
            return;
        }
        for (Map<String, Object> sub : subs) {
            deliveryExecutor.submit(() -> deliverWithRetry(
                    (String) sub.get("id"), workspaceId, (String) sub.get("url"),
                    (String) sub.get("secret"), event, body));
        }
    }

    private final ExecutorService deliveryExecutor = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "webhook-deliver");
        t.setDaemon(true);
        return t;
    });

    /** 投递前 SSRF 基线（对齐 TS resolveSafeUrl / P1-4：创建时已校验，投递时
     *  复检防 DNS 重绑定）。内网/回环/链路本地一律拒绝；本地验收接收器经
     *  SSRF_ALLOW_PRIVATE_HOSTS=true 放行（与仓库 smoke 套件同一环境策略）。 */
    static boolean targetAllowed(String url, boolean allowPrivate) {
        try {
            java.net.URI u = java.net.URI.create(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
            if (!scheme.equals("http") && !scheme.equals("https")) return false;
            if (allowPrivate) return true;
            String host = (u.getHost() == null ? "" : u.getHost()).toLowerCase();
            // Java URI.getHost() 对 IPv6 字面量保留方括号（"[::1]"）——先剥掉
            if (host.startsWith("[") && host.endsWith("]")) {
                host = host.substring(1, host.length() - 1);
            }
            if (host.isEmpty() || host.equals("localhost") || host.equals("0.0.0.0")
                    || host.endsWith(".local") || host.endsWith(".internal")) {
                return false;
            }
            if (host.contains(":")) {
                // IPv6 字面量：IPv4-mapped（::ffff:a.b.c.d）折回 IPv4 判定；
                // 其余拦全零/回环/ULA（fc00::/7）/链路本地（fe80::/10）——与
                // Python external.is_public_url 同口径（评审 #4）
                if (host.startsWith("::ffff:")) {
                    host = host.substring(7);
                } else {
                    return !(host.equals("::1") || host.equals("::")
                            || host.startsWith("fe80") || host.startsWith("fc")
                            || host.startsWith("fd"));
                }
            }
            String[] parts = host.split("\\.");
            if (parts.length == 4) {
                try {
                    int first = Integer.parseInt(parts[0]);
                    int second = Integer.parseInt(parts[1]);
                    if (first == 127 || first == 10 || first == 192 && second == 168
                            || first == 169 && second == 254
                            || first == 172 && second >= 16 && second <= 31) {
                        return false;
                    }
                } catch (NumberFormatException ignored) {
                    // 非点分 IPv4：按域名处理
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void deliverWithRetry(String subId, String workspaceId, String url,
                                  String secret, String event, String body) {
        if (!targetAllowed(url, allowPrivateHosts)) {
            record(subId, workspaceId, event, "error", 0, "目标地址被禁止（内网/回环）");
            markOutcome(subId, false, "SSRF blocked");
            return;
        }
        String[] backoffs = {"0", "2000", "4000"}; // 首次 + 2s/4s 退避（3 次尝试）
        int failures = 0;
        for (int attempt = 0; attempt < backoffs.length; attempt++) {
            long start = System.currentTimeMillis();
            try {
                Thread.sleep(Long.parseLong(backoffs[attempt]));
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
            try {
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofMillis(TIMEOUT_MS))
                        .header("Content-Type", "application/json")
                        .header("X-KAI-Event", event)
                        .header("X-KAI-Signature", sign(secret == null ? "" : secret, body))
                        .header("X-KAI-Delivery", "whk_" + UUID.randomUUID().toString()
                                .replace("-", "").substring(0, 8))
                        .header("User-Agent", "KnowledgeAI-Webhook/1.0")
                        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                        .build();
                HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
                long latency = System.currentTimeMillis() - start;
                boolean ok = res.statusCode() >= 200 && res.statusCode() < 300;
                record(subId, workspaceId, event, res.statusCode(), latency,
                        ok ? null : "HTTP " + res.statusCode());
                if (ok) {
                    markOutcome(subId, true, null);
                    return;
                }
                failures++;
            } catch (Exception e) {
                failures++;
                record(subId, workspaceId, event, "error", System.currentTimeMillis() - start,
                        e.getMessage() == null ? "delivery error" : e.getMessage());
            }
        }
        markOutcome(subId, false, "投递失败（3 次尝试）: " + (failures) + " failures");
    }

    /** 成功清零 failures / 失败累加并写 lastError（对齐 TS markDeliveryOutcome）。 */
    private void markOutcome(String subId, boolean ok, String detail) {
        try {
            if (ok) {
                jdbc.update("UPDATE \"WebhookSubscription\" SET \"lastDeliveryAt\" = now(), "
                        + "failures = 0, \"lastError\" = NULL WHERE id = ?", subId);
            } else {
                jdbc.update("UPDATE \"WebhookSubscription\" SET failures = failures + 1, "
                        + "\"lastError\" = ? WHERE id = ?", detail, subId);
            }
        } catch (Exception e) {
            log.warn("[webhook] outcome update failed: {}", e.getMessage());
        }
    }
}
