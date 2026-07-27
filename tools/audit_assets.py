#!/usr/bin/env python3
"""Verify Starwake's static asset manifest and local references."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets" / "manifest.json"
SCAN_FILES = [ROOT / "index.html", ROOT / "styles.css", ROOT / "game.js"]
ASSET_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".mp3", ".wav", ".ogg", ".m4a"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if not MANIFEST.exists():
        fail("assets/manifest.json is missing")

    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = data.get("assets", [])
    paths = [entry.get("path", "") for entry in entries]

    if not entries:
        fail("asset manifest is empty")
    if len(paths) != len(set(paths)):
        fail("asset manifest contains duplicate paths")

    missing = [path for path in paths if not (ROOT / path).is_file()]
    if missing:
        fail("manifest references missing files: " + ", ".join(missing))

    actual = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "assets").rglob("*")
        if path.is_file() and path.suffix.lower() in ASSET_SUFFIXES
    }
    declared = set(paths)
    undeclared = sorted(actual - declared)
    stale = sorted(declared - actual)
    if undeclared:
        fail("static assets missing from manifest: " + ", ".join(undeclared))
    if stale:
        fail("manifest paths not present on disk: " + ", ".join(stale))

    combined = "\n".join(path.read_text(encoding="utf-8") for path in SCAN_FILES if path.exists())
    referenced = {
        match.replace("\\", "/")
        for match in re.findall(r"assets/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg|ico|mp3|wav|ogg|m4a)", combined, flags=re.I)
    }
    unreferenced_required = sorted(
        entry["path"] for entry in entries
        if entry.get("required", False) and entry["path"] not in referenced
    )
    if unreferenced_required:
        fail("required assets are not referenced by runtime files: " + ", ".join(unreferenced_required))

    print(f"Asset audit passed: {len(actual)} declared static assets, {len(referenced)} runtime references.")


if __name__ == "__main__":
    main()
