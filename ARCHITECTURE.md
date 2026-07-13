# Starwake Protocol Architecture Notes

## Boot sequence

1. `index.html` creates the canvas and all menu/HUD elements.
2. `musicEngine.js` exposes optional adaptive-music functions.
3. `game.js` reads DOM references, constructs state, binds events once, and calls `initialize()`.
4. Continue only changes splash/main-menu visibility.
5. Launch calls the public game launcher, which must work even when storage or audio fails.

Never make localStorage, Web Audio, the custom cursor, or debug controls prerequisites for starting gameplay.

## Sources of truth

- Difficulty and economy: `DIFFICULTY_DATA` and the wave-scaling helpers in `game.js`.
- Upgrade metadata/pricing: `UPGRADE_DATA`, `getUpgradeCost()`, and `applyUpgrade()`.
- Runtime state: `state`, `player`, `upgradeLevels`, and the entity arrays.
- Music transport and synthesis: `musicEngine.js`.
- Layout and stacking: `styles.css`.

## Safe feature workflow

1. Add configuration values to the appropriate data table.
2. Add one narrow update function and one narrow draw function when visuals are required.
3. Call the update function from `updateGame()` and the draw function from `drawGame()`.
4. Add cleanup and a performance cap for any growing list.
5. Test Continue, Launch, Pause/Resume, Upgrade/Next Wave, Restart, and browser refresh.
6. Test once via `file://` and once through a local HTTP server or deployment preview.

## Common regression traps

- Reading `let`/`const` variables before declaration. This can abort the entire script.
- Registering duplicate event listeners after restart.
- Allowing decorative children inside buttons to intercept pointer events.
- Using overlays with high z-index and active pointer events above menus.
- Recreating AudioContext nodes repeatedly without stopping them.
- Adding unbounded particles, bullets, or pickups.
- Hiding the native cursor before verifying the custom cursor works.

## Scaling guidelines

Prefer data-driven archetypes and modifiers over long mode-specific `if` chains. Keep early-wave starting pressure separate from long-term growth. Impossible should demand pattern mastery through composition and pacing—not only inflated health. Easy should preserve the complete game loop while strongly reducing punishment.

## WeaponSynth audio contract

- Procedural weapon voices live in `WeaponSynth` inside `game.js`.
- Gameplay code should request semantic events (`shoot`, `explosiveImpact`) through `playSound()` rather than creating Web Audio nodes directly.
- Primary-fire timbre scales from `player.explosiveLevel`; progression should add harmonic complexity and filtering, not large gain increases.
- Explosive-round splash hits must use `explosiveImpact`, never the full `explosion` cue. Full explosions are reserved for enemy deaths and major destructive events.
- Every oscillator and buffer source must have a short explicit stop time. Automatic weapons can otherwise accumulate enough live nodes to mute or starve the music scheduler.
- Do not add screen shake to automatic explosive-round impacts. High fire rates make repeated shake visually fatiguing.

## PickupSynth audio contract

- Physical pickups must request semantic pickup events (`healthPickup`, `speedPickup`, `slowPickup`, `harmPickup`) through `playSound()`.
- Do not reuse the generic `pickup` cue for physical powerups; it is reserved for point-orb and debug reward confirmation.
- `PickupSynth` owns oscillator, noise, filter, stereo, and envelope construction for pickups.
- Rapid repeat collections are represented by a capped stack value that changes pitch/intensity slightly. Never multiply full-volume voices without a cap.
- The speed pickup is intentionally a crescendo/woosh: rising filtered noise, rising saw tone, low-mid body, and left-to-right stereo movement.
- Pickup voices must always have explicit stop times so boss cleanup cannot leak live Web Audio nodes.

## Audio mixer contract

The main and pause menus expose three synchronized controls:

- **Master** controls `audio.masterGain` and mutes or scales the entire mix.
- **Music** controls `audio.musicGain` only.
- **SFX** controls `audio.sfxGain` only.

Persisted keys are `starwakeMasterVolume`, `starwakeMusicVolume`, `starwakeSfxVolume`, and `starwakeAudioEnabled`.

