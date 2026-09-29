#!/usr/bin/env python3
"""Verify no Arabic remains inside comments for listed files."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / "tools" / "extract_comment_arabic.py"
FILES = [
    ROOT / "public" / "script.js",
    ROOT / "public" / "styles.css",
    ROOT / "public" / "index.html",
    ROOT / "public" / "firebase-db.js",
    ROOT / "public" / "firebase-auth.js",
    ROOT / "public" / "LICENSE_PROTECTION.js",
    ROOT / "functions" / "index.js",
    ROOT / "public" / "firestore.rules",
    ROOT / "public" / "auth-ui-handler.js",
    ROOT / "public" / "super-admin.js",
    ROOT / "public" / "sw.js",
    ROOT / "public" / "opfs.js",
    ROOT / "public" / "firebase-config.js",
]

# firestore.rules: use JS scanner (// comments)
sys.path.insert(0, str(ROOT / "tools"))
from extract_comment_arabic import scan_js, scan_html_comments, scan_css
import re

AR = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")


def check_file(path: Path):
    text = path.read_text(encoding="utf-8")
    ext = path.suffix.lower()
    if ext == ".css":
        segs = scan_css(text)
    elif ext == ".html":
        segs = scan_html_comments(text)
    else:
        segs = scan_js(text)
    bad = []
    for a, b in segs:
        if AR.search(text[a:b]):
            bad.append((a, text[a : min(a + 120, b)]))
    return bad


def main():
    failed = False
    for f in FILES:
        if not f.exists():
            continue
        bad = check_file(f)
        if bad:
            failed = True
            print("FAIL", f.relative_to(ROOT), len(bad), "segments")
            for pos, snippet in bad[:5]:
                print(" ", pos, repr(snippet[:80]))
    if not failed:
        print("OK: no Arabic in comments for", sum(1 for f in FILES if f.exists()), "files")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
