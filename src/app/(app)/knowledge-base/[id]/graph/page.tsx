"use client";

// P7-3: KB knowledge-graph page - interactive exploration of extracted
// entities + relations (SVG force layout with drag/zoom/neighbor highlight).

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Network, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KnowledgeGraph, type GraphNodeData, type GraphEdgeData } from "@/components/app/knowledge-graph";

export default function KbGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const [kbId, setKbId] = React.useState<string>("");
  const [kbName, setKbName] = React.useState("");
  const [nodes, setNodes] = React.useState<GraphNodeData[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { id } = await params;
      if (cancelled) return;
      setKbId(id);
      try {
        const res = await fetch(`/api/knowledge-base/${id}/graph`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? t("page.knowledge-graph.s4"));
          return;
        }
        setKbName(data.kb?.name ?? "");
        setNodes(data.nodes ?? []);
        setEdges(data.edges ?? []);
      } catch {
        setError(t("page.knowledge-graph.s4"));
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params, t]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/knowledge-base/${kbId}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("page.knowledge-graph.s0")}
          </Link>
        </Button>
        <h2 className="text-lg font-semibold">{t("page.knowledge-graph.s1")}</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            {kbName || t("page.knowledge-graph.s2")}
          </CardTitle>
          <CardDescription>
            {loading
              ? t("page.knowledge-graph.s3")
              : t("page.knowledge-graph.s5", { nodes: String(nodes.length), edges: String(edges.length) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : nodes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Network className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("page.knowledge-graph.s6")}</p>
              <p className="text-xs text-muted-foreground">{t("page.knowledge-graph.s7")}</p>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/knowledge-base/${kbId}`}>
                  <Loader2 className="mr-1 h-3.5 w-3.5" />
                  {t("page.knowledge-graph.s8")}
                </Link>
              </Button>
            </div>
          ) : (
            <KnowledgeGraph nodes={nodes} edges={edges} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
