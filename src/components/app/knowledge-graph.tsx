"use client";

// P7-3 knowledge-graph visualization - SVG rendering + interactions on top
// of the d3-force layout (src/lib/kg/layout.ts; the physics engine was
// replaced by d3-force in 2026-08, P7-5). Repulsion + spring forces, drag,
// wheel zoom, click to highlight neighbors with a detail panel. Nodes are
// capped for performance.

import * as React from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  computeGraphLayout,
  type GraphNodeData,
  type GraphEdgeData,
} from "@/lib/kg/layout";

export type { GraphNodeData, GraphEdgeData };

// P1-2: 图表颜色改为语义令牌(Tailwind fill/stroke/bg 工具类)。令牌自身的
// 暗色/高对比覆盖会自动翻转(如 --success 浅色 32% ↔ 暗色 50%),因此实体色、
// 连线、标签在两种主题与高对比模式下都保持可读,无需 dark: 变体。
// 注意:类名必须是完整字面量,否则 Tailwind JIT 不会生成对应样式。
const TYPE_FILL: Record<string, string> = {
  person: "fill-primary",
  organization: "fill-success",
  concept: "fill-warning",
  event: "fill-destructive",
};
const TYPE_DOT: Record<string, string> = {
  person: "bg-primary",
  organization: "bg-success",
  concept: "bg-warning",
  event: "bg-destructive",
};

const TYPE_KEYS: Record<string, string> = {
  person: "page.knowledge-graph.s12",
  organization: "page.knowledge-graph.s13",
  concept: "page.knowledge-graph.s14",
  event: "page.knowledge-graph.s15",
};

export function KnowledgeGraph({
  nodes,
  edges,
}: {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}) {
  const t = useT();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });

  // ── force layout (d3-force, computed once per data snapshot) ────────────
  const layout = React.useMemo(() => computeGraphLayout(nodes, edges), [nodes, edges]);

  // ── interactions ────────────────────────────────────────────────────────
  // edges reference entity LABELS - resolve the selected node's label first
  const selectedLabel = layout.nodes.find((n) => n.id === selected)?.label;
  const neighbors = React.useMemo(() => {
    if (!selectedLabel) return new Set<string>();
    const set = new Set<string>();
    for (const e of layout.edges) {
      if (e.source === selectedLabel) set.add(e.target);
      if (e.target === selectedLabel) set.add(e.source);
    }
    return set;
  }, [selectedLabel, layout]);

  const selectedNode = layout.nodes.find((n) => n.id === selected);
  const connectedEdges = React.useMemo(() => {
    if (!selectedLabel) return new Set<string>();
    return new Set(layout.edges.filter((e) => e.source === selectedLabel || e.target === selectedLabel).map((e) => e.id));
  }, [selectedLabel, layout]);

  const dragRef = React.useRef<{ id: string; dx: number; dy: number } | null>(null);

  function onPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    const svg = (e.currentTarget as SVGCircleElement).ownerSVGElement?.getBoundingClientRect();
    if (!svg) return;
    dragRef.current = {
      id,
      dx: (e.clientX - svg.left - pan.x) / zoom - (layout.nodes.find((n) => n.id === id)?.x ?? 0),
      dy: (e.clientY - svg.top - pan.y) / zoom - (layout.nodes.find((n) => n.id === id)?.y ?? 0),
    };
    setSelected(id);
    (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = (e.currentTarget as SVGCircleElement).ownerSVGElement?.getBoundingClientRect();
    if (!svg) return;
    const node = layout.nodes.find((n) => n.id === drag.id);
    if (!node) return;
    node.x = (e.clientX - svg.left - pan.x) / zoom - drag.dx;
    node.y = (e.clientY - svg.top - pan.y) / zoom - drag.dy;
  }

  function onWheel(e: React.WheelEvent) {
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(3, Math.max(0.4, z * factor)));
  }

  const radiusOf = (mentions: number) => Math.max(7, Math.min(22, 6 + Math.sqrt(mentions) * 2.2));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TYPE_KEYS).map(([type, key]) => (
            <Badge key={type} variant="outline" className="gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", TYPE_DOT[type])} />
              {t(key)}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z * 1.25))} title={t("page.knowledge-graph.s9")}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))} title={t("page.knowledge-graph.s10")}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title={t("page.knowledge-graph.s11")}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <svg
          viewBox="0 0 900 560"
          className="h-[420px] w-full cursor-grab touch-none select-none sm:h-[520px]"
          onWheel={onWheel}
          onPointerMove={onPointerMove}
          onPointerUp={() => { dragRef.current = null; }}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {layout.edges.map((e) => {
              const a = layout.nodes.find((n) => n.label === e.source);
              const b = layout.nodes.find((n) => n.label === e.target);
              if (!a || !b) return null;
              const active = selected && connectedEdges.has(e.id);
              return (
                <line
                  key={e.id}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className={active ? "stroke-primary" : "stroke-border/80"}
                  strokeWidth={active ? 2.5 : Math.min(3, 0.6 + e.weight * 0.5)}
                  opacity={active ? 1 : selected ? 0.12 : 0.35}
                />
              );
            })}
            {layout.nodes.map((n) => {
              const isSel = n.id === selected;
              const isNeighbor = !!selected && neighbors.has(n.id);
              const dim = !!selected && !isSel && !isNeighbor;
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  className="cursor-pointer"
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                  onClick={() => setSelected(n.id)}
                >
                  <circle
                    r={radiusOf(n.mentions) + 3}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={isSel ? 2.5 : 0}
                  />
                  <circle
                    r={radiusOf(n.mentions)}
                    className={cn(TYPE_FILL[n.type] ?? "fill-border", isSel ? "stroke-primary" : "stroke-border")}
                    fillOpacity={dim ? 0.2 : isNeighbor ? 0.9 : 0.75}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text
                    textAnchor="middle"
                    dy={radiusOf(n.mentions) + 12}
                    fontSize={n.label.length > 8 ? 9 : 11}
                    className={dim ? "fill-muted-foreground" : "fill-foreground"}
                    style={{ pointerEvents: "none" }}
                  >
                    {n.label.length > 14 ? n.label.slice(0, 13) + "…" : n.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {selectedNode && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", TYPE_DOT[selectedNode.type] ?? "bg-border")} />
            <span className="font-medium">{selectedNode.label}</span>
            <Badge variant="secondary" className="text-xs">{t(TYPE_KEYS[selectedNode.type] ?? "page.knowledge-graph.s16")}</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("page.knowledge-graph.s17", { mentions: String(selectedNode.mentions), docs: String(selectedNode.docCount), neighbors: String(neighbors.size) })}
          </p>
          {neighbors.size > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[...neighbors].slice(0, 12).map((nid) => {
                const nb = layout.nodes.find((n) => n.label === nid);
                return nb ? (
                  <button
                    key={nid}
                    className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                    onClick={() => setSelected(nid)}
                  >
                    {nb.label}
                  </button>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
