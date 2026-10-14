package dev.knowledgeai.business;

import dev.knowledgeai.business.auth.JwtAuthFilter;
import dev.knowledgeai.business.ratelimit.RateLimitFilter;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * 安全配置（M1，pg profile）：无状态 JWT；登录与健康端点匿名，其余 authenticated，
 * 401 响应体对齐现网 {"error":"未登录"}。
 * 默认（无 pg profile 的 M0 形态）没有读路径与身份存储，提供全放行链——该形态
 * 仅用于骨架演示，生产配置必须走 pg profile（ADR-0009 红线：无 DB 无业务）。
 *
 * 注意：JwtAuthFilter / RateLimitFilter 是 @Component OncePerRequestFilter，
 * Boot 会额外把它们注册成全局 Servlet Filter（跑在 Security 链之前，context 被
 * SecurityContextHolderFilter 重置 → 链内跳过 → 恒 401）。必须用
 * FilterRegistrationBean(enabled=false) 关掉全局注册，仅保留链内位置：
 * jwt（设上下文）→ rateLimit（user/anon 维度依赖上下文）。
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final byte[] UNAUTHORIZED_BODY = "{\"error\":\"未登录\"}".getBytes(StandardCharsets.UTF_8);

    @Bean
    @Profile("pg")
    public FilterRegistrationBean<JwtAuthFilter> jwtFilterRegistration(JwtAuthFilter filter) {
        FilterRegistrationBean<JwtAuthFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    @Profile("pg")
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(RateLimitFilter filter) {
        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    @Profile("pg")
    SecurityFilterChain securedChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter, RateLimitFilter rateLimitFilter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // ASYNC（StreamingResponseBody 流式响应）/ ERROR（错误页）
                        // dispatch 不重新授权：异步流执行时 SecurityContext 已出栈，
                        // 二次授权会对已提交的响应抛 AccessDenied
                        .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ASYNC,
                                jakarta.servlet.DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/auth/login", "/api/health", "/api/health/ready", "/actuator/**").permitAll()
                        // 文档分享公开端点（token 即凭证，P4-2 语义）
                        .requestMatchers("/api/share/doc/*").permitAll()
                        // 公开报告（手册 5.4：shareConfig.enabled 门控在控制器内，缺省 403）
                        .requestMatchers("/api/share/report/*").permitAll()
                        // /error 必须放行：错误 dispatch 会重过安全链，否则任何业务
                        // 异常（500/404/405）都会被伪装成 401"未登录"
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setStatus(401);
                            response.setContentType("application/json;charset=UTF-8");
                            response.getOutputStream().write(UNAUTHORIZED_BODY);
                        }))
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(rateLimitFilter, JwtAuthFilter.class);
        return http.build();
    }

    @Bean
    @Profile("!pg")
    SecurityFilterChain skeletonChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }
}
