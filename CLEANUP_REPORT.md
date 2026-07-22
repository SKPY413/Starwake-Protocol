# Pre-Beta Engine Cleanup — Phase 1

## Scope

This pass removes files that are not used by the deployed game and stabilizes the runtime filenames. No gameplay balance or mechanics were intentionally changed.

## Runtime files retained

- `index.html`
- `styles.css`
- `platformProfile.js`
- `musicEngine.js`
- `game.js`
- Branding icons referenced by `index.html`

## Removed

- Historical version-stamped JavaScript and CSS builds that were no longer referenced by `index.html`
- Fragmented `CHANGELOG_*.txt` files already superseded by the cumulative project documentation
- Duplicate legacy test reports (`TEST_REPORT.txt` and `TEST_REPORT_RELIC.txt`)
- Unreferenced 48 px developer-seal icon
- Redundant `docs/README.md`

## Documentation retained

- `README.txt`
- `ADMIN.md`
- `ARCHITECTURE.md`
- `DOCUMENTATION_CHANGELOG.md`
- `KNOWN_ISSUES.md`
- `LORE_BIBLE.md`
- `ROADMAP.md`
- `SAVE_SYSTEM.md`
- `SOP.md`
- `TEST_REPORT.md`

## Validation

- `index.html` references only the stable runtime filenames.
- All locally referenced runtime files exist.
- JavaScript syntax validation completed with Node.js.

The previous ZIP remains the complete historical backup if an old build ever needs to be recovered.
