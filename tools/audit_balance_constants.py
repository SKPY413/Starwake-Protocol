#!/usr/bin/env python3
"""Verify Phase 4 gameplay constants and their expected runtime references."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
bootstrap = (ROOT / "src" / "00_bootstrap.js").read_text(encoding="utf-8")
all_source = "".join(path.read_text(encoding="utf-8") for path in sorted((ROOT / "src").glob("*.js")))

required_groups = (
    "evolution", "healer", "aegis", "carrier", "cannon", "explosiveRounds"
)
required_references = (
    "GAMEPLAY_CONSTANTS.evolution.wavesPerGeneration",
    "GAMEPLAY_CONSTANTS.healer.radius",
    "GAMEPLAY_CONSTANTS.aegis.shieldRadius",
    "GAMEPLAY_CONSTANTS.carrier.manufactureBaseMs",
    "GAMEPLAY_CONSTANTS.cannon.warheadRadius",
    "GAMEPLAY_CONSTANTS.explosiveRounds.minimumRadius",
)

errors = []
if "const GAMEPLAY_CONSTANTS = Object.freeze" not in bootstrap:
    errors.append("GAMEPLAY_CONSTANTS declaration is missing from src/00_bootstrap.js")
for group in required_groups:
    if f"{group}: Object.freeze" not in bootstrap:
        errors.append(f"Missing constant group: {group}")
for reference in required_references:
    if reference not in all_source:
        errors.append(f"Expected runtime reference is missing: {reference}")

if errors:
    print("FAIL: gameplay constant audit")
    for error in errors:
        print("-", error)
    sys.exit(1)

print("PASS: gameplay constants are declared and referenced by all audited systems.")
