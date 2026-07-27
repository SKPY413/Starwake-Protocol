#!/usr/bin/env python3
"""Refresh source-section line ranges without changing their order or descriptions."""
from __future__ import annotations
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "src" / "manifest.json"

manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
sections_by_file = {item["file"]: item for item in manifest.get("sections", [])}
updated = []
line_cursor = 1

for source_path in manifest["source_order"]:
    path = ROOT / source_path
    text = path.read_text(encoding="utf-8")
    line_count = len(text.splitlines())
    old = sections_by_file.get(source_path, {})
    updated.append({
        "file": source_path,
        "start_line": line_cursor,
        "end_line": line_cursor + max(line_count - 1, 0),
        "description": old.get("description", "Ordered runtime source section."),
    })
    line_cursor += line_count

manifest["sections"] = updated
MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Updated {len(updated)} source-section ranges through generated line {line_cursor - 1}.")
