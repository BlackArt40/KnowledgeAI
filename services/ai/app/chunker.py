# ---------------------------------------------------------------------------
# 智能切片 - TS src/lib/rag/chunker.ts 的 Python 移植（阶段 1 对齐核心语义）：
#   1. Markdown 标题感知（# / ## / ### 分节，保留层级路径前缀 "[A > B]"）
#   2. 表格 / 代码块不跨块切断
#   3. 密度动态 chunk 大小（稠密变小、稀疏变大）
#   4. 回退：字符窗口 + overlap，优先在换行边界断开
# 未移植（显式限制）：parent-child 策略（PARENT_CHILD_CHUNKING，默认关闭）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ChunkResult:
    text: str
    section_path: List[str] = field(default_factory=list)


@dataclass
class _Block:
    type: str  # heading | code | table | text
    text: str
    level: int = 0


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    return [
        c.text
        for c in smart_chunk(text, chunk_size, chunk_overlap, add_section_prefix=True, dynamic=True)
    ]


def smart_chunk(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
    add_section_prefix: bool = True,
    dynamic: bool = True,
) -> List[ChunkResult]:
    clean = text.replace("\r\n", "\n").strip()
    if not clean:
        return []

    has_headings = re.search(r"^#{1,6}\s+", clean, re.M) is not None
    has_tables = re.search(r"\|.*\|[\s\S]*?\n\|[-:|\s]+\|", clean) is not None
    has_code = re.search(r"```[\s\S]*?```", clean) is not None

    if has_headings or has_tables or has_code:
        return _structured_chunk(clean, chunk_size, chunk_overlap, add_section_prefix, dynamic)

    return [ChunkResult(text=t, section_path=[]) for t in _character_chunk(clean, chunk_size, chunk_overlap)]


# ── 密度动态 chunk 大小 ───────────────────────────────────────────────────

def compute_density(text: str) -> float:
    lines = text.split("\n")
    structural = sum(
        1
        for line in lines
        if line.strip().startswith("|") or line.strip().startswith("```") or re.match(r"^\s{4,}", line)
    )
    structural_ratio = structural / len(lines) if lines else 0.0
    sentences = [s for s in re.split(r"[.。!！?？\n]+", text) if s.strip() and len(s.strip()) > 10]
    avg_sent_len = (len(text) / len(sentences)) if sentences else 50.0
    sentence_density = min(1.0, avg_sent_len / 200.0)
    return min(1.0, structural_ratio * 0.6 + sentence_density * 0.4)


def dynamic_chunk_size(base_size: int, density: float) -> int:
    if density > 0.6:
        return round(base_size * 0.7)
    if density < 0.3:
        return round(base_size * 1.3)
    return base_size


# ── 结构化切片（Markdown 感知）───────────────────────────────────────────

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)")
_TABLE_SEP_RE = re.compile(r"^\|[-:|\s]+")


def _split_into_blocks(text: str) -> List[_Block]:
    blocks: List[_Block] = []
    lines = text.split("\n")
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]

        if line.strip().startswith("```"):
            start = i
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                i += 1
            i += 1  # 含收尾 ```
            blocks.append(_Block(type="code", text="\n".join(lines[start:i])))
            continue

        m = _HEADING_RE.match(line)
        if m:
            blocks.append(_Block(type="heading", text=line, level=len(m.group(1))))
            i += 1
            continue

        if line.strip().startswith("|") and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1]):
            start = i
            i += 2  # 表头 + 分隔行
            while i < n and lines[i].strip().startswith("|"):
                i += 1
            blocks.append(_Block(type="table", text="\n".join(lines[start:i])))
            continue

        text_lines: List[str] = []
        while (
            i < n
            and not lines[i].strip().startswith("```")
            and not _HEADING_RE.match(lines[i])
            and not (lines[i].strip().startswith("|") and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1]))
        ):
            text_lines.append(lines[i])
            i += 1
        if text_lines:
            blocks.append(_Block(type="text", text="\n".join(text_lines)))

    return blocks


def _finalize(text: str, section_path: List[str], add_prefix: bool) -> ChunkResult:
    final = text.strip()
    if add_prefix and section_path:
        prefix = " > ".join(section_path)
        if not final.startswith(prefix):
            final = f"[{prefix}]\n{final}"
    return ChunkResult(text=final, section_path=list(section_path))


def _structured_chunk(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
    add_section_prefix: bool,
    dynamic: bool,
) -> List[ChunkResult]:
    results: List[ChunkResult] = []
    section_stack: List[str] = []
    blocks = _split_into_blocks(text)

    current = ""
    current_path: List[str] = []

    for block in blocks:
        eff = dynamic_chunk_size(chunk_size, compute_density(block.text)) if dynamic else chunk_size

        if block.type == "heading":
            title = re.sub(r"^#+\s*", "", block.text).strip()
            level = block.level
            del section_stack[max(0, level - 1):]
            section_stack.append(title)
            current_path = list(section_stack)

            heading_line = f"{'#' * level} {title}\n"
            if current and len(current) + len(heading_line) > eff:
                results.append(_finalize(current, current_path, add_section_prefix))
                current = ""
            current += heading_line
            continue

        if block.type in ("code", "table"):
            block_text = block.text + "\n"
            if current and len(current) + len(block_text) > eff:
                results.append(_finalize(current, current_path, add_section_prefix))
                current = ""
            current += block_text
            continue

        if len(block.text) > eff:
            if current.strip():
                results.append(_finalize(current, current_path, add_section_prefix))
                current = ""
            for sub in _character_chunk(block.text, eff, chunk_overlap):
                results.append(_finalize(sub, current_path, add_section_prefix))
        else:
            if current and len(current) + len(block.text) + 1 > eff:
                results.append(_finalize(current, current_path, add_section_prefix))
                current = block.text
            else:
                current += ("\n" if current else "") + block.text

    if current.strip():
        results.append(_finalize(current, current_path, add_section_prefix))

    return results if results else [ChunkResult(text=text, section_path=[])]


# ── 字符窗口回退 ──────────────────────────────────────────────────────────

def _character_chunk(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    clean = text.replace("\r\n", "\n").strip()
    if len(clean) <= chunk_size:
        return [clean] if clean else []

    step = max(1, chunk_size - chunk_overlap)
    chunks: List[str] = []
    i = 0
    while i < len(clean):
        end = min(i + chunk_size, len(clean))
        if end < len(clean):
            boundary = clean.rfind("\n", i, end)
            if boundary > i + chunk_size * 0.5:
                end = boundary
        chunk = clean[i:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(clean):
            break
        i += step
    return chunks
