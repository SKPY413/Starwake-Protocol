# STARWAKE PROTOCOL — CONTRIBUTOR SOP

## Purpose

This document defines the working standards for outside contributors and future collaborators. `ADMIN.md` is the informal handoff notebook; this SOP is the project contract.

## Design Philosophy

These principles take precedence over adding content:

1. Every piece of lore should explain, contextualize, or meaningfully reinforce a mechanic.
2. Every faction should justify its gameplay identity.
3. Every boss should exist for a reason beyond providing a larger health bar.
4. Every soundtrack should belong to a place, state, faction, or dramatic function.
5. Every enemy should have a purpose beyond being something to shoot.
6. Mechanics come before spectacle.
7. Clarity beats unnecessary complexity.
8. Player agency is more important than strict realism.
9. Polish and stability take priority over uncontrolled expansion.
10. Never add content solely because it would be cool; cool ideas must also serve the game.
11. If a feature cannot be explained clearly in one paragraph, it is not designed well enough to implement.
12. The game should not tell players that something is important when it can let them discover why it matters.
13. Lore must not interrupt the core play experience. It should reward attention without punishing players who primarily want action.
14. Audio identity may alter atmosphere, but ordinary enemy presence should not arbitrarily silence or replace player music. Anomalous units may use localized strange sounds, spatial cues, or restrained overlays.

## Source-of-Truth Files

- `ADMIN.md`: Current handoff notes, requests, unapproved ideas, and questions.
- `TEST_REPORT.md`: Structured tester ratings and qualitative feedback.
- `KNOWN_ISSUES.md`: Confirmed defects and their status.
- `ROADMAP.md`: Milestone outcomes, not promises or release dates.
- `LORE_BIBLE.md`: Canonical world, narrative, faction, character, and terminology reference.
- `ARCHITECTURE.md`: Technical contracts and regression hazards.
- `CHANGELOG_*.txt`: Historical implementation records from earlier builds.

## Contribution Workflow

1. Read `README.txt`, `ARCHITECTURE.md`, this SOP, and relevant open issues.
2. Describe the proposed change in one paragraph before implementation.
3. Explain which player problem, design objective, or milestone requirement it addresses.
4. Keep the change narrow. Avoid unrelated refactors in the same contribution.
5. Preserve existing desktop, mobile, controller, storage, audio, and developer-mode contracts.
6. Add bounded cleanup and performance limits for all growing runtime collections.
7. Test the affected system and the core regression checklist.
8. Document the implementation and any known limitations.
9. Do not mark an issue resolved until the fix has been reproduced and verified in a build.

## Core Regression Checklist

- [ ] Splash Continue works
- [ ] Main-menu Launch works
- [ ] Pause and Resume work
- [ ] Upgrade menu and Next Wave work
- [ ] Restart works
- [ ] Browser refresh works
- [ ] Desktop keyboard and mouse work
- [ ] Touch controls and mobile menu scrolling work
- [ ] Controller input does not override active touch input
- [ ] Audio mixer controls affect the correct buses
- [ ] No unbounded audio voices or gameplay collections were introduced
- [ ] Developer Mode remains disabled by default
- [ ] The build runs using `file://`
- [ ] The build runs through a local HTTP server or deployment preview
- [ ] Browser console is checked for new errors

## Code and Asset Rules

- Prefer data-driven configuration over repeated mode-specific conditionals.
- Use semantic audio events and the persistent audio architecture described in `ARCHITECTURE.md`.
- Do not create alternate movement, combat, or state systems for individual platforms.
- Do not introduce copyrighted or unlicensed third-party assets.
- Name new files and systems clearly enough that their role is apparent without opening them.
- Preserve historical files unless a deliberate archive or removal decision is recorded.

## Review Standard

A contribution is ready only when it is understandable, bounded, testable, documented, and consistent with the design philosophy. A feature being functional is necessary but not sufficient.


############################################################
RELEASE-STAGE DEVELOPER SEAL
############################################################

The tiny seal displayed in the in-game credits is a living project marker.

- Pre-Beta uses Developer Seal Mk. I.
- Beta will introduce Developer Seal Mk. II.
- Release will introduce Developer Seal Mk. III.
- Anniversary or legacy editions may introduce Developer Seal Mk. IV.
- Previous seals must remain archived under assets/branding.
- A seal change must be recorded in the changelog and must coincide with a real milestone, not an arbitrary cosmetic update.
- The credit seal is intentionally small and should remain a quiet signature rather than dominate the credits screen.


############################################################
SAVE DATA SAFETY STANDARD
############################################################

Save data must always be treated as untrusted input. No release may alter the save schema without:

1. Incrementing the schema version.
2. Providing sequential migration logic.
3. Validating the migrated result before promotion.
4. Preserving at least one known-good backup.
5. Testing export, import, automatic recovery, and malformed-file rejection.
6. Documenting whether active runs remain compatible.

A failed field must be repaired or rejected narrowly. The game must never silently erase an entire profile because one optional value is missing.
