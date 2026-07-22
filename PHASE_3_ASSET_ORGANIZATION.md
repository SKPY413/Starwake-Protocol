# Pre-Beta Engine Cleanup — Phase 3

Phase 3 gives every static asset a stable, descriptive home and adds automated checks that prevent missing, undeclared, or orphaned deployment assets.

## Changes

- Moved the Mark I developer seal into:
  `assets/branding/developer-seal/mk1/`
- Updated all HTML references to the new paths.
- Added `assets/manifest.json` as the authoritative static-asset inventory.
- Added `assets/README.md` with naming and placement rules.
- Added `tools/audit_assets.py` to verify:
  - every manifest entry exists;
  - every static asset is declared;
  - every required asset is referenced by the runtime;
  - no duplicate manifest paths exist.

## Procedural content

Gameplay sprites, background visuals, particles, music, and sound effects remain procedural. No unnecessary placeholder image or audio directories were added.

## Verification

```bash
python tools/audit_assets.py
python tools/verify_build.py
node --check game.js
```

No gameplay or balance logic was changed in this phase.