All procedural music must route through `audio.musicGain`. All gameplay sounds—including `WeaponSynth`, `PickupSynth`, enemy weapons, impacts, and explosions—must route through `audio.sfxGain`. Do not connect voices directly to `audio.masterGain` or `audio.context.destination`, because doing so bypasses the user-facing mixer and can reintroduce clipping or balance regressions.


## Live audio diagnostics

The debug HUD includes an **Audio Debug** panel. It reports the actual number of active OscillatorNode and AudioBufferSourceNode voices by instrumenting the AudioContext source factories. This is the authoritative way to diagnose late-wave muting.

- **Kill Voices** stops every tracked source without rebuilding the graph.
- **Restart Audio** closes and reconstructs the entire Web Audio graph and scheduler.
- **Export Log** downloads a text snapshot containing context state, voice pressure, dropped events, compressor reduction, scheduler health, object counts, and recent errors.
- New sound generators must use the shared `audio.context`; otherwise their sources will bypass diagnostics and recovery.
- A rising active-source count that never falls indicates a missing stop time or an orphan source.

## Audio Voice Pressure Guardrails

Late-wave audio stability depends on bounding active Web Audio source nodes, not only controlling gain.

- Soft voice limit: 52 active sources. Low-priority impacts, enemy shots, ordinary explosions, and explosive-round texture are dropped first.
- Hard voice limit: 68 active sources. Only critical priority-5 events may pass; the source tracker may steal the oldest priority-1/2 voice to make room.
- Music-created sources default to protected priority 5 because they are created outside the semantic SFX dispatcher.
- Never bypass `playSound()` for gameplay SFX. Doing so bypasses rate limits, event budgets, source-pressure checks, and diagnostic category tagging.
- Full enemy explosions remain globally throttled. Automatic splash damage must use `explosiveImpact`, never `explosion`.
- The debug console reports soft drops, hard drops, and voice steals. These counters should rise during extreme combat instead of active voices exceeding the hard ceiling or the AudioContext muting.


## Protected player-fire cadence

- The semantic `shoot` event is priority 5 and must not be dropped by the normal SFX budget.
- Below audio pressure, `WeaponSynth.playPrimary()` provides the full layered pew.
- Near the soft voice ceiling, `WeaponSynth.playCadencePulse()` replaces it with a single-source pulse.
- Do not remove this fallback or route automatic player fire through low-priority impact/explosion policies. The firing rhythm is gameplay feedback and must remain audible even when decorative combat sounds are shed.

## Persistent player-fire audio contract

The main automatic weapon uses `PersistentFireSynth`, which owns two oscillators for the lifetime of the current `AudioContext`. They remain silent until a shot retriggers gain, filter, and pitch automation.

Maintenance rules:

- Do not replace the persistent fire path with per-shot `OscillatorNode` creation.
- Player fire must not enter the expendable voice pool or be targeted by voice stealing.
- `PersistentFireSynth.destroy()` must run before closing or rebuilding the audio context.
- A shot should normally create zero new source nodes. The temporary cadence pulse is fallback-only.
- Keep fire envelopes short and retrigger-safe by cancelling or holding existing automation before scheduling new values.
- The audio diagnostics panel should report `Persistent fire: ready` whenever the audio graph is initialized.

## Persistent audio rack

High-frequency gameplay audio must prefer persistent instruments over allocating a new Web Audio source graph for every event.

The current rack contains:

- `PersistentFireSynth`: player automatic-fire cadence.
- `PersistentPickupSynth`: speed, health, damage, slow, and harmful pickups.
- `PersistentExplosionSynth`: a three-slot retriggerable enemy-death pool.
- `PersistentEnemyWeaponSynth`: a four-slot hostile-fire pool.
- `PersistentUiSynth`: point pickups, upgrade confirmation, and wave-clear cues.

### Required lifecycle

1. Create rack sources only after the user gesture has created the `AudioContext`.
2. Mark rack sources as persistent so the transient voice guard does not steal or count them against its ceiling.
3. Keep their gains effectively silent while idle.
4. Trigger sounds by automating existing `AudioParam` objects.
5. `Kill Voices` and `Restart Audio` must destroy every rack instrument and rebuild it on the active context.
6. Do not call `createOscillator()` or `createBufferSource()` from automatic-fire, routine enemy-shot, normal enemy-death, or physical-pickup handlers.

