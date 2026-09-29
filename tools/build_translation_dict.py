#!/usr/bin/env python3
"""Build ar->en mapping for comment strings using deep-translator (batch with delays)."""
import json
import random
import sys
import time
from pathlib import Path

try:
    from deep_translator import GoogleTranslator
except ImportError:
    print("pip install deep-translator", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "all_unique_arabic_comments.txt"
OUT = ROOT / "tools" / "comment_translations_ar_to_en.json"

def main():
    lines = [ln.strip() for ln in SRC.read_text(encoding="utf-8").splitlines() if ln.strip()]
    t = GoogleTranslator(source="ar", target="en")
    mapping = {}
    for i, text in enumerate(lines):
        try:
            en = t.translate(text)
            mapping[text] = en
        except Exception as e:
            print(f"FAIL {i}: {text[:60]}... -> {e}", file=sys.stderr)
            mapping[text] = text  # fallback
        time.sleep(0.12 + random.random() * 0.08)
        if (i + 1) % 50 == 0:
            print(f"{i+1}/{len(lines)}", file=sys.stderr)
    OUT.write_text(json.dumps(mapping, ensure_ascii=False, indent=0), encoding="utf-8")
    print("Wrote", OUT, len(mapping), "entries")

if __name__ == "__main__":
    main()
