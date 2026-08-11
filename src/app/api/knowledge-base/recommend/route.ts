import { NextResponse } from "next/server";
import { listAllKbs, listDocuments } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// P5-3: GET /api/knowledge-base/recommend?q=&excludeKbId=
// Recommend knowledge bases related to the current conversation question.
// Scoring: overlap of 2-grams between the query and each KB's
// name/description/document names (works for CJK and latin alike), with a
// bonus when the KB name literally contains the query. Workspace-scoped
// (P4-3) + team visibility. Returns top 3, excluding the active KB.
function bigrams(text: string): Set<string> {
  const t = text.toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const excludeKbId = url.searchParams.get("excludeKbId") ?? "";
  if (!q) return NextResponse.json({ recommendations: [] });

  const qB = bigrams(q);
  const qLower = q.toLowerCase();
  const scored: { id: string; name: string; desc: string; score: number; matched: string[] }[] = [];

  for (const kb of listAllKbs(u.workspaceId)) {
    if (kb.id === excludeKbId) continue;
    if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId)) continue;
    const texts: [string, string][] = [[kb.name, "名称"], [kb.desc, "描述"]];
    for (const d of listDocuments(kb.id)) texts.push([d.name, "文档"]);

    let score = 0;
    const matched: string[] = [];
    if (kb.name.toLowerCase().includes(qLower)) score += 10;
    for (const [t, label] of texts) {
      if (!t) continue;
      const overlap = [...bigrams(t)].filter((b) => qB.has(b)).length;
      if (overlap > 0) {
        score += overlap;
        matched.push(label);
      }
    }
    if (score > 0) scored.push({ id: kb.id, name: kb.name, desc: kb.desc, score, matched: [...new Set(matched)] });
  }

  scored.sort((a, b) => b.score - a.score);
  return NextResponse.json({ recommendations: scored.slice(0, 3) });
}
