#!/usr/bin/env python3
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
    ROOT / "public" / "auth-ui-handler.js",
    ROOT / "public" / "super-admin.js",
    ROOT / "public" / "sw.js",
    ROOT / "public" / "opfs.js",
    ROOT / "public" / "firebase-config.js",
]

seen = set()
for f in FILES:
    if not f.exists():
        continue
    out = subprocess.check_output([sys.executable, str(PY), str(f)], text=True, encoding="utf-8", errors="replace")
    for line in out.splitlines():
        s = line.strip()
        if s:
            seen.add(s)

outp = ROOT / "tools" / "all_unique_arabic_comments.txt"
outp.write_text("\n".join(sorted(seen, key=len, reverse=True)), encoding="utf-8")
print(len(seen), "unique strings ->", outp)
