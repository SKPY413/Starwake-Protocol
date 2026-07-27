#!/usr/bin/env python3
"""Verify that game.js exactly matches the ordered source sections."""
from pathlib import Path
import hashlib, json, sys
ROOT=Path(__file__).resolve().parents[1]
m=json.loads((ROOT/'src'/'manifest.json').read_text(encoding='utf-8'))
expected=''.join((ROOT/p).read_text(encoding='utf-8') for p in m['source_order'])
actual=(ROOT/m['generated_runtime']).read_text(encoding='utf-8')
if actual != expected:
    print('FAIL: game.js is out of date. Run python tools/build_game.py')
    sys.exit(1)
print('PASS: game.js exactly matches the modular source sections.')
print('SHA-256:', hashlib.sha256(actual.encode()).hexdigest())
