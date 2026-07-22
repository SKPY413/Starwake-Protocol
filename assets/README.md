# Starwake Asset Directory

This directory contains only static files loaded by the deployed game.

## Current structure

```text
assets/
├── branding/
│   └── developer-seal/
│       └── mk1/
│           ├── seal-16.png
│           ├── seal-32.png
│           └── seal-256.png
├── manifest.json
└── README.md
```

Starwake currently generates its gameplay graphics, particles, sound effects, and music procedurally. They therefore do not require image or audio files here.

When adding a static asset:

1. Put it under a descriptive category and system folder.
2. Use stable lowercase filenames with hyphens.
3. Add it to `assets/manifest.json`.
4. Run `python tools/audit_assets.py`.
5. Do not retain unused alternatives or version-stamped duplicates in the deployable tree.
