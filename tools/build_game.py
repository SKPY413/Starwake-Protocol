#!/usr/bin/env python3
"""Rebuild game.js from the ordered Phase 2 source sections."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "src" / "manifest.json").read_text(encoding="utf-8"))
chunks = [(ROOT / item).read_text(encoding="utf-8") for item in manifest["source_order"]]
output = "".join(chunks)
(ROOT / manifest["generated_runtime"]).write_text(output, encoding="utf-8")
print(f"Built {manifest['generated_runtime']} from {len(chunks)} ordered source sections ({len(output):,} characters).")
