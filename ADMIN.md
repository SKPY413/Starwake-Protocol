# STARWAKE PROTOCOL — ADMIN

This is the persistent handoff notebook between Brandon and ChatGPT.

Use it freely. Short notes, incomplete thoughts, tester comments, copied error messages, and rough ideas are welcome. Do not worry about polished formatting. Place the updated file in the current build, re-zip the project, and send the complete build for the next implementation pass.

Do not erase completed history. Move resolved items to **Completed / Decisions Made** and add the date when practical.


###############################################################################
CURRENT BUILD
###############################################################################

Build name:

Milestone: Pre-Beta

Date:

Playtest duration:

Tested on:

Overall feeling:

Build condition:
- [ ] Stable
- [ ] Mostly stable
- [ ] Unstable
- [ ] Cannot launch


###############################################################################
CURRENT OBJECTIVE
###############################################################################

What should the next implementation accomplish?

-


###############################################################################
IMPLEMENTATION QUEUE
###############################################################################

Use one item per line. Add `[HIGH]`, `[MEDIUM]`, or `[LOW]` when priority matters.

- [ ]
- [ ]
- [ ]


###############################################################################
GAMEPLAY AND GAME FEEL
###############################################################################

Player movement / aiming / shooting:

-

Weapons / upgrades / research:

-

Enemies / bosses / waves:

-

Difficulty / economy / progression:

-

Pickups / rewards:

-


###############################################################################
USER INTERFACE AND ACCESSIBILITY
###############################################################################

Menus / HUD / readability:

-

Desktop controls:

-

Mobile / touch controls:

-

Controller support:

-

Accessibility:

-


###############################################################################
AUDIO AND MUSIC
###############################################################################

Music:

-

Sound effects:

-

Mixing / clipping / missing audio:

-

Choir or anomalous-unit audio notes:

-


###############################################################################
PERFORMANCE AND COMPATIBILITY
###############################################################################

Browser / device:

-

Frame rate / stutter:

-

Loading / saving / storage:

-

Console errors or exported diagnostic logs:

-


###############################################################################
BUGS FOUND
###############################################################################

CRITICAL — crash, data loss, cannot play:

- [ ]

MAJOR — seriously harms a run or feature:

- [ ]

MINOR — inconvenient but playable:

- [ ]

VISUAL / AUDIO — presentation defect:

- [ ]

For detailed tracking, copy confirmed items into `KNOWN_ISSUES.md`.


###############################################################################
TESTER FEEDBACK
###############################################################################

Tester name or alias:

Build tested:

Difficulty:

Feedback:

-

Repeated by other testers?
- [ ] Yes
- [ ] No
- [ ] Unknown


###############################################################################
NEW IDEAS — NOT YET APPROVED
###############################################################################

Ideas belong here before they enter the implementation queue.

-
-
-


###############################################################################
LORE AND WORLD QUESTIONS
###############################################################################

Story questions, contradictions, names, discoveries, enemy concepts, or environmental ideas for the Lore Bible:

-


###############################################################################
QUESTIONS FOR CHATGPT
###############################################################################

-
-
-


###############################################################################
COMPLETED / DECISIONS MADE
###############################################################################

Record what changed and why. Do not silently delete decisions.

- Date — Decision or completed item — Reason


###############################################################################
DO NOT FORGET
###############################################################################

-
-
-


###############################################################################
NEXT BUILD READINESS
###############################################################################

- [ ] High-priority notes are understandable
- [ ] Reproduction steps are included for serious bugs
- [ ] Tester reports are attached or summarized
- [ ] Current source files are included
- [ ] Browser console errors are copied when relevant
- [ ] Existing saves were tested or compatibility is marked unknown
- [ ] Build was re-zipped as one complete project folder


############################################################
IMPLEMENTED: RELEASE-STAGE DEVELOPER SEAL
############################################################

[✓] Added Credits button and credits overlay.
[✓] Added Developer Seal Mk. I to Pre-Beta credits.
[✓] Added favicon and touch-icon references.
[✓] Archived 16, 32, 48, and 256 pixel Mk. I assets.
[ ] Replace with Mk. II when the project enters Beta.
[ ] Replace with Mk. III at public release.
[ ] Reserve Mk. IV for the Legacy / anniversary stage.


