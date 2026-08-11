#!/usr/bin/env python3
# P5-4 helper: extract hard-coded Chinese UI strings from a tsx file into
# t("page.<file>.<n>") calls, auto-filling zh-CN.json (en.json gets the same
# text as a placeholder - translated in a later pass). Handles:
#   JSX text nodes  >中文<        -> >{t("key")}<
#   JSX attributes  ="中文"       -> ={t("key")}
#   other literals "中文" (obj/ternary) -> t("key")
# Comments / imports / already-extracted lines are skipped.
import json
import re
import sys

def load(p):
    with open(p) as f:
        return json.load(f)

def set_key(obj, key, val):
    parts = key.split(".")
    cur = obj
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = val

def slug(path):
    # src/app/(app)/api-keys/page.tsx -> api-keys
    m = re.search(r"\(app\)/([^/]+)/page\.tsx$", path)
    if m:
        return m.group(1)
    m = re.search(r"\(app\)/([^/]+)/([^/]+)/page\.tsx$", path)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    # (auth)/login/page.tsx -> login
    m = re.search(r"\(auth\)/([^/]+)/page\.tsx$", path)
    if m:
        return m.group(1)
    # share-doc/[token]/page.tsx -> share-doc
    m = re.search(r"share-doc", path)
    if m:
        return "share-doc"
    # r/[id]/page.tsx -> report-share
    m = re.search(r"/r/([^/]+)/page\.tsx$", path)
    if m:
        return "report-share"
    # privacy/page.tsx / terms/page.tsx / maintenance / not-found / error
    m = re.search(r"src/app/([^/]+)/page\.tsx$", path)
    if m:
        return m.group(1)
    m = re.search(r"src/app/([^/]+)\.tsx$", path)
    if m:
        return m.group(1)
    return path.split("/")[-1].replace(".tsx", "")

def extract(path):
    src = open(path).read()
    name = slug(path)
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

    with open(path, "w") as f:
        f.write("\n".join(out_lines))
    with open("src/lib/i18n/messages/zh-CN.json", "w") as f:
        json.dump(zh, f, ensure_ascii=False, indent=2)
    with open("src/lib/i18n/messages/en.json", "w") as f:
        json.dump(en, f, ensure_ascii=False, indent=2)

    print(f"== {path}: {len(found)} strings")
    for txt, key in keymap.items():
        print(f"  {key}: {txt}")

for p in sys.argv[1:]:
    extract(p)
