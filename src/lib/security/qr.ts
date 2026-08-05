// ---------------------------------------------------------------------------
// QR code rendering for TOTP enrollment.
//
// Renders an otpauth:// URI to a PNG data URL (preferred) or an SVG string
// (fallback) so the user can scan it with Google Authenticator / 1Password /
// Microsoft Authenticator / Authy etc. Uses the `qrcode` package (pure-JS QR
// matrix; PNG encoder works in Node without a native canvas dependency for the
// small sizes TOTP URIs produce).
// ---------------------------------------------------------------------------

import QRCode from "qrcode";

export interface QrRenderResult {
  /** PNG data URL ready for `<img src=...>`. */
  dataUrl: string;
  /** Raw otpauth:// URI (also shown as text fallback). */
  uri: string;
}

/**
 * Render an otpauth:// URI as a scannable QR code (PNG data URL).
 * Falls back to an SVG data URL if the PNG encoder is unavailable.
 */
export async function renderOtpAuthQR(uri: string): Promise<QrRenderResult> {
  const opts = { errorCorrectionLevel: "M" as const, margin: 2, width: 240 };
  try {
    const dataUrl = await QRCode.toDataURL(uri, opts);
    return { dataUrl, uri };
  } catch {
    // Fallback: SVG -> data URL (pure JS, no canvas needed)
    const svg = await QRCode.toString(uri, { ...opts, type: "svg" as const });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
    return { dataUrl, uri };
  }
}