############################################################
IMPLEMENTED — ANIMATED SPLASH SEAL
############################################################

- Added a pure-CSS Mk. I seal to the boot splash.
- Eight-point star and segmented orbital rings are rendered without image assets.
- Center orb breathes and pulses.
- Three curved wake strokes rotate to reproduce the spiral identity.
- Reduced-motion and mobile-performance modes disable animation.

############################################################
IMPLEMENTATION NOTE — ANIMATED SPLASH SEAL HOTFIX
############################################################

Status: Fixed

- Root cause: splash seal CSS was written into an inactive stylesheet.
- Active stylesheet patched: styles-20260715-compact-evolution.css
- Expected result: animated seal appears above the splash title.

############################################################

############################################################
IMPLEMENTED — ANIMATED SPLASH SEAL CONTAINMENT
############################################################

- Reduced and contained the CSS seal above the title.
- Prevented overlap with the Starwake Protocol logo text.
- Disabled splash viewport overflow that caused intermittent scrollbars.


############################################################
DEFENSIVE SAVE SYSTEM — IMPLEMENTED
############################################################

- Schema-versioned save envelopes
- Checksum validation before load
- Temporary-slot validation before promotion
- Main save plus three rotating backups
- Automatic save every 15 seconds and when the page is hidden/closed
- Continue, recovery, export, and import controls on the main menu
- Whitelisted restoration of run/player/research values
- Save data is always treated as untrusted input


############################################################
2026-07-15 — BOOT REGRESSION FIX
############################################################

- Defensive persistence removed from the critical boot path.
- Storage failures now disable saves for the session instead of disabling the game.
- Added a final splash/menu state guard before the game loop begins.


############################################################
2026-07-15 — UPGRADE MENU MANUAL SAVE
############################################################

- Added a Save Game button to Ship Reconstruction.
- Manual saves use the same validation, checksum, temporary slot, and backup rotation as autosaves.
- The menu displays immediate success/failure feedback.
- Restored saves resume safely at the beginning of the recorded wave.

############################################################
PHASE 1 SAVE CONTROLS — IMPLEMENTED
############################################################

Status: Complete

- Manual Save Game control in Ship Reconstruction
- Continue Saved Run from the main menu
- Recovery from the newest independently validated backup
- Export to a portable JSON save file
- Import with validation, three-slot backup rotation, and final verification

Recovery never silently overwrites the main save. It identifies the backup,
shows its wave and timestamp, asks for confirmation, and preserves the prior
main save before restoration.

############################################################
SAVE SYSTEM — PHASE 2
############################################################

Status: Implemented

- Added a player-facing Save Inspector to the main-menu Save Data panel.
- Displays integrity percentage, health/recovery status, save timestamp, wave,
  difficulty, build, schema compatibility, checksum state, and protected-copy count.
- Displays Main and Backup 1–3 individually with Healthy, Invalid, or Empty status.
- Uses reassuring guidance: healthy saves require no action; degraded main saves
  explicitly state when recovery remains available.
- Inspector is read-only and cannot modify or delete progress.


############################################################
PHASE-AWARE SAVE RESTORE — IMPLEMENTED
############################################################

Status: Complete

- Saves now record whether they were created during combat or Ship Reconstruction.
- A reconstruction save reopens the upgrade menu on the cleared wave.
- Cleared bosses and waves are not replayed after loading that save.
- Research selections, upgrade purchases, and remaining points are preserved.
- Older schema-1 saves migrate safely as combat saves.
- Save schema advanced to version 2.


############################################################
PHASE 3 IMPLEMENTATION — UNDO HISTORY & SAVE BUDGET
############################################################

- Reconstruction Undo now supports every action made during the current upgrade-menu visit.
- Players may press Undo repeatedly until they return to the menu's opening state.
- Undo history is cleared on menu entry, wave start, and restored reconstruction saves.
- Protected save storage is capped at 256 KiB total.
- Oldest backups are pruned first; the active main save is never silently deleted.
- Oversized saves/imports are refused with a clear status message.


