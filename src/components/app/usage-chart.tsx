import * as React from "react";

const DEFAULT_DATA = [18, 24, 16, 31, 28, 42, 35, 38, 30, 52, 46, 40, 58, 49];
const DEFAULT_LABELS = ["", "一", "", "三", "", "五", "", "日", "", "二", "", "四", "", "六"];

export function UsageChart({ data = DEFAULT_DATA, labels = DEFAULT_LABELS }: { data?: number[]; labels?: string[] }) {
  const w = 640;
  const h = 220;
  const pad = { top: 16, right: 12, bottom: 24, left: 12 };
  const rawMax = Math.max(...data);
  // Guard against an all-zero series (e.g. a new user with no questions yet):
  // avoid 0/0 -> NaN by falling back to 1 so the line sits flat at the bottom.
  const max = (rawMax > 0 ? rawMax : 1) * 1.15;
  const stepX = (w - pad.left - pad.right) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad.left + i * stepX;
    const y = h - pad.bottom - (v / max) * (h - pad.top - pad.bottom);
    return [x, y] as const;
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(1)} ${h - pad.bottom} L ${points[0][0].toFixed(1)} ${h - pad.bottom} Z`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[220px] w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* grid */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={pad.left}
            x2={w - pad.right}
            y1={pad.top + g * (h - pad.top - pad.bottom)}
            y2={pad.top + g * (h - pad.top - pad.bottom)}
            stroke="hsl(var(--border))"
            strokeDasharray="4 6"
          />
        ))}

        <path d={areaPath} fill="url(#usageFill)" />
        <path
          d={linePath}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={i === points.length - 1 ? 4.5 : 0}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--card))"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-2 text-[11px] text-muted-foreground">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}
