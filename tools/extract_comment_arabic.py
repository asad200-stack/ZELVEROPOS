#!/usr/bin/env python3
"""Extract Arabic text from JS/CSS/HTML comments only (string-aware)."""
import re
import sys
from pathlib import Path

AR = re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]')


def scan_js(text: str):
    """Return list of (start, end) for // and /* */ comments; skips strings and template literals."""
    segments = []
    i = 0
    n = len(text)

    def skip_string(quote, idx):
        j = idx + 1
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == quote:
                return j + 1
            j += 1
        return n

    def skip_template(start_idx):
        j = start_idx + 1
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == "`":
                return j + 1
            if text[j] == "$" and j + 1 < n and text[j + 1] == "{":
                j += 2
                depth = 1
                while j < n and depth > 0:
                    c = text[j]
                    if c in "'\"":
                        j = skip_string(c, j)
                        continue
                    if c == "`":
                        j = skip_template(j)
                        continue
                    if c == "/" and j + 1 < n:
                        if text[j + 1] == "/":
                            while j < n and text[j] != "\n":
                                j += 1
                            continue
                        if text[j + 1] == "*":
                            j += 2
                            while j + 1 < n and not (text[j] == "*" and text[j + 1] == "/"):
                                j += 1
                            j = min(j + 2, n)
                            continue
                    if c == "{":
                        depth += 1
                    elif c == "}":
                        depth -= 1
                    j += 1
                continue
            j += 1
        return n

    while i < n:
        c = text[i]
        if c in "'\"":
            i = skip_string(c, i)
            continue
        if c == "`":
            i = skip_template(i)
            continue
        if c == "/" and i + 1 < n:
            if text[i + 1] == "/":
                seg_start = i
                i += 2
                while i < n and text[i] != "\n":
                    i += 1
                segments.append((seg_start, i))
                continue
            if text[i + 1] == "*":
                seg_start = i
                i += 2
                while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                    i += 1
                i = min(i + 2, n)
                segments.append((seg_start, i))
                continue
        i += 1
    return segments


def scan_css(text: str):
    """CSS: skip strings '...' "..."; extract /* */ comments."""
    segments = []
    i = 0
    n = len(text)

    def skip_string(quote, idx):
        j = idx + 1
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == quote:
                return j + 1
            j += 1
        return n

    while i < n:
        c = text[i]
        if c in "'\"":
            i = skip_string(c, i)
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            seg_start = i
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i = min(i + 2, n)
            segments.append((seg_start, i))
            continue
        i += 1
    return segments


def scan_html_comments(text: str):
    """HTML <!-- ... --> outside strings (simplified: skip script content)."""
    segments = []
    i = 0
    n = len(text)
    lower = text.lower()

    while i < n:
        if lower.startswith("<!--", i):
            start = i
            i += 4
            while i + 2 < n and not (text[i] == "-" and text[i + 1] == "-" and text[i + 2] == ">"):
                i += 1
            i = min(i + 3, n)
            segments.append((start, i))
            continue
        i += 1
    return segments


def main():
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    ext = path.suffix.lower()
    if ext in (".js",):
        segs = scan_js(text)
    elif ext in (".css",):
        segs = scan_css(text)
    elif ext in (".html",):
        segs = scan_html_comments(text)
    else:
        print("Unknown extension", ext, file=sys.stderr)
        sys.exit(1)

    seen = set()
    for a, b in segs:
        chunk = text[a:b]
        if not AR.search(chunk):
            continue
        inner = chunk
        if inner.startswith("//"):
            inner = inner[2:]
        elif inner.startswith("/*"):
            inner = inner[2:-2].rstrip()
            if inner.endswith("*/"):
                inner = inner[:-2]
        elif inner.startswith("<!--"):
            inner = inner[4:-3]
        s = inner.strip()
        if s and s not in seen:
            seen.add(s)
            print(s)


if __name__ == "__main__":
    main()
