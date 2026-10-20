package dev.knowledgeai.business.ratelimit;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 限流过滤器（手册 4.6）：维度与现网 src/proxy.ts 一致 ——
 *   - 已认证（JWT）→ user 维度（RATE_LIMIT_PER_MIN，默认 60）
 *   - 匿名 → ip 维度（RATE_LIMIT_ANON_PER_MIN，默认 20）
 * KB 维度（in-route）在 chat/kb 控制器内执行（现网同理由：filter 读不到路径参数）。
 * 429 响应体携带 dimension + Retry-After；健康端点不限流（探针永不 429）。
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimiter limiter;
    private final int userLimit;
    private final int anonLimit;
    /** 受信代理跳数：XFF 从右往左数，客户端可伪造的左段一律不采信。 */
    private final int trustedProxyHops;
    /** Redis 不可达时置位（就绪探针/监控读取，对齐 rateLimitDegraded 语义）。 */
    private final AtomicBoolean degraded = new AtomicBoolean(false);

    public RateLimitFilter(RateLimiter limiter,
                           @Value("${ratelimit.per-minute:60}") int userLimit,
                           @Value("${ratelimit.anon-per-minute:20}") int anonLimit,
                           @Value("${ratelimit.trusted-proxy-hops:1}") int trustedProxyHops) {
        this.limiter = limiter;
        this.userLimit = userLimit;
        this.anonLimit = anonLimit;
        this.trustedProxyHops = Math.max(1, trustedProxyHops);
    }

    public boolean isDegraded() {
        return degraded.get();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        // 健康探针与登录（anon 档在 401 尝试上不消耗是现网语义——login 保留限流）
        return path.equals("/api/health") || path.equals("/actuator/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        boolean authenticated = auth != null && auth.isAuthenticated()
                && !(auth.getPrincipal() instanceof String) // anonymous token principal 是 "anonymousUser"
                && auth.getPrincipal() instanceof dev.knowledgeai.business.auth.KaiJwtService.AuthUser;

        RateLimiter.Result result;
        String dimension;
        if (authenticated) {
            dev.knowledgeai.business.auth.KaiJwtService.AuthUser user =
                    (dev.knowledgeai.business.auth.KaiJwtService.AuthUser) auth.getPrincipal();
            dimension = "user";
            result = limiter.hit("user:" + user.id(), userLimit);
        } else {
            dimension = "anon";
            result = limiter.hit("anon:" + clientIp(request), anonLimit);
        }
        if (!result.allowed()) {
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.setHeader("Retry-After", String.valueOf(result.retryAfterSeconds()));
            response.getWriter().write("{\"error\":\"请求过于频繁，请稍后重试\",\"dimension\":\"" + dimension + "\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    private String clientIp(HttpServletRequest request) {
        // P2: the leftmost XFF entry is supplied by the client. Use the hop
        // appended by the nearest trusted proxy instead (rightmost), so a
        // spoofed header can't rotate rate-limit buckets.
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] parts = xff.split(",");
            int index = Math.max(0, parts.length - trustedProxyHops);
            String candidate = parts[index].trim();
            if (!candidate.isEmpty()) return candidate;
        }
        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) return realIp.trim();
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }
}
