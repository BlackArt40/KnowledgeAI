package dev.knowledgeai.business.tenant;

import dev.knowledgeai.business.auth.KaiJwtService;
import dev.knowledgeai.business.auth.UserRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * KB 元数据只读切片（工作包 4.2 / 4.3，M1）。仅在 pg profile 下加载。
 *
 * 租户语义与现网对齐（ADR-0003）：KB 归属 workspace，用户经 Workspace.members
 * 归属 workspace；列表强制 workspace 过滤（越权恒空列表，与 AI 服务侧双匹配一致）。
 * RBAC：M1 只读路径对所有角色开放；写路径的角色守卫随 4.3 写接口在 M2 引入。
 */
@RestController
@Profile("pg")
public class KbController {

    private final JdbcTemplate jdbc;
    private final UserRepository users;

    public KbController(JdbcTemplate jdbc, UserRepository users) {
        this.jdbc = jdbc;
        this.users = users;
    }

    @GetMapping("/api/v1/knowledge-bases")
    public Map<String, Object> list(Authentication authentication) {
        String scopeDenial = dev.knowledgeai.business.auth.ApiKeyService.scopeDenied(authentication, "kb:read");
        if (scopeDenial != null) {
            return Map.of("error", scopeDenial);
        }
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        String workspaceId = users.findWorkspaceIdByUserId(user.id());

        List<Map<String, Object>> kbs = jdbc.query(
                "SELECT id, name, \"desc\", \"color\", \"initial\", \"ownerId\", \"workspaceId\" "
                        + "FROM \"KnowledgeBase\" WHERE \"workspaceId\" = ? ORDER BY \"createdAt\" DESC",
                (rs, n) -> {
                    Map<String, Object> kb = new LinkedHashMap<>();
                    kb.put("id", rs.getString("id"));
                    kb.put("name", rs.getString("name"));
                    kb.put("desc", rs.getString("desc"));
                    kb.put("color", rs.getString("color"));
                    kb.put("initial", rs.getString("initial"));
                    kb.put("ownerId", rs.getString("ownerId"));
                    kb.put("workspaceId", rs.getString("workspaceId"));
                    return kb;
                },
                workspaceId);
        return Map.of("kbs", kbs, "workspaceId", workspaceId);
    }
}
