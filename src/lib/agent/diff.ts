// ---------------------------------------------------------------------------
// Line-level diff via Longest Common Subsequence (LCS).
// Zero dependencies. Used by the report revision history (criterion #3) to
// show what changed between two report versions.
// ---------------------------------------------------------------------------

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  /** 1-indexed line number in the old (left) text for remove/equal, else null. */
  oldNo: number | null;
  /** 1-indexed line number in the new (right) text for add/equal, else null. */
  newNo: number | null;
  text: string;
}

/**
 * Compute a line-level diff between two texts.
 * Returns an ordered list of DiffLine covering both inputs.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;

  // Build LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack to produce the diff.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 0;
  let newNo = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      oldNo++; newNo++;
      out.push({ op: "equal", oldNo, newNo, text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      oldNo++;
      out.push({ op: "remove", oldNo, newNo: null, text: a[i] });
      i++;
    } else {
      newNo++;
      out.push({ op: "add", oldNo: null, newNo, text: b[j] });
      j++;
    }
  }
  while (i < m) {
    oldNo++;
    out.push({ op: "remove", oldNo, newNo: null, text: a[i] });
    i++;
  }
  while (j < n) {
    newNo++;
    out.push({ op: "add", oldNo: null, newNo, text: b[j] });
    j++;
  }
  return out;
}

/** Summary of a diff: counts of added / removed / unchanged lines. */
export function diffSummary(diff: DiffLine[]): { added: number; removed: number; unchanged: number } {
  let added = 0, removed = 0, unchanged = 0;
  for (const d of diff) {
    if (d.op === "add") added++;
    else if (d.op === "remove") removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}
