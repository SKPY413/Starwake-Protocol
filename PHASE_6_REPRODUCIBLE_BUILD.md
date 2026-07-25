# Pre-Beta Engine Cleanup — Phase 6

Phase 6 makes the cleaned project reproducible and easier to maintain through GitHub, Vercel, and local ZIP builds. It does not change gameplay.

## Deterministic build fingerprint

`tools/create_build_manifest.py` writes `build_manifest.json`, recording the byte size and SHA-256 digest of:

- the browser runtime files
- every modular source section
- source and asset manifests
- every declared static asset

This makes accidental file drift visible even when a build still launches.

## Release-hygiene audit

`tools/audit_release_hygiene.py` verifies every recorded fingerprint and rejects common package debris:

- Python caches
- editor swap and backup files
- temporary files
- operating-system metadata

## Git repository normalization

`.gitattributes` forces stable LF line endings for source and documentation while preserving binary assets. `.gitignore` excludes generated local archives, caches, and editor debris.

## Updated workflow

```bash
npm run check
```

This command now:

1. updates source metadata
2. rebuilds `game.js`
3. regenerates `build_manifest.json`
4. runs the complete project verification gate

Run `npm run check` before committing to GitHub or deploying through Vercel.