The diagnostics intentionally show both total and transient source counts. Persistent rack sources raise the total count but should not raise the transient count during repeated events.

## Persistent Music Rack (2026 refactor)

The procedural soundtrack uses a fixed, persistent instrument rack in
`musicEngine.js`. Notes automate oscillator frequency, filter, and gain; they do
not allocate fresh source nodes.

Mandatory rules:

- Do not call `createOscillator()` or `createBufferSource()` from a music step,
  note, drum, or transition function.
- New music instruments must use a bounded pool created inside `buildRack()`.
- The shared looping noise source must feed hats, snares, kick clicks, and risers.
- `StarwakeMusicEngine.destroy()` must be called whenever diagnostic controls
  kill all sources or the AudioContext is rebuilt.
- Persistent music sources are excluded from transient voice-guard pressure.
- Keep the fixed music rack small. Prefer timbral automation over oscillator
  layering when increasing intensity.

The diagnostics panel reports `Music rack: ready / persistent-fixed-rack` when
this contract is functioning.


## Touch and gamepad input contract

- Keyboard/mouse remains supported and must not be removed when changing mobile controls.
- Mobile uses two pointer-captured virtual sticks: left movement, right aim; firing remains automatic.
- Standard controllers use left stick/D-pad for movement, right stick for aim, and Start/Options for pause.
- Apply dead zones before normalizing gamepad axes. Never let an idle connected controller overwrite active touch input.
- Virtual controls must be hidden during splash, main menu, pause, upgrade protocol, game over, and wave-clear transitions.
- Touch controls may update the shared analog input state, but gameplay remains authoritative inside updatePlayer() and shootPlayerWeapon().
- Do not create a second player movement implementation for mobile or controllers. All devices must feed the unified input state.


## Touch-menu scrolling contract
- The full-screen `.touch-controls` overlay may only be displayed when both `available` and `active` are present.
- Never display the overlay from `.available` alone; its `touch-action: none` would block native menu scrolling.
- Menu surfaces use `touch-action: pan-y` so vertical swipes remain browser-native.
- Virtual-stick listeners may call `preventDefault()` only for pointers that begin inside a stick zone.

## Mobile Performance Profile

`platformProfile.js` must load before `musicEngine.js` and `game.js`.

The mobile profile shares the authoritative game state and mechanics, but uses bounded projectile, particle, explosion, pickup, enemy, and audio budgets; reduced enemy-count pressure; every-second-frame rendering while simulation/input continue every animation frame; a reduced persistent music rack; and disabled GPU-heavy blur, minimap rendering, and layered overlay effects.

Do not independently detect mobile inside new systems. Read `window.STARWAKE_PLATFORM_PROFILE`.

Testing overrides:
- `?mobile=1` forces Mobile Performance Mode.
- `?desktop=1` forces Desktop Performance Mode.


## Mobile menu viewport and fullscreen contract

- Menu overlays are fixed, dynamic-viewport scroll containers (`100dvh`) and must remain independently scrollable.
- Do not restore vertical centering directly on the overlay; cards use auto margins so short content centers and tall content scrolls from the top.
- Touch-control overlays must be inactive while any menu is open.
- Fullscreen buttons all use `[data-fullscreen-button]` and one shared `toggleFullscreen()` implementation.
- Fullscreen is optional. Unsupported or rejected requests must never block menus or gameplay.
- Recalculate canvas dimensions after fullscreen changes because mobile browser chrome changes usable viewport size.


## Mobile camera and wave-clear controls

- `platformProfile.cameraZoom` controls mobile world zoom. The scene is scaled with the canvas context; the backing canvas resolution must not be increased just to zoom out.
- Pointer coordinates must pass through `screenToWorld()`, which divides by `CAMERA_ZOOM`.
- Touch controls remain active during `clearPhaseActive` so players can collect point orbs and pickups. Hide them only for actual modal menus, pause, game over, or pre-game screens.
- HUD and touch controls are DOM layers and intentionally remain full-size while the world scene is zoomed out.


## Mobile tactical view
- Mobile camera zoom is intentionally wider than desktop. Keep pointer conversion, camera bounds, visibility tests, and minimap camera rectangles based on `CAMERA_ZOOM`.
- Mobile health is rendered in world space above the ship; do not re-enable the large bottom health HUD on mobile without checking touch-control overlap.
- The mobile minimap is a deliberately low-detail 120x80 asset. Avoid adding bullets, grid effects, shadows, or per-frame updates to it.


