#!/usr/bin/env python3
"""Run the complete zero-dependency Starwake project verification gate."""
from __future__ import annotations
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FAILURES: list[str] = []
PASSES: list[str] = []


def check(condition: bool, pass_message: str, fail_message: str) -> None:
    if condition:
        PASSES.append(pass_message)
    else:
        FAILURES.append(fail_message)


def run(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if result.returncode == 0:
        PASSES.append(label)
    else:
        details = (result.stdout + result.stderr).strip()
        FAILURES.append(f"{label}: {details or 'command failed'}")


# 1. Required project files.
required = [
    "index.html", "styles.css", "platformProfile.js", "musicEngine.js", "game.js",
    "src/manifest.json", "assets/manifest.json", "build_manifest.json", "tools/build_game.py",
]
for relative in required:
    check((ROOT / relative).is_file(), f"required file present: {relative}", f"missing required file: {relative}")

# 2. Source manifest integrity and exact section metadata.
manifest_path = ROOT / "src" / "manifest.json"
if manifest_path.is_file():
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    order = manifest.get("source_order", [])
    sections = manifest.get("sections", [])
    check(len(order) == len(set(order)), "source order contains no duplicates", "source order contains duplicate entries")
    check([s.get("file") for s in sections] == order, "section metadata follows source order", "section metadata does not match source order")
    cursor = 1
    for item in sections:
        relative = item.get("file", "")
        path = ROOT / relative
        if not path.is_file():
            FAILURES.append(f"manifest source missing: {relative}")
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        expected_end = cursor + max(lines - 1, 0)
        check(
            item.get("start_line") == cursor and item.get("end_line") == expected_end,
            f"line metadata current: {relative}",
            f"stale line metadata for {relative}; run python tools/update_source_manifest.py",
        )
        cursor = expected_end + 1

# 3. HTML-local reference integrity and duplicate IDs.
html_path = ROOT / "index.html"
if html_path.is_file():
    html = html_path.read_text(encoding="utf-8")
    refs = re.findall(r'''(?:src|href)=["']([^"'#?]+)''', html, flags=re.IGNORECASE)
    local_refs = [r for r in refs if not re.match(r"^(?:[a-z]+:|//)", r, flags=re.IGNORECASE)]
    for ref in local_refs:
        check((ROOT / ref).is_file(), f"HTML reference resolves: {ref}", f"broken HTML reference: {ref}")
    ids = re.findall(r'''\bid=["']([^"']+)["']''', html, flags=re.IGNORECASE)
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    check(not duplicates, "HTML IDs are unique", f"duplicate HTML IDs: {', '.join(duplicates)}")
    scripts = re.findall(r'''<script[^>]+src=["']([^"']+)["']''', html, flags=re.IGNORECASE)
    check(scripts[-3:] == ["platformProfile.js", "musicEngine.js", "game.js"],
          "runtime scripts retain expected order",
          f"unexpected runtime script order: {scripts}")

# 4. No obsolete version-stamped runtime copies returned.
patterns = ["game_*.js", "styles_*.css", "musicEngine_*.js", "platformProfile_*.js"]
stale = sorted(str(p.relative_to(ROOT)) for pattern in patterns for p in ROOT.glob(pattern))
check(not stale, "no obsolete version-stamped runtime files", f"obsolete runtime files found: {', '.join(stale)}")

# 5. Existing focused audits and generated-runtime check.
run([sys.executable, "tools/verify_build.py"], "generated runtime matches modular source")
run([sys.executable, "tools/audit_assets.py"], "asset manifest and references pass")
run([sys.executable, "tools/audit_balance_constants.py"], "central gameplay constants pass")
run([sys.executable, "tools/audit_release_hygiene.py"], "release fingerprints and repository hygiene pass")

# 6. JavaScript parser gate when Node is available.
node = subprocess.run(["bash", "-lc", "command -v node"], text=True, capture_output=True)
if node.returncode == 0:
    for script in ["game.js", "musicEngine.js", "platformProfile.js"]:
        run(["node", "--check", script], f"JavaScript syntax valid: {script}")
else:
    PASSES.append("Node unavailable; JavaScript parser gate skipped")

print("STARWAKE PROJECT VERIFICATION")
print("=" * 31)
for message in PASSES:
    print(f"PASS: {message}")
for message in FAILURES:
    print(f"FAIL: {message}")
print("-" * 31)
print(f"{len(PASSES)} passed, {len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)
