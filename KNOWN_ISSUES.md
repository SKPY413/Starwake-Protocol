# STARWAKE PROTOCOL — KNOWN ISSUES

This file tracks confirmed defects in the current build. Raw observations begin in `ADMIN.md`; confirmed and reproducible problems move here.

## Severity

- **Critical:** Crash, data loss, cannot launch, or cannot continue playing.
- **Major:** A core mechanic fails or a run is substantially compromised.
- **Minor:** The game remains playable, but behavior is wrong or inconvenient.
- **Visual / Audio:** Presentation defect without major gameplay impact.

## Issue Template

Copy this block for each confirmed issue:

```text
### ISSUE-000 — Short title

Status: Open
Severity: Major
First observed build:
Last verified build:
Platforms:
Frequency: Once / Intermittent / Consistent

Observed:

Expected:

Reproduction steps:
1.
2.
3.

Evidence:
- Screenshot/video:
- Console error:
- Diagnostic log:

Workaround:

Suspected system:

Resolution notes:
```

## Open Issues

No issues have yet been formally entered into the new tracker. Existing historical change logs remain in the project root.

## Resolved Issues

Move fixed issues here instead of deleting them. Include the build in which each fix was verified.


## Save Data and Persistence

Persistence is a permanent regression category, even when no active corruption defect is known. Every build must test:

- Main-save validation
- Backup recovery
- Export and re-import
- Rejection of truncated or edited JSON
- Loading a prior schema after migration logic is introduced
- Browser storage failure without preventing gameplay startup

Current status: defensive persistence system implemented; extended multi-browser soak testing remains required before Beta.

## Resolved — Empty arena during boot

- **Observed:** HUD and canvas appeared while the splash and menu were absent.
- **Cause:** Persistence initialization was part of the critical startup chain; a storage-layer exception could interrupt boot after HUD initialization.
- **Resolution:** Persistence now fails soft, and a final startup guard restores the splash unless a run was explicitly started or restored.

## Resolved — Reconstruction saves replayed completed waves

**Severity:** Major gameplay/progression issue

Saves previously stored only the wave number. Loading a save created in the
post-wave upgrade menu resumed combat on that same wave, allowing repeated
rewards and forcing completed bosses to be fought again.

**Resolution:** Save schema 2 records the run phase. Upgrade-menu saves now
restore directly into Ship Reconstruction with the completed wave preserved.


## Save storage growth — mitigated

**Status:** Protected by hard limit.

The browser save subsystem is limited to 256 KiB across all protected slots. Backup rotation prunes the oldest copy first. Any future schema expansion that approaches this ceiling must be reviewed before release.


## Undo label refresh fix — 2026-07-16

- Fixed the Ship Reconstruction undo control retaining the label of an action that had already been reversed.
- The control now refreshes immediately after the stack is popped and again after reconstruction UI rendering, so it always names the next available undo action.

## Resolved — Lifecycle saves not visible in activity history

**Observed:** Autosave, background-save, and shutdown-save entries were not consistently visible during testing.

**Cause:** Exit persistence relied primarily on `beforeunload`, which browsers may skip or restrict. Lifecycle coverage also lacked `pagehide` and page-freeze handling.

**Resolution:** Added `pagehide`, `visibilitychange`, and `freeze` checkpoints, retained `beforeunload` only as a fallback, added duplicate-event suppression, and refresh the inspector when the page returns to focus.

## Relic Identity Pass — Playtest Monitoring
- New relic balance values are provisional and require dense-wave and boss-wave testing.
- Overdrive boost timers use runtime clock values; save/resume behavior during an active temporary boost should be verified.

- Rift Tearer balance values remain provisional; verify static rift spawn density, visibility, and damage during crowded waves.