## Undo label refresh fix — 2026-07-16

- Fixed the Ship Reconstruction undo control retaining the label of an action that had already been reversed.
- The control now refreshes immediately after the stack is popped and again after reconstruction UI rendering, so it always names the next available undo action.

############################################################
PHASE 4 IMPLEMENTATION — SAVE ACTIVITY LOG
############################################################

Status: Implemented

- Persistent recent save activity added to Save Inspector.
- Records autosaves, manual/background/shutdown saves, exports, imports,
  recovery attempts, validation failures, and storage pruning.
- Entries include local timestamp, outcome, wave where relevant, and a
  reassuring description of whether existing progress was preserved.
- History is capped at 40 entries and approximately 24 KiB.
- Clear History removes only activity records; it does not alter saves.

############################################################
2026-07-16 — PHASE 4 LIFECYCLE SAVE FIX
############################################################

- Replaced reliance on beforeunload with layered lifecycle checkpoints.
- Background saves now use visibilitychange and freeze.
- Exit saves now primarily use pagehide, with beforeunload as fallback.
- Added a short dedupe window to prevent one tab transition from rotating multiple backups.
- Added an Autosave System activity entry confirming the 15-second timer is armed.
- Save Inspector refreshes when the page regains focus or returns from background.

## Phase 5 — Living Seal Save Health
- Added a compact animated Seal to Save Inspector.
- Blue = healthy, green = save success, gold = recovery/attention, red = failure/invalid, purple = migration.
- Text remains authoritative; color is supplemental reassurance.

############################################################
2026-07-16 — RELIC IDENTITY & HUD POLISH PASS
############################################################

Implemented:
- Animated compact Living Seal beside the desktop wave counter.
- Pause glyph centered and scaled inside its circular control on desktop/mobile.
- Green relic redesigned as Verdant Aegis: maximum hull, rechargeable shields, and periodic repair.
- Purple relic redesigned as Rift Tearer: persistent spatial rifts around the player deal repeated AOE damage.
- Blue relic redesigned as Momentum Veil: hidden enemy overdrive drops boost movement and weapon cycle speed; end-of-wave pickup reach scales with relic stage.
- Red Astral Lens remains the dedicated super-weapon beam branch.

Playtest focus:
- Verify green shield/repair pacing is useful without making survival automatic.
- Verify purple rifts remain readable during dense waves and do not overperform against bosses.
- Verify blue overdrive drops are noticeable but still feel like hidden discoveries.
- Verify pause icon alignment at multiple desktop/mobile resolutions.

- Implemented conditional blue shield HUD and converted Rift Tearer tears to fixed world-space hazards; internal rings animate but the tears do not orbit or follow the player.

############################################################
2026-07-16 — EVOLVING BACKGROUND / BOSS REVEAL
############################################################

Implemented a twenty-wave environmental reveal cycle.

- Large arena structures now change hue and converge after each wave.
- The scattered structures gradually form a dormant command chassis.
- On each wave-20 giga-boss encounter, the structures lock around the boss core.
- Energy braces reveal that the apparent background elements are parts of the boss.
- Endless mode begins a fresh reveal cycle after each twenty-wave chapter.

Playtest focus:
- Ensure the late-wave assembly remains readable without hiding enemies.
- Confirm mobile performance remains stable.
- Decide whether the reveal should culminate at wave 20 permanently or later move to a dedicated campaign finale.

############################################################
CURRENT PLAYTEST FOCUS — CARRIER / BOSS PASS
############################################################

Verify that first-appearance Carriers around waves 11–15 remain threatening without flooding the arena. Confirm that several simultaneous Carriers respect the global launch spacing and that the DEPLOYING tell is readable on desktop and mobile. Test wave 10 and wave 20 warning sequences, especially pause/resume behavior and escalating boss projectile patterns.

############################################################
ENEMY EVOLUTION + COMBAT NUMBER READABILITY PASS
############################################################

