# Documentation Implementation — 2026-07-15

## Added

- `ADMIN.md`: Persistent freeform handoff and playtest notebook.
- `TEST_REPORT.md`: Repeatable 1–10 tester rating and bug-report template.
- `KNOWN_ISSUES.md`: Formal confirmed-defect tracker with severity and reproduction format.
- `SOP.md`: Contributor workflow and Starwake design philosophy.
- `ROADMAP.md`: Pre-Beta, Beta, Release, Post-Release, and Ten-Year Anniversary milestone lists.
- `LORE_BIBLE.md`: Canonical narrative reference framework and initial continuity questions.
- `docs/README.md`: Documentation directory index.

## Documentation Decisions

- Named milestones are primary; numerical versions are secondary build identifiers.
- `ADMIN.md` is informal and optimized for fast handoffs.
- `KNOWN_ISSUES.md` contains confirmed reproducible defects, not every raw observation.
- Anomalous or Choir-like units may use localized strange audio, but should not arbitrarily interrupt or replace the player soundtrack.
- Historical project files were preserved unchanged.


## 2026-07-16 — Developer Seal and Credits

- Added a Credits button and accessible modal credits screen.
- Added Developer Seal Mk. I as the Pre-Beta credit signature.
- Added browser favicon and Apple touch icon references.
- Archived Mk. I at 16, 32, 48, and 256 pixel sizes.
- Added the release-stage seal policy to SOP.md.


## Animated Splash Seal

- Reconstructed the Starwake Seal Mk. I as scalable CSS geometry on the splash screen.
- Added independent ring rotation, core breathing, orb pulsing, and wake-swirl animation.
- Preserved accessibility through reduced-motion handling.

## Animated Splash Seal Hotfix — 2026-07-15

- Corrected the animated seal stylesheet target.
- The splash markup was present, but the build loads `styles-20260715-compact-evolution.css` rather than `styles.css`.
- Copied the seal geometry, animation, responsive, reduced-motion, and mobile-performance rules into the active stylesheet.

## 2026-07-15 — Animated Splash Seal Containment Fix

- Moved the animated seal into a compact, reserved layout row above the splash title.
- Prevented the rotating seal geometry from overlapping splash text.
- Locked splash-screen overflow to prevent intermittent browser scrollbars.


## Upgrade Menu Manual Save

- Added an explicit Save Game action to the reconstruction menu.
- Added inline save integrity feedback.
- Reused the defensive save pipeline rather than creating a separate save path.

## Phase 1 Save Controls

- Consolidated Save, Continue, Recovery, Export, and Import as the first complete persistence milestone.
- Recovery now selects a validated backup rather than reusing the main slot.
- Added recovery confirmation with wave, difficulty, timestamp, and possible progress-loss estimate.
- Imports now rotate all three backups and verify the installed save before reporting success.

## Save System Phase 2 — Save Inspector

- Added an expandable Save Inspector to the main menu.
- Added integrity scoring and per-slot validation reporting.
- Added build/schema/checksum visibility and recovery-aware reassurance text.
- No gameplay balance or run-state behavior changed.

## Phase-aware save restoration

- Advanced persistence schema to version 2.
- Added combat/upgrade phase recording and migration behavior.
- Documented prevention of repeated-wave farming and boss replay after saving.


## Phase 3 — Reconstruction History and Storage Budget

- Documented multi-step reconstruction undo behavior.
- Added the 256 KiB protected-save storage ceiling and pruning policy.


## Undo label refresh fix — 2026-07-16

- Fixed the Ship Reconstruction undo control retaining the label of an action that had already been reversed.
- The control now refreshes immediately after the stack is popped and again after reconstruction UI rendering, so it always names the next available undo action.

## Save Phase 4 — Activity History

- Added persistent, bounded save-operation logging.
- Added Recent Save Activity to Save Inspector.
- Added explicit success, warning, cancellation, and failure outcomes.
- Added a history-only clear control that cannot affect player progress.

## Phase 5 — Living Seal integration
Added animated, accessible save-health feedback to the Save Inspector and connected it to save, recovery, failure, warning, and migration events.

## 2026-07-16 — Relic Identity and HUD Polish
- Added animated desktop gameplay seal.
- Corrected pause button glyph centering.
- Reworked green, blue, and purple relic identities and runtime effects.

## Shield HUD and Static Rift Pass
- Added a conditional blue shield bar above hull health.
- Changed Rift Tearer from orbiting rifts to stationary world-space tears that spawn around the player, animate in place, damage enemies, and fade out.
