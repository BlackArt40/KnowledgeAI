// ---------------------------------------------------------------------------
// Local hashed embedding (no API key required).
// Hybrid tokenizer: latin words + CJK characters + CJK bigrams, hashed into a
// fixed-dimensional vector, L2-normalized. Deterministic & language-agnostic.
//
// 🔌 Integration point: replace `embed` with OpenAI / BGE / m3e embeddings
//    (LangChain `Embeddings` interface) for production-grade retrieval.
// ---------------------------------------------------------------------------

export const DIM = 2048;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  // latin / numeric words
  const words = t.match(/[a-z0-9]+/g);
  if (words) out.push(...words);
  // CJK characters + bigrams
  const cjk = Array.from(t).filter((ch) => /[\u4e00-\u9fff]/.test(ch));
  out.push(...cjk);
  for (let i = 0; i < cjk.length - 1; i++) out.push(cjk[i] + cjk[i + 1]);
  return out;
}

export function embed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const tok of tokenize(text)) v[hashStr(tok) % DIM] += 1;
  let sum = 0;
  for (let i = 0; i < DIM; i++) sum += v[i] * v[i];
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= len;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < DIM; i++) d += a[i] * b[i];
  return d;
}
