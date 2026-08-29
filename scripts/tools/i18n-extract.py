#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
i18n 字符串提取工具（P5-4）——扫描 src/app 下的 .tsx，把中文文案替换为 t() 调用，
并把新键合入 zh-CN.json / en.json（英文译文后续人工补齐）。

用法：
    python3 scripts/tools/i18n-extract.py src/app/path/to/page.tsx

安全约定：所有文件 IO 的目标路径都经 realpath 规范化 + commonpath 包含性校验，
禁止越出仓库根目录（路径含 ".." 直接拒绝）。
"""

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.getcwd()).resolve()

def load(p):
    with open(p) as f:
        return json.load(f)

def set_key(d, key, value):
    cur = d
    parts = key.split(".")
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value

def slug(path):
    m = re.search(r"src/app/([^/]+)/", path)
    if m:
        return m.group(1)
    return path.split("/")[-1].replace(".tsx", "")

def _contained(resolved: Path) -> Path:
    """Containment: refuse any target outside the repo root (no '..' escape)."""
    if os.path.commonpath([str(ROOT), str(resolved)]) != str(ROOT):
        raise SystemExit("路径越界: %s" % resolved)
    return resolved

def extract(src_path):
    resolved_src = _contained(Path(os.path.realpath(src_path)))
    if ".." in str(src_path):
        raise SystemExit("路径越界: %s" % src_path)

    src = resolved_src.read_text(encoding="utf-8")
    name = slug(src_path)
    zh = load("src/lib/i18n/messages/zh-CN.json")
    en = load("src/lib/i18n/messages/en.json")

    # strip comments (line + block) so they never match
    no_comments = re.sub(r"//[^\n]*", "", src)
    no_comments = re.sub(r"/\*.*?\*/", "", no_comments, flags=re.S)

    # collect unique Chinese strings
    found = []
    # JSX text nodes (single-line only, no braces/angle brackets inside)
    for m in re.finditer(r">([^<>\n{}]*[\u4e00-\u9fa5][^<>\n{}]*)<", no_comments):
        txt = m.group(1).strip()
        if txt and txt not in found:
            found.append(txt)
    # quoted strings (single-line, no < > inside so tag boundaries are never
    # captured; attributes / object values / ternaries). Template-string lines
    # (containing a backtick) are skipped - their "..." literals are part of
    # interpolation and must not be extracted.
    for line in no_comments.split("\n"):
        if "`" in line:
            continue
        for m in re.finditer(r'"([^"\n<>]*[\u4e00-\u9fa5][^"\n<>]*)"', line):
            txt = m.group(1)
            if txt and txt not in found:
                found.append(txt)

    # build key map
    keymap = {}
    for i, txt in enumerate(found):
        key = f"page.{name}.s{i}"
        keymap[txt] = key
        set_key(zh, key, txt)
        set_key(en, key, txt)  # placeholder, translated later

    # apply replacements (skip lines that already contain t(" or i18n imports;
    # template-string lines skip the plain-literal pass so `"..."` inside
    # backticks isn't mangled)
    out_lines = []
    for line in src.split("\n"):
        if 't("' in line or 'useT' in line or 'useFormat' in line:
            out_lines.append(line)
            continue
        new = line
        in_template = "`" in line
        for txt, key in keymap.items():
            # attribute
            new = new.replace(f'="{txt}"', f'={{t("{key}")}}')
            # JSX text node (and spaced variants: `> 中文 <`)
            new = new.replace(f">{txt}<", f'>{{t("{key}")}}<')
            new = new.replace(f"> {txt} <", f'>{{t("{key}")}}<')
            new = new.replace(f"> {txt}<", f'>{{t("{key}")}}<')
            new = new.replace(f">{txt} <", f'>{{t("{key}")}}<')
            # plain literal (never inside template strings)
            if not in_template:
                new = new.replace(f'"{txt}"', f't("{key}")')
        out_lines.append(new)

    resolved_src.write_text("\n".join(out_lines), encoding="utf-8")
    Path("src/lib/i18n/messages/zh-CN.json").write_text(
        json.dumps(zh, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    Path("src/lib/i18n/messages/en.json").write_text(
        json.dumps(en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"== {src_path}: {len(found)} strings")
    for txt, key in keymap.items():
        print(f"  {key}: {txt}")

for p in sys.argv[1:]:
    extract(p)
