package dev.knowledgeai.business.auth;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * 登录失败锁定（手册 4.1）：同邮箱 5 次失败 → 锁定 15 分钟（对齐现网
 * admin store 的 "账户已被暂时锁定，请 15 分钟后重试" 语义；现网该状态
 * 在进程内存，本实现保持同形 —— 多副本各计数与现网一致）。
 */
@Service
public class LoginLockoutService {

    private static final int MAX_FAILURES = 5;
    private static final long LOCK_MILLIS = 15 * 60_000L;

    private record Attempt(int failures, long lockedUntil) {
    }

    private final Map<String, Attempt> attempts = new ConcurrentHashMap<>();

    /** 是否处于锁定窗口内。 */
    public boolean isLocked(String email) {
        Attempt a = attempts.get(email.toLowerCase());
        if (a == null) return false;
        if (a.lockedUntil() > 0 && System.currentTimeMillis() < a.lockedUntil()) return true;
        if (a.lockedUntil() > 0) attempts.remove(email.toLowerCase()); // 锁定过期
        return false;
    }

    public long remainingLockSeconds(String email) {
        Attempt a = attempts.get(email.toLowerCase());
        if (a == null || a.lockedUntil() <= 0) return 0;
        return Math.max(0, (a.lockedUntil() - System.currentTimeMillis()) / 1000);
    }

    /** 登录失败：累计；达阈值进入锁定窗口。 */
    public void recordFailure(String email) {
        String key = email.toLowerCase();
        attempts.compute(key, (k, prev) -> {
            int failures = (prev == null ? 0 : prev.failures()) + 1;
            if (failures >= MAX_FAILURES) {
                return new Attempt(0, System.currentTimeMillis() + LOCK_MILLIS);
            }
            return new Attempt(failures, 0);
        });
    }

    /** 登录成功：清零。 */
    public void recordSuccess(String email) {
        attempts.remove(email.toLowerCase());
    }
}
