# Starwake Persistence System

## Storage slots

- `starwake_save_main`
- `starwake_save_backup_1`
- `starwake_save_backup_2`
- `starwake_save_backup_3`
- `starwake_save_temp` (transaction staging only)

## Write sequence

1. Capture a whitelisted snapshot.
2. Wrap it with schema, build, timestamp, and checksum metadata.
3. Write to the temporary slot.
4. Read and validate the temporary slot.
5. Rotate the previous main save into the backup chain.
6. Promote the validated snapshot to the main slot.
7. Remove the temporary slot.

## Recovery

The menu inspects all four persistent copies and selects the newest valid envelope. Recovery promotes that copy to the main slot. Import files are subjected to the same parser, checksum, schema, and range validation.

## Current scope

The system persists the active run, player configuration, upgrades, relic research, selected difficulty, core settings, seal stage, and highest-wave metadata. Transient projectiles and enemies are intentionally not saved; a recovered run resumes at the beginning of its current wave to avoid serializing unstable combat objects.

## Phase 2: Save Inspector

The main menu includes a read-only inspector that validates all four protected
slots and reports the active save's wave, difficulty, timestamp, build, schema,
checksum, and backup coverage. The integrity percentage is a protection score,
not a gameplay-completion score: a healthy main save carries most of the score,
and each additional validated backup increases resilience.

The inspector never edits, deletes, or repairs data. Recovery and Import remain
explicit player actions.

## Phase-Aware Saves

Schema 2 records `run.phase` as either `combat` or `upgrade`.

A save created in Ship Reconstruction restores that menu directly. The recorded
wave remains cleared and is not spawned again. Selecting Next Wave performs the
single canonical wave increment. This prevents repeated-wave farming and avoids
forcing players to defeat a completed boss twice.

Schema-1 saves did not record phase and migrate conservatively to `combat`.


## Storage Budget

Starwake save slots have a hard combined budget of **256 KiB** (`262,144` bytes). This includes the main slot, temporary validation slot, and three rotating backups. Before a write, the system removes the oldest backup copies first. It never silently deletes the active main save. If the new main save cannot fit even after safe pruning, the write is rejected and existing progress remains intact. The Save Inspector reports current usage against the budget.

## Phase 4 — Save Activity Log

The Save Inspector retains a bounded activity history under
`starwake_save_activity_log`.

Recorded events include successful and failed autosaves, manual saves,
background/shutdown saves, exports, imports, recovery operations, validation
failures, and automatic backup pruning. The newest 20 entries are displayed;
no more than 40 entries or approximately 24 KiB are retained.

Clearing this history never deletes or modifies Main, Temp, or Backup saves.

## Living Seal status indicator
The Save Inspector includes a compact Living Seal. Blue indicates healthy protected data; green briefly acknowledges a verified save; gold indicates recovery or reduced redundancy; red indicates an invalid state or failed write while existing data remains protected; purple is reserved for schema migration. The seal never replaces written status or recovery instructions.
