// ---------------------------------------------------------------------------
// P8 · Email deliver - env-gated provider with a demo fallback.
//
// Real implementation: Resend HTTP API (POST https://api.resend.com/emails,
// zero deps, fetch only) when RESEND_API_KEY + EMAIL_FROM are set. The
// endpoint is a FIXED literal - an env-provided base URL override was
// removed (SSRF hygiene: env values must not reach request URLs).
// Demo fallback: nothing is emailed; the caller (forgot-password route)
// returns the reset link in the response body instead so the flow stays
// usable without an email account. Mirrors the provider pattern used by the
// rest of the app (env check -> real impl -> fallback; registered in
// getProviderStatus()).
// ---------------------------------------------------------------------------

/** True when a real mail transport is configured. */
export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendEmailResult =
  | { ok: true; code?: number }
  | { ok: false; retryable: boolean; reason: string };

/**
 * Generic single-send via Resend. Never throws; the result carries whether
 * the failure is retryable so the queue can decide to back off and retry
 * (network errors / 5xx / 429) or dead-letter immediately (4xx). Used by the
 * button-style templates below; the `email-send` queue handler does ONE call
 * per attempt and lets the job queue provide the retry layer.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    return { ok: false, retryable: false, reason: "邮件服务未配置" };
  }
  // Fixed Resend endpoint (literal) - no env value reaches the request URL.
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });
    if (res.ok) return { ok: true, code: res.status };
    // 429 (rate limited) + 5xx are transient -> retryable. 4xx (bad sender,
    // rejected recipient...) will never succeed on retry -> dead-letter.
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, retryable, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, retryable: true, reason: err instanceof Error ? err.message : "网络错误" };
  }
}

/** Shared email chrome: centered card + footer note. */
function emailFrame(title: string, actions: string[], note: string): string {
  return [
    "<div style=\"font-family:sans-serif;max-width:480px;margin:0 auto\">",
    `<h2 style="color:#4f46e5">${title}</h2>`,
    ...actions,
    `<p style="color:#71717a;font-size:13px">${note}</p>`,
    "</div>",
  ].join("");
}

import { getI18nInstance, normalizeLocale } from "@/lib/i18n/translate";

function buttonLink(url: string, label: string): string {
  return `<p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${label}</a></p>`;
}

/** Send the password-reset email (forgot-password flow). Locale follows the
 *  recipient's stored preference (falls back to zh-CN). */
export function sendResetEmail(to: string, resetUrl: string, locale?: string): Promise<SendEmailResult> {
  const t = getI18nInstance().getFixedT(normalizeLocale(locale));
  return sendEmail(
    to,
    t("email.reset.subject"),
    emailFrame(
      t("email.reset.title"),
      [buttonLink(resetUrl, t("email.reset.action"))],
      t("email.reset.note")
    )
  );
}

/** Send the email-verification email (register flow). */
export function sendVerificationEmail(to: string, verifyUrl: string, locale?: string): Promise<SendEmailResult> {
  const t = getI18nInstance().getFixedT(normalizeLocale(locale));
  return sendEmail(
    to,
    t("email.verify.subject"),
    emailFrame(
      t("email.verify.title"),
      [buttonLink(verifyUrl, t("email.verify.action"))],
      t("email.verify.note")
    )
  );
}