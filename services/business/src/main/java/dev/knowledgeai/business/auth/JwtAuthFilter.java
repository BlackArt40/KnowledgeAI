package dev.knowledgeai.business.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.Profile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 认证过滤器：kai-token JWT（Authorization Bearer 或 kai-token Cookie）与
 * API Key（Bearer kai_sk_，手册 4.1/4.4）两条通道。
 * 角色映射：OWNER/ADMIN/EDITOR/VIEWER → ROLE_*；API Key 的 authorities 前缀
 * SCOPE_（scope 守卫用），principal.credentials 携带 ApiKeyRow 供守卫读取。
 * 仅在 pg profile 下加载（无数据库的 M0 形态不装配认证链）。
 */
@Component
@Profile("pg")
public class JwtAuthFilter extends OncePerRequestFilter {

    private final KaiJwtService jwtService;
    private final ApiKeyService apiKeyService;
    private final JtiRevocationService revocation;

    public JwtAuthFilter(KaiJwtService jwtService, ApiKeyService apiKeyService, JtiRevocationService revocation) {
        this.jwtService = jwtService;
        this.apiKeyService = apiKeyService;
        this.revocation = revocation;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String token = bearerToken(request);
        if (token != null && token.startsWith("kai_sk_")) {
            Optional<ApiKeyService.ApiKeyRow> key = apiKeyService.validate(token);
            if (key.isPresent()) {
                ApiKeyService.ApiKeyRow row = key.get();
                // API Key 的用户上下文：id = key.userId（审计/计量可用），scopes 进 authorities
                KaiJwtService.AuthUser principal = new KaiJwtService.AuthUser(
                        row.userId(), row.id() + "@apikey", "API Key " + row.id(), "EDITOR");
                UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                        principal, row, scopesToAuthorities(row));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        } else if (token != null) {
            Optional<KaiJwtService.VerifiedToken> verified = jwtService.verify(token);
            if (verified.isPresent() && !revocation.isRevoked(verified.get().jti())) {
                KaiJwtService.AuthUser user = verified.get().user();
                UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                        user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role().toUpperCase())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        }
        chain.doFilter(request, response);
    }

    private static List<SimpleGrantedAuthority> scopesToAuthorities(ApiKeyService.ApiKeyRow row) {
        if (row.scopes() == null) return List.of();
        return Arrays.stream(row.scopes().replace("[", "").replace("]", "")
                        .replace("\"", "").split(","))
                .map(String::trim).filter(s -> !s.isEmpty())
                .map(s -> new SimpleGrantedAuthority("SCOPE_" + s))
                .toList();
    }

    private String bearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7).trim();
        }
        return null;
    }
}
