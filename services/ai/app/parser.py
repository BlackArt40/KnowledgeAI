# ---------------------------------------------------------------------------
# 文档解析（阶段 1 范围，对齐 TS parser.ts 的格式集合）：
#   1a: markdown / text / csv / subtitle(srt,vtt) / html
#   1a（可选依赖）: pdf(pypdf) / word(python-docx) / excel(openpyxl)
#   1b（未迁移，明确报错）: OCR / PPT
# 解析失败抛 ParseError(code, message)，message 已脱敏（只含格式信息，不含内容）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import csv
import io
import re
from html.parser import HTMLParser
from typing import Tuple


class ParseError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


_TEXT_EXT = {".md", ".markdown", ".txt", ".csv", ".tsv", ".log", ".srt", ".vtt", ".json"}
_HTML_EXT = {".html", ".htm"}
_PDF_EXT = {".pdf"}
_WORD_EXT = {".docx"}
_EXCEL_EXT = {".xlsx", ".xlsm"}
_UNANSWERED_EXT = {".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


class _HTMLTextExtractor(HTMLParser):
    _SKIP = {"script", "style", "head"}

    def __init__(self) -> None:
        super().__init__()
        self._parts: list = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self._parts.append(data)

    def text(self) -> str:
        raw = "".join(self._parts)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()


def _parse_html(data: bytes) -> str:
    ex = _HTMLTextExtractor()
    ex.feed(_decode(data))
    return ex.text()


def _parse_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise ParseError("unsupported_format", "PDF 解析依赖未安装（pypdf）") from e
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages]
    except Exception as e:
        raise ParseError("parse_error", "PDF 解析失败（可能为扫描件，OCR 属迭代 1b）") from e
    return "\n\n".join(p for p in pages if p).strip()


def _parse_docx(data: bytes) -> str:
    try:
        import docx
    except ImportError as e:
        raise ParseError("unsupported_format", "Word 解析依赖未安装（python-docx）") from e
    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as e:
        raise ParseError("parse_error", "Word 解析失败") from e
    parts = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append("| " + " | ".join(cells) + " |")
    return "\n".join(parts).strip()


def _parse_xlsx(data: bytes) -> str:
    try:
        import openpyxl
    except ImportError as e:
        raise ParseError("unsupported_format", "Excel 解析依赖未安装（openpyxl）") from e
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as e:
        raise ParseError("parse_error", "Excel 解析失败") from e
    lines: list = []
    for ws in wb.worksheets:
        lines.append(f"## {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                lines.append(", ".join(cells))
    return "\n".join(lines).strip()


def _parse_csv_structured(data: bytes) -> str:
    """CSV 保留原始文本，但做一次合法性嗅探（TS 侧同样按文本处理）。"""
    return _decode(data).strip()


def extract_text(filename: str, mime: str, data: bytes) -> Tuple[str, str]:
    """返回 (text, doc_type)。不支持的格式抛 ParseError('unsupported_format')。"""
    name = (filename or "").lower()
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    m = (mime or "").lower()

    if ext in _PDF_EXT or "pdf" in m:
        return _parse_pdf(data), "pdf"
    if ext in _WORD_EXT or "wordprocessingml" in m:
        return _parse_docx(data), "word"
    if ext in _EXCEL_EXT or "spreadsheetml" in m:
        return _parse_xlsx(data), "other"
    if ext in _HTML_EXT or "html" in m:
        return _parse_html(data), "text"
    if ext in _UNANSWERED_EXT or "presentation" in m or "image" in m:
        raise ParseError("unsupported_format", "OCR / PPT 解析属迭代 1b，暂未迁移到 AI 服务")
    # 其余一律按文本（markdown/text/csv/subtitle 等，与 TS isTextLike 对齐）
    text = _decode(data)
    if ext == ".md" or ext == ".markdown":
        return text, "markdown"
    if ext == ".csv" or ext == ".tsv" or "csv" in m:
        return _parse_csv_structured(data), "csv"
    if ext in (".srt", ".vtt"):
        return text, "subtitle"
    return text, "text"
