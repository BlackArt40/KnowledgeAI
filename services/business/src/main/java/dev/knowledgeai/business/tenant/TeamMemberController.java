package dev.knowledgeai.business.tenant;

import dev.knowledgeai.business.audit.AuditService;
import dev.knowledgeai.business.auth.KaiJwtService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 团队成员与角色（手册 4.2，P4-2 语义迁移）：
 *   GET   /api/v1/team/members               → 成员列表（任意认证用户）
 *   PATCH /api/v1/team/members/{userId}      → 角色变更（OWNER/ADMIN；角色矩阵
 *     OWNER/ADMIN/EDITOR/VIEWER；kai-workspace 语义下的 per-KB 角色覆盖
 *     （Team.kbMemberRoles）随多 workspace 会话切换在 M3+ 迁移）。
 * 角色变更写 SecurityAudit（对齐现网 recordAudit kb.access_change 语义）。
 */
@RestController
@Profile("pg")
public class TeamMemberController {

    private static final List<String> ROLES = List.of("OWNER", "ADMIN", "EDITOR", "VIEWER");

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public TeamMemberController(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping("/api/v1/team/members")
    public Map<String, Object> list(Authentication authentication) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        List<Map<String, Object>> members = jdbc.query(
                "SELECT tm.\"userId\", u.email, u.name, tm.role::text, tm.\"joinedAt\" "
                        + "FROM \"TeamMember\" tm JOIN \"User\" u ON tm.\"userId\" = u.id "
                        + "ORDER BY tm.\"joinedAt\"",
                (rs, n) -> Map.<String, Object>of(
                        "userId", rs.getString(1), "email", rs.getString(2),
                        "name", rs.getString(3), "role", rs.getString(4)));
        return Map.of("members", members, "requester", user.id());
    }

    public record PatchRoleRequest(String role) {
    }

    @PatchMapping("/api/v1/team/members/{userId}")
    public ResponseEntity<Map<String, Object>> patchRole(Authentication authentication,
                                                         @PathVariable String userId,
                                                         @RequestBody PatchRoleRequest body) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        if (!List.of("OWNER", "ADMIN").contains(user.role().toUpperCase())) {
            return ResponseEntity.status(403).body(Map.of("error", "仅 OWNER/ADMIN 可变更角色"));
        }
        if (body == null || body.role() == null || !ROLES.contains(body.role().toUpperCase())) {
            return ResponseEntity.badRequest().body(Map.of("error", "角色必须是 OWNER/ADMIN/EDITOR/VIEWER"));
        }
        int updated = jdbc.update(
                "UPDATE \"TeamMember\" SET role = ?::\"Role\" WHERE \"userId\" = ?",
                body.role().toUpperCase(), userId);
        if (updated == 0) {
            return ResponseEntity.status(404).body(Map.of("error", "成员不存在"));
        }
        audit.recordAudit(user.id(), user.email(), "team.role_change", userId,
                "role=" + body.role().toUpperCase(), null);
        return ResponseEntity.ok(Map.of("userId", userId, "role", body.role().toUpperCase()));
    }
}
