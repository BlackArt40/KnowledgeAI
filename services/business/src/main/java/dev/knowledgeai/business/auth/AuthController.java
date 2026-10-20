package dev.knowledgeai.business.auth;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 登录与当前用户（工作包 4.1，M1 最小切片）。
 * 仅在 pg profile 下加载（读路径依赖 DB）。
 *
 * 与现网 POST /api/auth/login 的契约对齐（src/app/api/auth/login/route.ts）：
 *   200 { user: {id,email,name,role}, token } + Set-Cookie kai-token（7 天）
 *   401 { "error": "邮箱或密码不正确" }
 * M1 未迁的现网分支（后续里程碑补齐）：2FA 强制注册（pre-auth token）、
 * 失败锁定（15 分钟窗口）、登录历史/审计/安全通知（依赖通知与审计存储）。
 */
@RestController
@Profile("pg")
public class AuthController {

    /** 原子地“认领”一个 TOTP 时步：仅当 step > 已记录的 step 时成功。
     *  Redis 不可用时返回失败（登录的 secret 读取同样依赖 Redis，属 fail-closed）。 */
    private static final DefaultRedisScript<Long> CLAIM_TOTP_STEP = new DefaultRedisScript<>(
            "local last = tonumber(redis.call('GET', KEYS[1]) or '0')\n"
                    + "if tonumber(ARGV[1]) <= last then return 0 end\n"
                    + "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])\n"
                    + "return 1",
            Long.class);

    private final UserRepository users;
    private final Pbkdf2PasswordService passwords;
    private final KaiJwtService jwtService;
    private final LoginLockoutService lockout;
    private final JtiRevocationService revocation;
    private final TotpService totp;
    private final org.springframework.data.redis.core.StringRedisTemplate redisTemplate;
    private final dev.knowledgeai.business.audit.AuditService audit;
    private final boolean cookieSecure;

    public AuthController(UserRepository users, Pbkdf2PasswordService passwords, KaiJwtService jwtService,
                          LoginLockoutService lockout, JtiRevocationService revocation, TotpService totp,
                          org.springframework.data.redis.core.StringRedisTemplate redisTemplate,
                          dev.knowledgeai.business.audit.AuditService audit,
                          @org.springframework.beans.factory.annotation.Value("${auth.cookie-secure:false}")
                          boolean cookieSecure) {
        this.users = users;
        this.passwords = passwords;
        this.jwtService = jwtService;
        this.lockout = lockout;
        this.revocation = revocation;
        this.totp = totp;
        this.redisTemplate = redisTemplate;
        this.audit = audit;
        this.cookieSecure = cookieSecure;
    }

    public record LoginRequest(String email, String password, String totpCode) {
    }

