#!/usr/bin/env python3
"""Create a deterministic integrity manifest for the distributable Starwake build."""
from __future__ import annotations
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "build_manifest.json"

INCLUDE_FILES = [
    "index.html",
    "styles.css",
    "platformProfile.js",
    "musicEngine.js",
    "game.js",
    "assets/manifest.json",
    "src/manifest.json",
]
INCLUDE_DIRS = ["src", "assets"]
EXCLUDE_NAMES = {"build_manifest.json", ".DS_Store", "Thumbs.db"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def selected_files() -> list[Path]:
    found: set[Path] = set()
    for relative in INCLUDE_FILES:
        path = ROOT / relative
        if path.is_file():
            found.add(path)
    for directory in INCLUDE_DIRS:
        base = ROOT / directory
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.is_file() and path.name not in EXCLUDE_NAMES:
                found.add(path)
    return sorted(found, key=lambda p: p.relative_to(ROOT).as_posix())


entries = []
for path in selected_files():
    relative = path.relative_to(ROOT).as_posix()
    entries.append({
        "path": relative,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    })

payload = {
    "format": 1,
    "algorithm": "sha256",
    "purpose": "Deterministic integrity record for runtime, modular source, and declared assets.",
    "files": entries,
}
OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {OUTPUT.relative_to(ROOT)} with {len(entries)} file fingerprints.")
