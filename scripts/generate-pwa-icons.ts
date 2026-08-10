/**
 * P5-1: generate PWA icons (manifest 192/512 + maskable + apple-touch-icon)
 * into public/icons/ using @napi-rs/canvas (already a runtime dependency of
 * the OCR pipeline). Brand gradient + white "K", matching the app's design
 * tokens in globals.css (--brand-from/via/to).
 *
 * Run: npx tsx scripts/generate-pwa-icons.ts
 * The generated PNGs are committed; this script exists so they can be
 * regenerated if the branding changes.
 */
import { createCanvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "icons");

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// globals.css :root brand tokens (light theme)
const FROM = hslToRgb(243, 75, 59);
const VIA = hslToRgb(265, 80, 62);
const TO = hslToRgb(292, 78, 60);

function roundedRect(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Draws the app icon: diagonal brand gradient, white rounded square in the
 * center with a small sparkle, and a bold "K". Content stays inside the
 * center 80% safe zone so the same art works for maskable icons.
 */
function drawIcon(size: number): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `rgb(${FROM.join(",")})`);
  grad.addColorStop(0.5, `rgb(${VIA.join(",")})`);
  grad.addColorStop(1, `rgb(${TO.join(",")})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // White rounded square (maskable-safe: 46% of canvas inside the 80% zone).
  const box = size * 0.46;
  const bx = (size - box) / 2;
  const by = (size - box) / 2;
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = size * 0.03;
  ctx.shadowOffsetY = size * 0.015;
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, bx, by, box, box, box * 0.22);
  ctx.fill();
  ctx.shadowColor = "transparent";

  // Gradient "K" letter on the white tile.
  const letterGrad = ctx.createLinearGradient(bx, by, bx + box, by + box);
  letterGrad.addColorStop(0, `rgb(${FROM.join(",")})`);
  letterGrad.addColorStop(1, `rgb(${TO.join(",")})`);
  ctx.fillStyle = letterGrad;
  ctx.font = `bold ${box * 0.58}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("K", size / 2, size / 2 + box * 0.02);

  return canvas.toBuffer("image/png");
}

mkdirSync(OUT_DIR, { recursive: true });
const targets: [string, number][] = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];
for (const [name, size] of targets) {
  writeFileSync(join(OUT_DIR, name), drawIcon(size));
  console.log(`✓ public/icons/${name} (${size}×${size})`);
}
