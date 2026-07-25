# Phase 4 — Central Gameplay Constants

Phase 4 centralizes frequently tuned gameplay values in `GAMEPLAY_CONSTANTS`, located near the top of `src/00_bootstrap.js`.

## Centralized systems

- Enemy generation cadence, hull scaling, mutation count, and Quantum Null introduction
- Healer support radius
- Aegis shield radius
- Carrier manufacturing, stockpile, engagement ranges, launch batches, and missile doctrine ratios
- Heavy Cannon shell speed, velocity scaling, warhead, and cluster-round values
- Primary explosive-round minimum radius and level scaling

## Editing workflow

1. Change a value in `GAMEPLAY_CONSTANTS`.
2. Run `python tools/build_game.py`.
3. Run `python tools/verify_build.py`.
4. Run `python tools/audit_balance_constants.py`.
5. Run `node --check game.js`.

The generated `game.js` remains the browser entry point. Do not edit it directly.

## Compatibility

This phase is organizational. Existing numerical values were preserved, and no save fields or gameplay formulas were intentionally changed.
