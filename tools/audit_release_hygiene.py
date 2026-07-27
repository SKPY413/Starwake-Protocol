#!/usr/bin/env python3
"""Audit reproducible-build fingerprints and reject repository/package debris."""
from __future__ import annotations
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "build_manifest.json"
failures: list[str] = []
passes: list[str] = []


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


if not MANIFEST.is_file():
    failures.append("missing build_manifest.json; run python tools/create_build_manifest.py")
else:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = data.get("files", [])
    seen: set[str] = set()
    for entry in entries:
        relative = entry.get("path", "")
        if relative in seen:
            failures.append(f"duplicate build-manifest entry: {relative}")
            continue
        seen.add(relative)
        path = ROOT / relative
        if not path.is_file():
            failures.append(f"fingerprinted file missing: {relative}")
            continue
        actual_size = path.stat().st_size
        actual_hash = digest(path)
        if actual_size != entry.get("bytes"):
            failures.append(f"size mismatch: {relative}")
        elif actual_hash != entry.get("sha256"):
            failures.append(f"hash mismatch: {relative}")
        else:
            passes.append(f"fingerprint valid: {relative}")

    required = {"index.html", "styles.css", "platformProfile.js", "musicEngine.js", "game.js", "src/manifest.json", "assets/manifest.json"}
    missing_required = sorted(required - seen)
    if missing_required:
        failures.append("manifest omits required files: " + ", ".join(missing_required))
    else:
        passes.append("all required distributable files are fingerprinted")

junk_patterns = [
    "**/.DS_Store", "**/Thumbs.db", "**/__pycache__", "**/*.pyc",
    "**/*.bak", "**/*.tmp", "**/*.swp", "**/*~", "**/*.orig",
]
junk: set[str] = set()
for pattern in junk_patterns:
    for path in ROOT.glob(pattern):
        junk.add(path.relative_to(ROOT).as_posix())
if junk:
    failures.append("repository/package debris found: " + ", ".join(sorted(junk)))
else:
    passes.append("no temporary, cache, editor-backup, or OS metadata debris")

print("STARWAKE RELEASE HYGIENE AUDIT")
print("=" * 32)
for item in passes:
    print(f"PASS: {item}")
for item in failures:
    print(f"FAIL: {item}")
print("-" * 32)
print(f"{len(passes)} passed, {len(failures)} failed")
raise SystemExit(1 if failures else 0)
