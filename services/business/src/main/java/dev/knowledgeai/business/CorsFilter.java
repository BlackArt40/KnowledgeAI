package dev.knowledgeai.business;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * CORS（手册 4.6/A4.6）：显式白名单 `CORS_ALLOWED_ORIGINS`（逗号分隔）——
 * 未配置时不发送任何 CORS 头（同现网生产留空语义：同域反代不需要 CORS）；
 * 绝不反射任意 Origin。预检（OPTIONS）放行至本过滤器完成。
 */
@Component
@Order(1)
public class CorsFilter extends OncePerRequestFilter {

    private final List<String> allowedOrigins;

    public CorsFilter(@Value("${cors.allowed-origins:${CORS_ALLOWED_ORIGINS:}}") String allowed) {
        this.allowedOrigins = Arrays.stream(allowed.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return allowedOrigins.isEmpty(); // 未配置 = 无 CORS 头（同域部署）
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String origin = request.getHeader("Origin");
        if (origin != null && allowedOrigins.contains(origin)) {
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Vary", "Origin");
            response.setHeader("Access-Control-Allow-Credentials", "true");
            response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
            response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Trace-Id");
            response.setHeader("Access-Control-Max-Age", "600");
            if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                response.setStatus(204);
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