## Developer mode contract

- Developer Mode is disabled by default and persisted with the `starwakeDeveloperMode` setting.
- `setDeveloperMode()` is the single authoritative controller for debug visibility.
- Player-facing debug controls belong inside `#debugPanel`; live diagnostics belong in `.audio-debug-console`.
- Turning Developer Mode off must close any open diagnostics panel.
- Do not add isolated debug elements that bypass the centralized body class.
- The checkbox is intentionally temporary and can be removed later without deleting the underlying tools.


## Mobile top-right HUD stack
- The touch pause button owns the top-right safe-area slot.
- The lightweight minimap is positioned directly below it using the same right-edge inset.
- Do not independently move either element without preserving that vertical stack, or they may overlap on compact phones.

## Mobile HUD anchoring
- Pause and minimap are fixed DOM HUD elements, never world/camera elements.
- Always reset `left`, `bottom`, and `transform` when anchoring them with `top/right`.
- The desktop `#playerHealthBarWrap` must remain fully hidden in mobile-performance mode; mobile health is rendered above the ship.

## Mobile HUD visibility contract

Mobile HUD elements are hidden by default. `updateTouchControlVisibility()` is
responsible for toggling `body.mobile-gameplay-hud` only while active gameplay
accepts touch input. The minimap and touch pause button must be scoped under
that body class. Do not expose them globally from a mobile media query, because
that causes them to leak onto the splash screen and menus before startup.

The desktop `#playerHealthBarWrap` remains hidden on mobile; mobile health is
rendered directly above the ship.


## Unified top-right HUD contract

- There is exactly one minimap DOM element: `#minimapWrap`.
- `#touchPauseButton` and `#minimapWrap` both live inside `#topRightHud`.
- Never position those children independently on mobile. Position only `#topRightHud`.
- Mobile visibility is controlled exclusively by `body.mobile-gameplay-hud`.
- Do not add a second mobile minimap or move the pause button back into the full-screen touch overlay.

## Canonical mobile top-right HUD contract

The pause button and minimap must both be direct children of `#topRightHud`.
Do not place the pause button back inside `#touchControls`; doing so separates
its coordinate system from the minimap and causes conflicting mobile anchors.

On touch/mobile layouts:

- `#topRightHud` is hidden by default.
- It is visible only while `body.mobile-gameplay-hud` is present.
- The pause button is the left child and the minimap is the right child.
- Both children use `position: static` inside the fixed top-right row.
- `#playerHealthBarWrap` remains hidden because mobile health is rendered above
  the player ship.

## Carrier Command-Ship Contract

- Carriers own two independent offensive systems: a direct plasma cannon and a missile factory.
- Missile production must not be tied to `shootCooldown`; changing cannon balance must not silently alter volley cadence.
- Opening missile salvos are intentionally large because carriers unlock after the player has built substantial power.
- Carrier missile doctrine is 50% interceptors. Interceptors delete player bullets and return to orbit rather than behaving like disposable homing rockets.
- Non-interceptor missiles launch outward, form rings around the player, then dive in timed attack windows before returning to orbit if they miss.
- Missile counts, active caps, cannon bursts, and volley frequency scale by difficulty through `getCarrierDoctrine()`.
- Preserve `PERFORMANCE_LIMITS.maxCarrierMissiles`, especially for the mobile profile. New carrier features must respect both per-carrier and global caps.
- Carrier movement should maintain support range and strafe; it should not revert to simple direct pursuit.


## Ship Reconstruction progression contract
- Combat input remains movement + aim; all research effects are passive or automatic.
- Core upgrades may repeat. Advanced unlocks require 3 system investment, Experimental 6, and Capstones 9 plus the previous unique module.
- Hybrid research requires investment in two systems and must never add combat buttons.
- `UPGRADE_DATA` is the single source of truth for system, tier, cost, and prerequisite metadata.
- Keep prerequisite validation centralized in `getResearchLock()` and never duplicate gate logic in button handlers.
- End-of-wave research is one choice per completed wave and must be resolved before it can be claimed again.
