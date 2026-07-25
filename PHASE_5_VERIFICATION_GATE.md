# Pre-Beta Engine Cleanup — Phase 5

Phase 5 adds a single project-wide verification gate. It does not alter gameplay.

## One-command workflow

With Python:

```bash
python tools/update_source_manifest.py
python tools/build_game.py
python tools/verify_project.py
```

With npm installed:

```bash
npm run check
```

No npm packages are required. `package.json` only provides command aliases.

## What the gate verifies

- Required runtime, source, manifest, and build files exist
- `src/manifest.json` order and generated line ranges are current
- `game.js` exactly matches the ordered files under `src/`
- Local scripts, stylesheets, and icon references in `index.html` resolve
- HTML element IDs are not duplicated
- Runtime script loading order remains stable
- Obsolete version-stamped runtime copies have not returned
- Asset-manifest rules still pass
- Central gameplay-constant rules still pass
- JavaScript syntax passes for all three runtime scripts when Node is installed

## Editing policy

1. Edit the appropriate file under `src/`.
2. Run `npm run check` or the three Python commands above.
3. Treat a failed verification as a release blocker until it is understood.
4. Continue loading `game.js` in the browser; it remains generated output.
