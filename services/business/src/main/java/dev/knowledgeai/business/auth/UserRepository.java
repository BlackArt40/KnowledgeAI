package dev.knowledgeai.business.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 用户表访问（只读，M1）。表结构与列名以 Prisma migration 生成物为准
 * （Prisma 默认表名/列名保留大小写 —— SQL 中必须带双引号），Flyway baseline
 * 策略见 ADR-0009 决策 1。红线（ADR-0009 决策 4）：读路径只走 DB，无内存缓存。
 * 仅在 pg profile 下加载（无数据库的 M0 形态不装配读路径）。
 */
@Repository
@Profile("pg")
public class UserRepository {

    private final JdbcTemplate jdbc;

    public UserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record UserRow(
            String id, String email, String name, String passwordHash,
            String role, String status, String plan) {
    }

    public Optional<UserRow> findByEmail(String email) {
        List<UserRow> rows = jdbc.query(
                "SELECT id, email, name, \"passwordHash\", role::text, status::text, plan "
                        + "FROM \"User\" WHERE email = ?",
                (rs, n) -> new UserRow(
                        rs.getString("id"), rs.getString("email"), rs.getString("name"),
                        rs.getString("passwordHash"), rs.getString("role"),
                        rs.getString("status"), rs.getString("plan")),
                email);
        return rows.stream().findFirst();
    }

    public boolean isTwoFactorEnabled(String userId) {
        List<Boolean> rows = jdbc.query(
                "SELECT \"twoFactorEnabled\" FROM \"User\" WHERE id = ?",
                (rs, n) -> rs.getBoolean(1), userId);
        return !rows.isEmpty() && Boolean.TRUE.equals(rows.get(0));
    }

    /** 解析用户当前 workspace（对齐现网 getRequestUser 语义，src/lib/auth/guard.ts）：
     *  Workspace.members 包含 userId 的第一行；查不到 → 回退默认租户 ws_default
     *  （与现网 cookie 缺失时的 fallback 一致——seed 数据未写 Workspace 行时仍可读）。
     *  多 workspace 的 kai-workspace cookie 选择逻辑随 M3 的会话切换一起迁移。 */
    public String findWorkspaceIdByUserId(String userId) {
        List<String> ids = jdbc.query(
                "SELECT id FROM \"Workspace\" WHERE members @> ?::text[] LIMIT 1",
                (rs, n) -> rs.getString(1),
                "{\"" + userId + "\"}");
        return ids.isEmpty() ? "ws_default" : ids.get(0);
    }
}