Implemented a generation-based enemy adaptation system.

- Waves 1-10 remain Generation I and teach core archetypes.
- Later ten-wave generations selectively add mutations rather than only increasing counts.
- Blink-capable enemies telegraph briefly and escape away from nearby danger or low-health situations.
- Bomb-capable enemies leave timed, clearly marked area hazards with visible blast radii.
- Weapon mutations add compact burst-fire and spread-fire patterns without adding new enemy bodies.
- Mutations are restricted by archetype and capped so every enemy does not receive every power.
- Evolved enemies receive a subtle generation ring; blink charging receives a stronger cyan tell.
- Damage/status numbers now enter oversized, rapidly settle to normal size, drift, and fade.

PLAYTEST PRIORITIES
- Confirm bombs remain readable during dense waves and provide enough escape time.
- Confirm blink is evasive rather than frustrating or excessively frequent.
- Watch Generation III+ projectile pressure on mobile and Impossible difficulty.
- Verify large damage numbers improve readability without covering targets for too long.


############################################################
CARRIER ASSAULT / EVOLVED ARMY BALANCE PASS
############################################################

- Carriers now deploy 24-unit assault waves on a 2.75-second base cadence.
- Carrier wave size scales +3% per wave after unlock, capped at 56.
- Carrier cadence accelerates by 1% per wave, capped at 1.8 seconds.
- Global and per-carrier active caps prevent runaway object counts.
- Evolved low-tier enemies grow physically by generation: 110%, 120%, 135%, and 150%.
- Evolution rings are larger and now include a visible generation label.
- Blink has a larger displacement, arrival burst, and shockwave.
- Bomb mutations have a larger trigger and blast radius with stronger damage.
- Burst/spread projectiles are larger, faster, and stronger without adding projectile count.
- Mini-boss density is reduced sharply from waves 20-40 so regular minions remain the army majority.

PLAYTEST PRIORITIES
- Test several simultaneous carriers for frame stability and readable assault-wave formations.
- Verify evolved hull sizes remain navigable in crowded rooms.
- Confirm waves 20-40 contain noticeably more minions and fewer mini-bosses.

---

## Pre-Beta Engine Cleanup — Phase 1

- Promoted the active runtime files to stable names: `game.js`, `styles.css`, `musicEngine.js`, and `platformProfile.js`.
- Removed obsolete version-stamped runtime copies no longer referenced by the game.
- Removed fragmented legacy changelog files and duplicate test reports.
- Removed an unreferenced icon and redundant documentation stub.
- Added `CLEANUP_REPORT.md` with the retained runtime and documentation inventory.
- No gameplay mechanics or balance values were intentionally changed.

## Carrier Durability and Enemy Roster Repair
- Increased carrier hull durability so carriers survive long enough to establish their missile screen.
- Carriers now enter with a meaningful stored missile reserve.
- Each roughly two-second manufacturing cycle adds a rack of missiles rather than a single missile.
- Preserved the 30% protection / 60% attack / 10% reserve doctrine.
- Replaced overlapping enemy-selection thresholds with a weighted roster.
- Restored tanks and ensured normal, runner, brute, tank, dodger, and fighter archetypes all remain eligible after their unlock waves.


## Pre-Beta Engine Cleanup — Phase 2

- Split the editable 9,000-line runtime into ten ordered source sections under `src/`.
- Added a deterministic build script that regenerates `game.js`.
- Preserved `game.js` as the browser entry point to avoid scope/order regressions.
- Added build verification and a source manifest.
- No gameplay, balance, rendering, save-schema, enemy-evolution, or carrier behavior changes were intended.

## Pre-Beta Engine Cleanup — Phase 3

- Organized static assets under stable system-specific paths.
- Moved the developer seal to `assets/branding/developer-seal/mk1/`.
- Added a machine-readable asset manifest and asset-directory documentation.
- Added an automated asset audit for missing, undeclared, duplicated, and unreferenced required assets.
- Preserved procedural rendering and audio systems without adding unnecessary asset placeholders.
- No gameplay or balance changes were introduced.
