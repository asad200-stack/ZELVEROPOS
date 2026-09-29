#!/usr/bin/env python3
"""Apply comment_translations_ar_to_en.json to JS/CSS/HTML files (comments only)."""
import json
import sys
from pathlib import Path

# Import scanners from sibling module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_comment_arabic import scan_js, scan_css, scan_html_comments

ROOT = Path(__file__).resolve().parent.parent
MAP_PATH = ROOT / "tools" / "comment_translations_ar_to_en.json"


def load_mapping():
    data = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    return data


def replace_line_comment(raw: str, mapping: dict) -> str:
    if not raw.startswith("//"):
        return raw
    rest = raw[2:]
    key = rest.strip()
    if not key or key not in mapping:
        return raw
    val = mapping[key]
    if val is None:
        return raw
    lead = rest[: len(rest) - len(rest.lstrip())]
    trail = rest[len(rest.rstrip()) :] if rest.strip() else ""
    return "//" + lead + str(val) + trail


def replace_block_comment(raw: str, mapping: dict) -> str:
    if not (raw.startswith("/*") and raw.rstrip().endswith("*/")):
        return raw
    inner = raw[2:-2]
    key = inner.strip()
    if not key or key not in mapping:
        return raw
    val = mapping[key]
    if val is None:
        return raw
    lead = inner[: len(inner) - len(inner.lstrip())]
    trail = inner[len(inner.rstrip()) :] if inner.strip() else ""
    return "/*" + lead + str(val) + trail + "*/"


def replace_html_comment(raw: str, mapping: dict) -> str:
    if not (raw.startswith("<!--") and raw.rstrip().endswith("-->")):
        return raw
    inner = raw[4:-3]
    key = inner.strip()
    if not key or key not in mapping:
        return raw
    val = mapping[key]
    if val is None:
        return raw
    lead = inner[: len(inner) - len(inner.lstrip())]
    trail = inner[len(inner.rstrip()) :] if inner.strip() else ""
    return "<!--" + lead + str(val) + trail + "-->"


def apply_js(text: str, mapping: dict) -> str:
    segs = scan_js(text)
    out = []
    last = 0
    for a, b in segs:
        out.append(text[last:a])
        raw = text[a:b]
        if raw.startswith("//"):
            out.append(replace_line_comment(raw, mapping))
        elif raw.startswith("/*"):
            out.append(replace_block_comment(raw, mapping))
        else:
            out.append(raw)
        last = b
    out.append(text[last:])
    return "".join(out)


def apply_css(text: str, mapping: dict) -> str:
    segs = scan_css(text)
    out = []
    last = 0
    for a, b in segs:
        out.append(text[last:a])
        raw = text[a:b]
        if raw.startswith("/*"):
            out.append(replace_block_comment(raw, mapping))
        else:
            out.append(raw)
        last = b
    out.append(text[last:])
    return "".join(out)


def apply_html(text: str, mapping: dict) -> str:
    segs = scan_html_comments(text)
    out = []
    last = 0
    for a, b in segs:
        out.append(text[last:a])
        raw = text[a:b]
        if raw.strip().startswith("<!--"):
            out.append(replace_html_comment(raw, mapping))
        else:
            out.append(raw)
        last = b
    out.append(text[last:])
    return "".join(out)


FILES = [
    ("public/script.js", apply_js),
    ("public/styles.css", apply_css),
    ("public/index.html", apply_html),
    ("public/firebase-db.js", apply_js),
    ("public/firebase-auth.js", apply_js),
    ("public/LICENSE_PROTECTION.js", apply_js),
    ("functions/index.js", apply_js),
    ("public/auth-ui-handler.js", apply_js),
    ("public/super-admin.js", apply_js),
    ("public/sw.js", apply_js),
    ("public/opfs.js", apply_js),
    ("public/firebase-config.js", apply_js),
]


def main():
    mapping = load_mapping()
    changed = []
    for rel, fn in FILES:
        path = ROOT / rel
        if not path.exists():
            continue
        old = path.read_text(encoding="utf-8")
        new = fn(old, mapping)
        if new != old:
            path.write_text(new, encoding="utf-8")
            changed.append(rel)
            print("updated", rel)
    print("done,", len(changed), "files")


if __name__ == "__main__":
    main()