    @PostMapping("/api/auth/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody LoginRequest body) {
        if (body == null || body.email() == null || body.password() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "邮箱和密码必填"));
        }
        String email = body.email().trim().toLowerCase();
        // 手册 4.1：失败锁定（5 次 → 15 分钟，与现网 admin store 语义一致）
        if (lockout.isLocked(email)) {
            audit.recordAudit(null, email, "auth.login_locked", email, "锁定窗口内登录尝试", null);
            return ResponseEntity.status(429).body(Map.of(
                    "error", "账户已被暂时锁定，请 15 分钟后重试",
                    "locked", true,
                    "remainingSeconds", lockout.remainingLockSeconds(email)));
        }
        Optional<UserRepository.UserRow> found = users.findByEmail(email);
        if (found.isEmpty() || found.get().passwordHash() == null
                || !passwords.verify(body.password(), found.get().passwordHash())) {
            lockout.recordFailure(email);
            audit.recordLogin(found.map(UserRepository.UserRow::id).orElse(""), "api", "unknown", false);
            audit.recordAudit(found.map(UserRepository.UserRow::id).orElse(null), email,
                    "auth.login_failed", email, "密码错误或用户不存在", null);
            return ResponseEntity.status(401).body(Map.of("error", "邮箱或密码不正确"));
        }
        UserRepository.UserRow user = found.get();

        // 2FA（手册 4.1，对齐现网 login route 分支形状）：
        //   twoFactorEnabled=true 且未带 totpCode → 401 requires2FA
        //   totpCode 错误 → 401（同时计一次失败）
        //   TOTP secret 存储属运行时管理状态（现网在 admin store 内存中）——
        //   业务侧从 Redis `2fa:secret:{userId}` 读取，管理员设置写入点待接（M3+）
        boolean twoFactorEnabled = users.isTwoFactorEnabled(user.id());
        if (twoFactorEnabled) {
            String totpCode = body.totpCode() == null ? "" : body.totpCode().trim();
            // TOTP secret 属运行时管理状态（现网在 admin store 内存中）——业务侧
            // 从 Redis `2fa:secret:{userId}` 读取，管理员设置写入点待接（M3+）
            String secret = redisGet("2fa:secret:" + user.id());
            if (totpCode.isEmpty()) {
                return ResponseEntity.status(401).body(Map.of(
                        "requires2FA", true, "message", "请输入两步验证码"));
            }
            OptionalLong matchedStep = secret.isEmpty()
                    ? OptionalLong.empty()
                    : totp.verifyStep(secret, totpCode, System.currentTimeMillis() / 1000);
            // Reject a code whose time step was already consumed: the ±1 step
            // tolerance otherwise makes the same 6-digit code reusable for ~90s.
            if (matchedStep.isEmpty() || !claimTotpStep(user.id(), matchedStep.getAsLong())) {
                lockout.recordFailure(email);
                return ResponseEntity.status(401).body(Map.of("error", "两步验证码不正确"));
            }
        }

        String jti = KaiJwtService.randomJti();
        KaiJwtService.AuthUser authUser =
                new KaiJwtService.AuthUser(user.id(), user.email(), user.name(), user.role());
        String token = jwtService.sign(authUser, 7 * 86400L, jti);
        revocation.register(user.id(), jti);
        lockout.recordSuccess(email);
        audit.recordLogin(user.id(), "api", "unknown", true);
        audit.recordAudit(user.id(), user.email(), "auth.login", user.id(), "登录成功", null);
        // 6.1：Cookie Secure 经 COOKIE_SECURE 环境变量（生产=true，本地 http 部署=false）；
        // SameSite=Lax 同域反代形态（手册 6.1 推荐继续同域，Cookie 不跨域）
        ResponseCookie cookie = ResponseCookie.from("kai-token", token)
                .httpOnly(true)
                .sameSite("Lax")
                .secure(cookieSecure)
                .path("/")
                .maxAge(7 * 86400)
                .build();
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("user", sanitize(user));
        res.put("token", token);
        return ResponseEntity.ok()
                .header("Set-Cookie", cookie.toString())
                .body(res);
    }

    private String redisGet(String key) {
        try {
            return redisTemplate.opsForValue().get(key);
        } catch (Exception e) {
            return "";
        }
    }

    private boolean claimTotpStep(String userId, long step) {
        try {
            Long accepted = redisTemplate.execute(
                    CLAIM_TOTP_STEP,
                    List.of("2fa:laststep:" + userId),
                    Long.toString(step), "300");
            return accepted != null && accepted == 1L;
        } catch (Exception e) {
            return false;
        }
    }

    /** GET /api/auth/me —— 401 形状由 SecurityConfig 统一（{"error":"未登录"}）。 */
    @GetMapping("/api/auth/me")
    public Map<String, Object> me(Authentication authentication) {
        KaiJwtService.AuthUser user = (KaiJwtService.AuthUser) authentication.getPrincipal();
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("user", Map.of("id", user.id(), "email", user.email(), "name", user.name(), "role", user.role()));
        return res;
    }

    private static Map<String, Object> sanitize(UserRepository.UserRow user) {
        // 对齐现网 sanitize：不回传 passwordHash 等敏感列
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("id", user.id());
        res.put("email", user.email());
        res.put("name", user.name());
        res.put("role", user.role());
        res.put("plan", user.plan());
        return res;
    }
}
