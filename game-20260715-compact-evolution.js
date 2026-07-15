/*
 * STARWAKE PROTOCOL — GAME RUNTIME
 *
 * MAINTENANCE RULES
 * 1. Gameplay must still launch when optional systems fail. Audio, storage, custom
 *    cursor effects, and debug UI are conveniences—not startup dependencies.
 * 2. Keep startup order stable: safe helpers/constants -> DOM references -> state ->
 *    functions -> event binding -> initialize(). Avoid reading a const/let before its
 *    declaration; this previously caused a total startup failure in deployed builds.
 * 3. Treat DIFFICULTY_DATA, UPGRADE_DATA, and enemy base stats as the authoritative
 *    balance tables. Do not hide extra difficulty multipliers inside unrelated code.
 * 4. Simulation belongs in update* functions. Rendering belongs in draw* functions.
 *    Mixing the two makes pause behavior, testing, and future fixed-timestep work fragile.
 * 5. New arrays/effects need hard caps and cleanup paths. Endless-wave games must remain
 *    stable after long sessions, not only during the first few waves.
 * 6. UI event listeners should be registered once. Restarts reset state; they should not
 *    duplicate listeners or animation loops.
 */
(() => {
    "use strict";

    // Local files and privacy-restricted browsers can throw on Web Storage.
    // Storage must never be allowed to abort game initialization.
    const safeStorage = {
        get(key, fallback = null) {
            try {
                const value = window.localStorage?.getItem(key);
                return value === null || value === undefined ? fallback : value;
            } catch (error) {
                console.warn("Storage read unavailable:", key, error);
                return fallback;
            }
        },
        set(key, value) {
            try {
                window.localStorage?.setItem(key, String(value));
            } catch (error) {
                console.warn("Storage write unavailable:", key, error);
            }
        },
    };

    // -------------------------------------------------------------------------
    // Canvas / DOM references
    // -------------------------------------------------------------------------
    const canvas = document.getElementById("game");
    const ctx = canvas.getContext("2d");

    const minimap = document.getElementById("minimap");
    const minimapCtx = minimap.getContext("2d");

    // Mobile uses a smaller backing canvas and a reduced-detail renderer. This
    // keeps the minimap useful without spending desktop-level fill rate.
    if (window.STARWAKE_PLATFORM_PROFILE?.isMobilePerformance) {
        minimap.width = 120;
        minimap.height = 80;
    }

    const ui = {
        splashScreen: document.getElementById("splashScreen"),
        continueFromSplashButton: document.getElementById("continueFromSplashButton"),
        startMenu: document.getElementById("startMenu"),
        selectedDifficultyLabel: document.getElementById("selectedDifficultyLabel"),
        upgradeMenu: document.getElementById("upgradeMenu"),
        gameOverMenu: document.getElementById("gameOverMenu"),
        pauseOverlay: document.getElementById("pauseOverlay"),
        damageOverlay: document.getElementById("damageOverlay"),
        speedBoostOverlay: document.getElementById("speedBoostOverlay"),
        slowStatusOverlay: document.getElementById("slowStatusOverlay"),
        waveClearOverlay: document.getElementById("waveClearOverlay"),
        waveClearMessage: document.getElementById("waveClearMessage"),
        waveClearTitle: document.getElementById("waveClearTitle"),
        waveClearSubtext: document.getElementById("waveClearSubtext"),
        hudPanel: document.getElementById("ui"),
        hudToggleButton: document.getElementById("hudToggleButton"),

        wave: document.getElementById("wave"),
        health: document.getElementById("health"),
        score: document.getElementById("score"),
        points: document.getElementById("points"),
        weapon: document.getElementById("weapon"),
        menuPoints: document.getElementById("menuPoints"),
        bulletSpeed: document.getElementById("bulletSpeed"),
        explosiveLevel: document.getElementById("explosiveLevel"),
        speedBoostInfo: document.getElementById("speedBoostInfo"),
        slowInfo: document.getElementById("slowInfo"),
        magnetInfo: document.getElementById("magnetInfo"),
        bossInfo: document.getElementById("bossInfo"),
        mapInfo: document.getElementById("mapInfo"),
        finalScore: document.getElementById("finalScore"),
        finalWave: document.getElementById("finalWave"),
        playerHealthBarWrap: document.getElementById("playerHealthBarWrap"),
        playerHealthBar: document.getElementById("playerHealthBar"),
        regenHealthTick: document.getElementById("regenHealthTick"),
        playerHealthText: document.getElementById("playerHealthText"),
        audioToggleButton: document.getElementById("audioToggleButton"),
        audioVolume: document.getElementById("audioVolume"),
        audioStatus: document.getElementById("audioStatus"),
        menuVolume: document.getElementById("menuVolume"),
        pauseVolume: document.getElementById("pauseVolume"),
        menuVolumeValue: document.getElementById("menuVolumeValue"),
        pauseVolumeValue: document.getElementById("pauseVolumeValue"),
        menuMusicVolume: document.getElementById("menuMusicVolume"),
        pauseMusicVolume: document.getElementById("pauseMusicVolume"),
        menuMusicVolumeValue: document.getElementById("menuMusicVolumeValue"),
        pauseMusicVolumeValue: document.getElementById("pauseMusicVolumeValue"),
        menuSfxVolume: document.getElementById("menuSfxVolume"),
        pauseSfxVolume: document.getElementById("pauseSfxVolume"),
        menuSfxVolumeValue: document.getElementById("menuSfxVolumeValue"),
        pauseSfxVolumeValue: document.getElementById("pauseSfxVolumeValue"),
        menuAudioToggleButton: document.getElementById("menuAudioToggleButton"),
        pauseAudioToggleButton: document.getElementById("pauseAudioToggleButton"),
        customCursor: document.getElementById("customCursor"),
        menuCursorColor: document.getElementById("menuCursorColor"),
        pauseCursorColor: document.getElementById("pauseCursorColor"),
        resumeButton: document.getElementById("resumeButton"),
        audioDebugConsole: document.getElementById("audioDebugConsole"),
        audioDebugReadout: document.getElementById("audioDebugReadout"),
        audioDebugToggleButton: document.getElementById("audioDebugToggleButton"),
        audioDebugCloseButton: document.getElementById("audioDebugCloseButton"),
        audioDebugKillButton: document.getElementById("audioDebugKillButton"),
        audioDebugRestartButton: document.getElementById("audioDebugRestartButton"),
        audioDebugExportButton: document.getElementById("audioDebugExportButton"),
        developerModeCheckbox: document.getElementById("developerModeCheckbox"),
        developerModeStatus: document.getElementById("developerModeStatus"),
        debugPanel: document.getElementById("debugPanel"),
        undoUpgradeButton: document.getElementById("undoUpgradeButton"),
    };

    const upgradeButtons = [...document.querySelectorAll("[data-upgrade]")];
    const difficultyButtons = [...document.querySelectorAll("[data-difficulty]")];

    // -------------------------------------------------------------------------
    // Constants and shared helpers
    // -------------------------------------------------------------------------
    const WORLD = Object.freeze({ width: 3600, height: 2400 });
    const TWO_PI = Math.PI * 2;

    const ENEMY_COLORS = Object.freeze({
        normal: "#ff5c5c",
        runner: "#ffb347",
        brute: "#ff3f8f",
        tank: "#b86bff",
        miniTank: "#d58bff",
        fighter: "#55d7ff",
        carrier: "#7b6cff",
        dodger: "#7cffd4",
        boss: "#ff2b2b",
        gigaBoss: "#f7f7ff",
    });

    const DIFFICULTY_DATA = Object.freeze({
        easy: {
            label: "Easy",
            enemyHealth: 0.58,
            enemyDamage: 0.48,
            enemySpeed: 0.74,
            enemyReward: 1.52,
            upgradeCost: 0.76,
            spawnBase: 4,
            spawnGrowth: 1.45,
            spawnDelay: 1.78,
            enemyGrowth: 0.52,
            damageGrowth: 0.005,
            typeUnlockOffset: 4,
            miniTankChance: 0.025,
            maxConcurrent: 14,
            minimumSpawnDistance: 650,
        },
        medium: {
            label: "Medium",
            enemyHealth: 0.90,
            enemyDamage: 0.88,
            enemySpeed: 0.96,
            enemyReward: 1.15,
            upgradeCost: 0.90,
            spawnBase: 6,
            spawnGrowth: 3.0,
            spawnDelay: 1.12,
            enemyGrowth: 0.90,
            damageGrowth: 0.010,
            typeUnlockOffset: 1,
            miniTankChance: 0.09,
            maxConcurrent: 24,
            minimumSpawnDistance: 560,
        },
        hard: {
            label: "Hard",
            enemyHealth: 1.15,
            enemyDamage: 1.14,
            enemySpeed: 1.05,
            enemyReward: 1.10,
            upgradeCost: 1.00,
            spawnBase: 7,
            spawnGrowth: 3.8,
            spawnDelay: 0.90,
            enemyGrowth: 1.12,
            damageGrowth: 0.014,
            typeUnlockOffset: 0,
            miniTankChance: 0.15,
            maxConcurrent: 34,
            minimumSpawnDistance: 500,
        },
        impossible: {
            label: "Impossible",
            enemyHealth: 1.45,
            enemyDamage: 1.55,
            enemySpeed: 1.12,
            enemyReward: 1.15,
            upgradeCost: 1.04,
            spawnBase: 9,
            spawnGrowth: 4.7,
            spawnDelay: 0.72,
            enemyGrowth: 1.35,
            damageGrowth: 0.020,
            typeUnlockOffset: -2,
            miniTankChance: 0.20,
            maxConcurrent: 48,
            minimumSpawnDistance: 450,
        },
    });

    // Ship Reconstruction research catalog.
    // Core upgrades remain repeatable. Advanced, Experimental, Hybrid, and Capstone
    // research are one-time passive modules gated by total investment. None add
    // gameplay buttons; the player's physical inputs remain move + aim.
    const UPGRADE_DATA = Object.freeze({
        multiShot:      { label: "MULTI-SHOT LOGIC", icon: "✦", system: "red", tier: "core", category: "offense", accent: "#ff625f", description: "Weapon AI adds another projectile to each automatic volley.", baseCost: 160, growth: 1.95 },
        damage:         { label: "WEAPON AI POWER", icon: "✹", system: "red", tier: "core", category: "offense", accent: "#ff765f", description: "Improves target analysis and primary-fire impact damage.", baseCost: 70, growth: 1.55 },
        fireRate:       { label: "WEAPON AI CYCLE", icon: "»", system: "red", tier: "core", category: "offense", accent: "#ffb45f", description: "Optimizes firing cadence without adding another control.", baseCost: 90, growth: 1.45 },
        bulletVelocity: { label: "BALLISTIC PREDICTION", icon: "➤", system: "red", tier: "core", category: "offense", accent: "#ff8d70", description: "Weapon AI accelerates projectiles and improves interception timing.", baseCost: 75, growth: 1.38 },
        explosive:      { label: "PLASMA DETONATION", icon: "●", system: "red", tier: "core", category: "offense", accent: "#ff4e42", description: "Primary rounds gain a controlled splash package.", baseCost: 130, growth: 1.70 },

        maxHealth:      { label: "NANOBOT HULL", icon: "♥", system: "green", tier: "core", category: "defense", accent: "#55e889", description: "Nanobots reinforce hull integrity and repair current damage.", baseCost: 140, growth: 1.25 },
        healthRegen:    { label: "REPAIR SWARM", icon: "+", system: "green", tier: "core", category: "defense", accent: "#6dff9c", description: "Nanobots restore hull integrity after avoiding damage.", baseCost: 155, growth: 1.38 },
        lifeSteal:      { label: "SALVAGE NANITES", icon: "♦", system: "green", tier: "core", category: "defense", accent: "#4fe584", description: "Weapon damage recovers fragments as healing energy.", baseCost: 250, growth: 1.55 },

        speed:          { label: "ANTI-GRAVITY THRUST", icon: "⚡", system: "blue", tier: "core", category: "utility", accent: "#5cb8ff", description: "Raises permanent movement speed and handling authority.", baseCost: 85, growth: 1.32 },
        magnet:         { label: "GRAVITY LENS", icon: "∩", system: "blue", tier: "core", category: "utility", accent: "#69d4ff", description: "Bends nearby pickups toward the ship.", baseCost: 95, growth: 1.45 },

        autoMissile:    { label: "QUANTUM MISSILES", icon: "➹", system: "purple", tier: "core", category: "special", accent: "#c675ff", description: "Quantum processors launch autonomous homing missiles.", baseCost: 180, growth: 1.48 },
        damageAura:     { label: "ORBITAL FIELD", icon: "◎", system: "purple", tier: "core", category: "special", accent: "#aa78ff", description: "Autonomous energy damages nearby threats.", baseCost: 165, growth: 1.42 },

        adaptivePlating: { label: "ADAPTIVE PLATING", icon: "⬢", system: "green", tier: "advanced", category: "defense", accent: "#52f18b", description: "Advanced nanobots reduce all incoming damage by 10%.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "green", investment: 3 } },
        combatNanobots: { label: "COMBAT NANOBOTS", icon: "✚", system: "green", tier: "experimental", category: "defense", accent: "#33ff77", description: "Repair delay shortens and regeneration becomes stronger.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "green", investment: 6, upgrade: "adaptivePlating" } },
        livingColony: { label: "LIVING COLONY", icon: "♧", system: "green", tier: "capstone", category: "defense", accent: "#9dffbd", description: "Overhealing becomes a renewable nanobot shield.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "green", investment: 9, upgrade: "combatNanobots" } },

        predictiveTargeting: { label: "PREDICTIVE TARGETING", icon: "⌖", system: "red", tier: "advanced", category: "offense", accent: "#ff705f", description: "Weapon AI increases damage and projectile velocity.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "red", investment: 3 } },
        heatManagement: { label: "HEAT MANAGEMENT", icon: "≋", system: "red", tier: "experimental", category: "offense", accent: "#ff9c54", description: "Reduces the minimum delay between automatic volleys.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "red", investment: 6, upgrade: "predictiveTargeting" } },
        autonomousArsenal: { label: "AUTONOMOUS ARSENAL", icon: "✺", system: "red", tier: "capstone", category: "offense", accent: "#ffd0c7", description: "Every fifth volley automatically deploys two bonus rounds.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "red", investment: 9, upgrade: "heatManagement" } },

        boostCapacitor: { label: "BOOST CAPACITOR", icon: "↟", system: "blue", tier: "advanced", category: "utility", accent: "#59c8ff", description: "Speed pickups last 50% longer and permanent speed rises.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "blue", investment: 3 } },
        inertialDampeners: { label: "INERTIAL DAMPENERS", icon: "◈", system: "blue", tier: "experimental", category: "utility", accent: "#76ddff", description: "Improves handling and weakens hostile slowing effects.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "blue", investment: 6, upgrade: "boostCapacitor" } },
        zeroPointReactor: { label: "ZERO-POINT REACTOR", icon: "◉", system: "blue", tier: "capstone", category: "utility", accent: "#c4f4ff", description: "Massively improves speed and gravity-lens reach.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "blue", investment: 9, upgrade: "inertialDampeners" } },

        combatHeuristics: { label: "COMBAT HEURISTICS", icon: "◇", system: "purple", tier: "advanced", category: "special", accent: "#bd78ff", description: "Autonomous missiles launch faster and hit harder.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "purple", investment: 3 } },
        swarmMatrix: { label: "SWARM MATRIX", icon: "✧", system: "purple", tier: "experimental", category: "special", accent: "#d192ff", description: "Adds autonomous missiles and expands the orbital field.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "purple", investment: 6, upgrade: "combatHeuristics" } },
        distributedConsciousness: { label: "DISTRIBUTED CONSCIOUSNESS", icon: "✣", system: "purple", tier: "capstone", category: "special", accent: "#efd6ff", description: "The autonomous swarm gains three missiles and major damage.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "purple", investment: 9, upgrade: "swarmMatrix" } },

        adaptiveHull: { label: "ADAPTIVE HULL", icon: "♢", system: "hybrid", tier: "hybrid", category: "defense", accent: "#62f0ce", description: "Green + Blue: health pickups also grant a short speed boost.", baseCost: 680, growth: 1, maxLevel: 1, requires: { systems: { green: 3, blue: 3 } } },
        combatAlgorithms: { label: "COMBAT ALGORITHMS", icon: "⌘", system: "hybrid", tier: "hybrid", category: "special", accent: "#ff73cc", description: "Red + Purple: autonomous missiles inherit extra weapon damage.", baseCost: 680, growth: 1, maxLevel: 1, requires: { systems: { red: 3, purple: 3 } } },
        railAcceleration: { label: "RAIL ACCELERATION", icon: "➠", system: "hybrid", tier: "hybrid", category: "offense", accent: "#ff9d86", description: "Red + Blue: projectiles gain major speed and additional damage.", baseCost: 680, growth: 1, maxLevel: 1, requires: { systems: { red: 3, blue: 3 } } },
        livingDrones: { label: "LIVING DRONES", icon: "❖", system: "hybrid", tier: "hybrid", category: "special", accent: "#a8ffbd", description: "Green + Purple: regeneration and autonomous damage reinforce each other.", baseCost: 680, growth: 1, maxLevel: 1, requires: { systems: { green: 3, purple: 3 } } },
    });

    // Platform profile is selected before this script loads. Mobile uses tighter
    // object/audio budgets while sharing identical gameplay systems and save data.
    const PLATFORM_PROFILE = window.STARWAKE_PLATFORM_PROFILE || {
        name: "desktop",
        isMobilePerformance: false,
        renderEveryNFrames: 1,
        spawnMultiplier: 1,
        limits: {},
    };
    const profileLimits = PLATFORM_PROFILE.limits || {};
    const PERFORMANCE_LIMITS = Object.freeze({
        maxPointOrbs: profileLimits.maxPointOrbs ?? 260,
        maxLifeStealOrbs: profileLimits.maxLifeStealOrbs ?? 90,
        maxParticles: profileLimits.maxParticles ?? 180,
        maxDamageNumbers: profileLimits.maxDamageNumbers ?? 120,
        maxBullets: profileLimits.maxBullets ?? 520,
        maxMissiles: profileLimits.maxMissiles ?? 80,
        maxEnemyBullets: profileLimits.maxEnemyBullets ?? 320,
        maxCarrierMissiles: profileLimits.maxCarrierMissiles ?? 100,
        maxExplosions: profileLimits.maxExplosions ?? 64,
        maxEnemies: profileLimits.maxEnemies ?? 120,
        minimapFrameSkip: profileLimits.minimapFrameSkip ?? 2,
        maxCrowdingPairs: profileLimits.maxCrowdingPairs ?? 5000,
    });

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    /**
     * Handles the distance operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function distance(a, b) {
        if (!a || !b || a.dead || b.dead) return Infinity;
        return Math.hypot(a.x - b.x, a.y - b.y);
    }
    const randomRange = (min, max) => min + Math.random() * (max - min);
    const chance = probability => Math.random() < probability;
    const getDifficulty = () => DIFFICULTY_DATA[state.difficulty] || DIFFICULTY_DATA.medium;

    const savedCursorColor = safeStorage.get("starwakeCursorColor") || "#7cffd4";
    const savedAudioVolume = clamp(Number(safeStorage.get("starwakeMasterVolume") ?? 78), 0, 100);
    const savedMusicVolume = clamp(Number(safeStorage.get("starwakeMusicVolume") ?? 82), 0, 100);
    const savedSfxVolume = clamp(Number(safeStorage.get("starwakeSfxVolume") ?? 92), 0, 100);
    const savedAudioEnabled = safeStorage.get("starwakeAudioEnabled") !== "false";
    const savedDeveloperMode = safeStorage.get("starwakeDeveloperMode") === "true";

    // -------------------------------------------------------------------------
    // Procedural music and redesigned sound effects
    // -------------------------------------------------------------------------
    const audio = {
        context: null,
        masterGain: null,
        compressor: null,
        masterSoftClip: null,
        masterLimiter: null,
        outputCeiling: null,
        musicGain: null,
        sfxGain: null,
        sfxCompressor: null,
        kickBus: null,
        enabled: savedAudioEnabled,
        volume: savedAudioVolume / 100,
        musicVolume: savedMusicVolume / 100,
        sfxVolume: savedSfxVolume / 100,
        musicTimer: null,
        stepIndex: 0,
        nextStepTime: 0,
        mode: "normal",
        pendingMode: null,
        lastShotSoundAt: 0,
        noiseBuffer: null,
        kickBuffer: null,
        persistentFire: null,
        persistentPickup: null,
        persistentExplosion: null,
        persistentEnemyWeapon: null,
        persistentUi: null,
        currentSourcePersistent: false,
        phraseIndex: 0,
        progressionIndex: 0,
        melodySeed: 0,
        currentMelody: [],
        lastWaveForMusic: 0,

        // Audio-load protection. Dense waves can request hundreds of layered SFX
        // events per second. These fields enforce a bounded semantic event budget
        // before those requests are expanded into oscillators, filters, and gains.
        sfxLastPlayed: Object.create(null),
        sfxWindowStartedAt: 0,
        sfxEventsInWindow: 0,
        maxSfxEventsPerSecond: profileLimits.maxSfxEventsPerSecond ?? 40,
        musicWatchdogTimer: null,

        // Voice-pressure guardrails. The music engine is protected; expendable SFX
        // are shed before the Web Audio graph reaches the instability observed in
        // late waves. Values are intentionally conservative for Chromium/Linux.
        softVoiceLimit: profileLimits.softVoiceLimit ?? 52,
        hardVoiceLimit: profileLimits.hardVoiceLimit ?? 68,
        currentSfxPriority: null,
        currentSfxCategory: null,

        // Live diagnostics: source nodes are registered at start and removed onended.
        // This exposes actual active-source pressure instead of guessing from sound events.
        diagnostics: {
            activeSources: new Set(),
            createdSources: 0,
            endedSources: 0,
            forcedStops: 0,
            droppedEvents: 0,
            schedulerCalls: 0,
            schedulerErrors: 0,
            lastSchedulerAt: 0,
            peakActiveSources: 0,
            voiceSteals: 0,
            softVoiceDrops: 0,
            hardVoiceDrops: 0,
            lastError: "None",
            eventCounts: Object.create(null),
            log: [],
        },
    };

    const MUSIC_PATTERNS = Object.freeze({
        normal: {
            bpm: 124,
            rootMidi: 41, // F2
            progression: [0, 5, 3, 6], // Fm - Db - Ab - Eb
            bassGain: 0.145,
            melodyGain: 0.050,
            padGain: 0.052,
            arpGain: 0.030,
            density: 0.66,
        },
        boss: {
            bpm: 136,
            rootMidi: 41,
            progression: [0, 6, 5, 6], // Fm - Eb - Db - Eb
            bassGain: 0.180,
            melodyGain: 0.064,
            padGain: 0.064,
            arpGain: 0.045,
            density: 0.82,
        },
        gigaBoss: {
            bpm: 148,
            rootMidi: 41,
            progression: [0, 1, 6, 0], // Fm - Gb - Eb - Fm
            bassGain: 0.215,
            melodyGain: 0.078,
            padGain: 0.078,
            arpGain: 0.062,
            density: 0.96,
        },
    });

    const MINOR_SCALE = Object.freeze([0, 2, 3, 5, 7, 8, 10]);
    const MINOR_CHORDS = Object.freeze({
        0: [0, 3, 7],
        1: [1, 5, 8],
        3: [3, 7, 10],
        5: [5, 8, 0],
        6: [7, 10, 2],
    });

    /**
     * Handles the midiToFrequency operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function midiToFrequency(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * Handles the seededRandom operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function seededRandom(seed) {
        const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
        return x - Math.floor(x);
    }

    /**
     * Handles the generateMelody operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function generateMelody(pattern) {
        const waveSeed = Math.max(1, state.wave || 1);
        const seed = waveSeed * 97 + audio.phraseIndex * 31 + (audio.mode === "boss" ? 701 : audio.mode === "gigaBoss" ? 1409 : 0);
        const melody = new Array(32).fill(null);
        let previousDegree = 4;

        for (let step = 0; step < 32; step++) {
            const beatPosition = step % 8;
            const chanceToPlay = beatPosition === 0 ? 0.92 : beatPosition === 4 ? 0.72 : pattern.density * 0.52;
            if (seededRandom(seed + step * 5) > chanceToPlay) continue;

            const chordSlot = Math.floor(step / 8) % pattern.progression.length;
            const chordRoot = pattern.progression[chordSlot];
            const chordTones = MINOR_CHORDS[chordRoot] || [chordRoot, (chordRoot + 3) % 12, (chordRoot + 7) % 12];
            let semitone;

            if (beatPosition === 0 || beatPosition === 4) {
                semitone = chordTones[Math.floor(seededRandom(seed + step * 11) * chordTones.length)];
            } else {
                const movement = seededRandom(seed + step * 17) < 0.5 ? -1 : 1;
                previousDegree = clamp(previousDegree + movement, 0, MINOR_SCALE.length - 1);
                semitone = MINOR_SCALE[previousDegree];
            }

            const octave = seededRandom(seed + step * 23) > 0.83 ? 2 : 1;
            melody[step] = midiToFrequency(pattern.rootMidi + 12 * octave + semitone);
        }

        // A repeated hook makes the generated line feel intentional rather than random.
        melody[24] = melody[0];
        melody[26] = melody[2] || midiToFrequency(pattern.rootMidi + 24 + 7);
        melody[28] = melody[4] || midiToFrequency(pattern.rootMidi + 24 + 8);
        melody[30] = midiToFrequency(pattern.rootMidi + 24 + 7);
        audio.currentMelody = melody;
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function makeDistortionCurve(amount = 40) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const k = Math.max(1, amount);
        for (let i = 0; i < samples; i++) {
            const x = i * 2 / samples - 1;
            curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function createNoiseBuffer() {
        const length = audio.context.sampleRate * 2;
        const buffer = audio.context.createBuffer(1, length, audio.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function createBitcrushedKickBuffer() {
        const sampleRate = audio.context.sampleRate;
        const duration = 0.42;
        const buffer = audio.context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
        const data = buffer.getChannelData(0);
        const bits = 6;
        const levels = 2 ** bits;
        const holdSamples = 5;
        let held = 0;

        for (let i = 0; i < data.length; i++) {
            const t = i / sampleRate;
            const pitch = 155 * Math.exp(-t * 30) + 42;
            const body = Math.sin(TWO_PI * pitch * t) * Math.exp(-t * 10.5);
            const click = (Math.random() * 2 - 1) * Math.exp(-t * 85) * 0.34;
            const raw = Math.tanh((body + click) * 2.8);
            if (i % holdSamples === 0) held = Math.round(raw * levels) / levels;
            data[i] = held * 0.92;
        }
        return buffer;
    }

    /**
     * Builds a normalized tanh soft-clipping curve for the master safety bus.
     * The curve should remain subtle: its job is to round dangerous peaks before
     * limiting, not to become an audible distortion effect.
     */
    function makeSoftClipCurve(drive = 1.5) {
        const samples = 4096;
        const curve = new Float32Array(samples);
        const normalizer = Math.tanh(drive) || 1;
        for (let i = 0; i < samples; i++) {
            const x = i * 2 / (samples - 1) - 1;
            curve[i] = Math.tanh(x * drive) / normalizer;
        }
        return curve;
    }

    /** Registers source nodes created by any synth, including musicEngine.js.
     * Wrapping the AudioContext factories gives one authoritative voice count even
     * when different subsystems create their own oscillators and buffer sources. */
    function instrumentAudioContext(context) {
        if (!context || context.__starwakeInstrumented) return;
        context.__starwakeInstrumented = true;
        for (const factoryName of ["createOscillator", "createBufferSource"]) {
            const originalFactory = context[factoryName].bind(context);
            context[factoryName] = (...args) => {
                const source = originalFactory(...args);
                const originalStart = source.start.bind(source);
                const originalStop = source.stop.bind(source);
                let registered = false;
                let ended = false;
                const sourceMeta = {
                    priority: audio.currentSfxPriority ?? 5, // music/default is protected
                    category: audio.currentSfxCategory ?? "music",
                    startedAt: 0,
                    persistent: Boolean(audio.currentSourcePersistent),
                };
                source.__starwakeMeta = sourceMeta;
                const unregister = () => {
                    if (ended) return;
                    ended = true;
                    audio.diagnostics.activeSources.delete(source);
                    audio.diagnostics.endedSources++;
                    try { source.disconnect(); } catch (_) {}
                };
                source.start = (...startArgs) => {
                    if (!registered) {
                        // At the hard ceiling, steal the oldest expendable voice before
                        // allowing another protected/important source to start.
                        const transientCount = [...audio.diagnostics.activeSources].filter(node => !node.__starwakeMeta?.persistent).length;
                        if (transientCount >= audio.hardVoiceLimit) {
                            const candidates = [...audio.diagnostics.activeSources]
                                .filter(node => !node.__starwakeMeta?.persistent && (node.__starwakeMeta?.priority ?? 5) <= 2)
                                .sort((a, b) => (a.__starwakeMeta?.startedAt ?? 0) - (b.__starwakeMeta?.startedAt ?? 0));
                            const victim = candidates[0];
                            if (victim) {
                                try { victim.stop(); } catch (_) {}
                                try { victim.disconnect(); } catch (_) {}
                                audio.diagnostics.activeSources.delete(victim);
                                audio.diagnostics.voiceSteals++;
                                audio.diagnostics.forcedStops++;
                            }
                        }
                        registered = true;
                        sourceMeta.startedAt = performance.now();
                        audio.diagnostics.activeSources.add(source);
                        audio.diagnostics.createdSources++;
                        audio.diagnostics.peakActiveSources = Math.max(audio.diagnostics.peakActiveSources, audio.diagnostics.activeSources.size);
                    }
                    return originalStart(...startArgs);
                };
                source.stop = (...stopArgs) => {
                    try { return originalStop(...stopArgs); }
                    catch (error) { unregister(); throw error; }
                };
                source.addEventListener("ended", unregister, { once: true });
                return source;
            };
        }
    }

    function appendAudioDiagnostic(message) {
        const entry = `${new Date().toISOString()} ${message}`;
        audio.diagnostics.log.push(entry);
        if (audio.diagnostics.log.length > 200) audio.diagnostics.log.shift();
    }

    function getTransientAudioVoiceCount() {
        let count = 0;
        for (const source of audio.diagnostics.activeSources) {
            if (!source.__starwakeMeta?.persistent) count++;
        }
        return count;
    }


    function killAllAudioVoices(rebuildPersistentFire = true) {
        // The persistent player-fire oscillators are intentionally long-lived, so a
        // diagnostic "Kill Voices" action must explicitly destroy and recreate them.
        // During a full engine restart, pass false because the AudioContext is about
        // to be closed and ensureAudio() will rebuild the synth on the new context.
        PersistentFireSynth.destroy();
        PersistentPickupSynth.destroy();
        PersistentExplosionSynth.destroy();
        PersistentEnemyWeaponSynth.destroy();
        PersistentUiSynth.destroy();
        // The procedural soundtrack now owns a fixed persistent instrument rack.
        // Destroy it explicitly before force-stopping tracked sources so the next
        // scheduler tick can rebuild a complete, playable rack on this context.
        if (window.StarwakeMusicEngine?.destroy) window.StarwakeMusicEngine.destroy();
        for (const source of [...audio.diagnostics.activeSources]) {
            try { source.stop(); } catch (_) {}
            try { source.disconnect(); } catch (_) {}
            audio.diagnostics.activeSources.delete(source);
            audio.diagnostics.forcedStops++;
        }
        if (rebuildPersistentFire && audio.context && audio.context.state !== "closed") {
            PersistentFireSynth.ensure();
            PersistentPickupSynth.ensure();
            PersistentExplosionSynth.ensure();
            PersistentEnemyWeaponSynth.ensure();
            PersistentUiSynth.ensure();
        }
        appendAudioDiagnostic("Forced all active source voices to stop.");
    }

    async function restartAudioEngine() {
        appendAudioDiagnostic("Audio restart requested.");
        if (audio.musicTimer) clearInterval(audio.musicTimer);
        if (audio.musicWatchdogTimer) clearInterval(audio.musicWatchdogTimer);
        audio.musicTimer = null;
        audio.musicWatchdogTimer = null;
        killAllAudioVoices(false);
        const oldContext = audio.context;
        for (const key of ["context","masterGain","compressor","masterSoftClip","masterLimiter","outputCeiling","musicGain","sfxGain","sfxCompressor","kickBus","noiseBuffer","kickBuffer","persistentFire","persistentPickup","persistentExplosion","persistentEnemyWeapon","persistentUi"]) audio[key] = null;
        if (oldContext && oldContext.state !== "closed") {
            try { await oldContext.close(); } catch (_) {}
        }
        if (ensureAudio()) {
            try { await audio.context.resume(); } catch (_) {}
            startMusicLoop();
            appendAudioDiagnostic("Audio engine rebuilt successfully.");
        }
    }

    function getAudioDiagnosticsText() {
        const d = audio.diagnostics;
        const contextState = audio.context?.state || "not-created";
        const schedulerAge = d.lastSchedulerAt ? Math.round(performance.now() - d.lastSchedulerAt) : -1;
        const limiterReduction = Number.isFinite(audio.masterLimiter?.reduction) ? audio.masterLimiter.reduction.toFixed(1) : "n/a";
        const sfxReduction = Number.isFinite(audio.sfxCompressor?.reduction) ? audio.sfxCompressor.reduction.toFixed(1) : "n/a";
        return [
            `Context: ${contextState}`,
            `Wave / Mode: ${state.wave} / ${audio.mode}`,
            `Active sources: ${d.activeSources.size} total / ${getTransientAudioVoiceCount()} transient`,
            `Peak sources: ${d.peakActiveSources}`,
            `Created / ended: ${d.createdSources} / ${d.endedSources}`,
            `Forced stops: ${d.forcedStops}`,
            `SFX events this second: ${audio.sfxEventsInWindow}/${audio.maxSfxEventsPerSecond}`,
            `Dropped SFX events: ${d.droppedEvents}`,
            `Voice guard: soft ${audio.softVoiceLimit} / hard ${audio.hardVoiceLimit}`,
            `Pressure drops: ${d.softVoiceDrops} soft / ${d.hardVoiceDrops} hard`,
            `Voice steals: ${d.voiceSteals}`,
            `Persistent rack: fire ${audio.persistentFire ? "ready" : "off"} / pickup ${audio.persistentPickup ? "ready" : "off"} / explosion ${audio.persistentExplosion ? "ready" : "off"} / enemy ${audio.persistentEnemyWeapon ? "ready" : "off"} / UI ${audio.persistentUi ? "ready" : "off"}`,
            `Music rack: ${window.StarwakeMusicEngine?.getDiagnostics?.().initialized ? "ready" : "off"} / ${window.StarwakeMusicEngine?.getDiagnostics?.().architecture || "unavailable"}`,
            `Scheduler: ${audio.musicTimer ? "running" : "stopped"}`,
            `Scheduler age: ${schedulerAge < 0 ? "never" : schedulerAge + " ms"}`,
            `Scheduler calls/errors: ${d.schedulerCalls}/${d.schedulerErrors}`,
            `Limiter reduction: ${limiterReduction} dB`,
            `SFX compression: ${sfxReduction} dB`,
            `Enemies: ${enemies.length}`,
            `Projectiles: ${bullets.length + missiles.length + enemyBullets.length + carrierMissiles.length}`,
            `Particles / explosions: ${particles.length}/${explosions.length}`,
            `Last audio error: ${d.lastError}`,
        ].join("\n");
    }

    function updateAudioDebugConsole() {
        if (!ui.audioDebugConsole || ui.audioDebugConsole.hidden || !ui.audioDebugReadout) return;
        ui.audioDebugReadout.textContent = getAudioDiagnosticsText();
    }

    function exportAudioDiagnostics() {
        const body = `${getAudioDiagnosticsText()}\n\nRecent log:\n${audio.diagnostics.log.join("\n")}`;
        const blob = new Blob([body], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `starwake-audio-debug-wave-${state.wave}.txt`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Creates Web Audio nodes lazily after user interaction. Audio failures must degrade gracefully and never stop gameplay.
     */
    function ensureAudio() {
        if (audio.context) return true;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
            ui.audioStatus.textContent = "Audio unsupported";
            return false;
        }

        audio.context = new AudioContext();
        instrumentAudioContext(audio.context);
        audio.masterGain = audio.context.createGain();
        audio.compressor = audio.context.createDynamicsCompressor();
        audio.masterSoftClip = audio.context.createWaveShaper();
        audio.masterLimiter = audio.context.createDynamicsCompressor();
        audio.outputCeiling = audio.context.createGain();
        audio.musicGain = audio.context.createGain();
        audio.sfxGain = audio.context.createGain();
        audio.sfxCompressor = audio.context.createDynamicsCompressor();
        audio.kickBus = audio.context.createGain();

        audio.masterGain.gain.value = audio.enabled ? audio.volume : 0;
        // Music and SFX use independent user-controlled buses. Do not fold these
        // values back into master volume; keeping the buses separate is what lets
        // players raise gameplay cues without making the soundtrack overpowering.
        audio.musicGain.gain.value = audio.musicVolume;
        audio.sfxGain.gain.value = audio.sfxVolume;
        audio.kickBus.gain.value = 1.05;

        // SFX have sharper transients than music. This dedicated compressor keeps
        // explosions and stacked impacts punchy without allowing them to clip the
        // shared master bus or flatten the soundtrack every time several enemies die.
        audio.sfxCompressor.threshold.value = -12;
        audio.sfxCompressor.knee.value = 10;
        audio.sfxCompressor.ratio.value = 7;
        audio.sfxCompressor.attack.value = 0.002;
        audio.sfxCompressor.release.value = 0.11;

        // First stage: gentle glue compression. This controls average density but is
        // intentionally not the final safety device.
        audio.compressor.threshold.value = -20;
        audio.compressor.knee.value = 16;
        audio.compressor.ratio.value = 4;
        audio.compressor.attack.value = 0.008;
        audio.compressor.release.value = 0.20;

        // Second stage: a smooth saturating transfer curve catches inter-sample-like
        // peaks before they reach the limiter. Avoid increasing this drive casually;
        // too much saturation makes the entire mix sound flat and brittle.
        audio.masterSoftClip.curve = makeSoftClipCurve(1.55);
        audio.masterSoftClip.oversample = "4x";

        // Final stage: high-ratio peak limiter plus a conservative output ceiling.
        // Web Audio does not expose a dedicated brick-wall limiter node, so this
        // compressor is configured as the closest practical real-time equivalent.
        audio.masterLimiter.threshold.value = -5.5;
        audio.masterLimiter.knee.value = 0;
        audio.masterLimiter.ratio.value = 20;
        audio.masterLimiter.attack.value = 0.001;
        audio.masterLimiter.release.value = 0.075;
        audio.outputCeiling.gain.value = 0.82;

        audio.kickBus.connect(audio.musicGain);
        audio.musicGain.connect(audio.compressor);
        audio.sfxGain.connect(audio.sfxCompressor);
        audio.sfxCompressor.connect(audio.compressor);
        audio.compressor.connect(audio.masterSoftClip);
        audio.masterSoftClip.connect(audio.masterLimiter);
        audio.masterLimiter.connect(audio.outputCeiling);
        audio.outputCeiling.connect(audio.masterGain);
        audio.masterGain.connect(audio.context.destination);

        audio.noiseBuffer = createNoiseBuffer();
        audio.kickBuffer = createBitcrushedKickBuffer();
        PersistentFireSynth.ensure();
        PersistentPickupSynth.ensure();
        PersistentExplosionSynth.ensure();
        PersistentEnemyWeaponSynth.ensure();
        PersistentUiSynth.ensure();
        return true;
    }

    /**
     * Handles the resumeAudio operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function resumeAudio() {
        if (!ensureAudio()) return;

        const finishResume = () => {
            startMusicLoop();
            ui.audioStatus.textContent = audio.enabled ? `Beat: ${audio.mode}` : "Muted";
        };

        if (audio.context.state === "suspended") {
            audio.context.resume().then(finishResume).catch(() => {
                ui.audioStatus.textContent = "Click Start to unlock audio";
            });
            return;
        }
        finishResume();
    }

    /**
     * Handles the syncAudioControls operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function syncAudioControls() {
        const masterPercent = Math.round(audio.volume * 100);
        const musicPercent = Math.round(audio.musicVolume * 100);
        const sfxPercent = Math.round(audio.sfxVolume * 100);

        for (const slider of [ui.audioVolume, ui.menuVolume, ui.pauseVolume]) {
            if (slider && Number(slider.value) !== masterPercent) slider.value = String(masterPercent);
        }
        for (const slider of [ui.menuMusicVolume, ui.pauseMusicVolume]) {
            if (slider && Number(slider.value) !== musicPercent) slider.value = String(musicPercent);
        }
        for (const slider of [ui.menuSfxVolume, ui.pauseSfxVolume]) {
            if (slider && Number(slider.value) !== sfxPercent) slider.value = String(sfxPercent);
        }

        if (ui.menuVolumeValue) ui.menuVolumeValue.textContent = `${masterPercent}%`;
        if (ui.pauseVolumeValue) ui.pauseVolumeValue.textContent = `${masterPercent}%`;
        if (ui.menuMusicVolumeValue) ui.menuMusicVolumeValue.textContent = `${musicPercent}%`;
        if (ui.pauseMusicVolumeValue) ui.pauseMusicVolumeValue.textContent = `${musicPercent}%`;
        if (ui.menuSfxVolumeValue) ui.menuSfxVolumeValue.textContent = `${sfxPercent}%`;
        if (ui.pauseSfxVolumeValue) ui.pauseSfxVolumeValue.textContent = `${sfxPercent}%`;

        const label = audio.enabled ? "Sound: On" : "Sound: Off";
        for (const button of [ui.audioToggleButton, ui.menuAudioToggleButton, ui.pauseAudioToggleButton]) {
            if (button) button.textContent = label;
        }
    }

    /**
     * Mutes or restores audio without destroying the graph, allowing fast menu toggles and reliable resume behavior.
     */
    function setAudioEnabled(enabled) {
        audio.enabled = enabled;
        safeStorage.set("starwakeAudioEnabled", String(enabled));
        if (ensureAudio()) {
            audio.masterGain.gain.setTargetAtTime(enabled ? audio.volume : 0, audio.context.currentTime, 0.02);
        }
        ui.audioStatus.textContent = enabled ? `Beat: ${audio.mode}` : "Muted";
        syncAudioControls();
    }

    /**
     * Updates the shared master volume and synchronized controls. Persisting settings should always be wrapped in safe storage helpers.
     */
    function setAudioVolume(value) {
        const percent = clamp(Number(value), 0, 100);
        audio.volume = percent / 100;
        safeStorage.set("starwakeMasterVolume", String(percent));
        if (audio.masterGain) {
            audio.masterGain.gain.setTargetAtTime(audio.enabled ? audio.volume : 0, audio.context.currentTime, 0.02);
        }
        syncAudioControls();
    }

    /**
     * Updates the music bus only. Keep this separate from master and SFX so menu
     * mixing remains predictable and future music-engine changes cannot overwrite
     * the player's preferred balance.
     */
    function setMusicVolume(value) {
        const percent = clamp(Number(value), 0, 100);
        audio.musicVolume = percent / 100;
        safeStorage.set("starwakeMusicVolume", String(percent));
        if (audio.musicGain) {
            audio.musicGain.gain.setTargetAtTime(audio.musicVolume, audio.context.currentTime, 0.02);
        }
        syncAudioControls();
    }

    /**
     * Updates the sound-effects bus only. All WeaponSynth, PickupSynth, enemy,
     * impact, and explosion voices must continue routing through audio.sfxGain.
     */
    function setSfxVolume(value) {
        const percent = clamp(Number(value), 0, 100);
        audio.sfxVolume = percent / 100;
        safeStorage.set("starwakeSfxVolume", String(percent));
        if (audio.sfxGain) {
            audio.sfxGain.gain.setTargetAtTime(audio.sfxVolume, audio.context.currentTime, 0.02);
        }
        syncAudioControls();
    }

    /**
     * Requests a soundtrack state change. Keep transitions smooth and avoid restarting the transport unless timing must change.
     */
    function setMusicMode(mode) {
        if (audio.mode === mode || audio.pendingMode === mode) return;
        audio.pendingMode = mode;
        setTimeout(() => {
            audio.mode = audio.pendingMode ?? mode;
            audio.pendingMode = null;
            audio.stepIndex = 0;
            audio.phraseIndex = 0;
            audio.currentMelody = [];
            audio.nextStepTime = audio.context ? audio.context.currentTime + 0.03 : 0;
            if (ui.audioStatus) ui.audioStatus.textContent = audio.enabled ? `Beat: ${audio.mode}` : "Muted";
        }, 80);
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateMusicMode() {
        if (!state.started || state.ended || state.paused || state.clearPhaseActive) {
            setMusicMode("normal");
            return;
        }
        if (enemies.some(enemy => enemy.type === "gigaBoss")) setMusicMode("gigaBoss");
        else if (enemies.some(enemy => enemy.type === "boss" || enemy.type === "miniTank")) setMusicMode("boss");
        else setMusicMode("normal");
    }

    /**
     * Handles the startMusicLoop operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function startMusicLoop() {
        if (audio.musicTimer || !audio.context) return;
        audio.nextStepTime = audio.context.currentTime + 0.05;
        audio.musicTimer = setInterval(scheduleMusicBeat, 25);

        // Watchdog: browser throttling or a transient scheduling exception must not
        // permanently silence the soundtrack. This does not create a second loop;
        // it only restores the one authoritative scheduler when it disappears.
        if (!audio.musicWatchdogTimer) {
            audio.musicWatchdogTimer = setInterval(() => {
                if (!audio.context || !audio.enabled) return;
                if (!audio.musicTimer) {
                    audio.nextStepTime = audio.context.currentTime + 0.05;
                    audio.musicTimer = setInterval(scheduleMusicBeat, 25);
                }
                if (audio.context.state === "suspended" && state.started && !state.paused) {
                    audio.context.resume().catch(() => {});
                }
            }, 1000);
        }
    }

    /**
     * Handles the restartMusicLoop operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function restartMusicLoop() {
        if (audio.musicTimer) clearInterval(audio.musicTimer);
        audio.musicTimer = null;
        audio.stepIndex = 0;
        if (window.StarwakeMusicEngine) window.StarwakeMusicEngine.reset(audio);
        if (audio.context) startMusicLoop();
    }

    /**
     * Handles the scheduleMusicBeat operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function scheduleMusicBeat() {
        audio.diagnostics.schedulerCalls++;
        audio.diagnostics.lastSchedulerAt = performance.now();
        try {
            if (window.StarwakeMusicEngine) {
                window.StarwakeMusicEngine.schedule({ audio, state });
                return;
            }
            if (!audio.context || !audio.enabled) return;
            audio.nextStepTime = audio.context.currentTime + 0.05;
        } catch (error) {
            // Keep gameplay alive and let the watchdog retry on the next tick. A
            // single malformed voice must never permanently kill the transport.
            audio.diagnostics.schedulerErrors++;
            audio.diagnostics.lastError = error?.message || String(error);
            appendAudioDiagnostic(`Scheduler error: ${audio.diagnostics.lastError}`);
            console.warn("Music scheduler recovered from an audio error:", error);
            if (audio.context) audio.nextStepTime = audio.context.currentTime + 0.08;
        }
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playSequencerStep(step, time, pattern, secondsPerStep) {
        const localStep = step % 16;
        const bar = Math.floor(step / 16);
        const chordIndex = Math.floor(localStep / 4) % pattern.progression.length;
        const chordRoot = pattern.progression[chordIndex];
        const chordTones = MINOR_CHORDS[chordRoot] || [chordRoot, (chordRoot + 3) % 12, (chordRoot + 7) % 12];

        if (localStep % 4 === 0) {
            const kickStrength = localStep === 0 ? 1.0 : 0.88;
            playKick(time, kickStrength);
            playKickSaw(time, kickStrength, chordRoot);
            playPadChord(time, pattern, chordTones, secondsPerStep * 7.7);
            playSubDrone(time, pattern, chordRoot, secondsPerStep * 3.7);
        }
        if (audio.mode !== "normal" && (localStep === 6 || localStep === 14)) {
            playKick(time, 0.42);
            playKickSaw(time, 0.34, chordRoot);
        }

        if (localStep === 4 || localStep === 12) playSnare(time, audio.mode === "gigaBoss" ? 0.18 : 0.14);
        if (localStep % 2 === 0) playHiHat(time, 0.034, false);
        if (localStep === 2 || localStep === 6 || localStep === 10 || localStep === 14) playHiHat(time, 0.052, true);

        const bassPatterns = [0, 0, 7, 0, 0, 7, 10, 7, 0, 0, 3, 7, 0, 10, 7, 3];
        const bassSemitone = (chordRoot + bassPatterns[localStep]) % 12;
        if (localStep % 2 === 0 || audio.mode !== "normal") {
            const bassFrequency = midiToFrequency(pattern.rootMidi - 12 + bassSemitone);
            playBass(bassFrequency, time, pattern.bassGain, localStep % 4 === 0 ? 0.15 : 0.095);
        }

        // Trance arpeggio: chord tones cycle in sixteenth notes and intensify in boss modes.
        const arpOrder = [0, 1, 2, 1, 0, 2, 1, 2];
        const arpTone = chordTones[arpOrder[localStep % arpOrder.length] % chordTones.length];
        const arpFrequency = midiToFrequency(pattern.rootMidi + 24 + arpTone);
        if (audio.mode !== "normal" || localStep % 2 === 1) {
            playTranceArp(arpFrequency, time + 0.006, secondsPerStep * 0.88, pattern.arpGain, localStep);
        }

        const melodyFrequency = audio.currentMelody[step];
        if (melodyFrequency) {
            const duration = (localStep % 4 === 0 ? secondsPerStep * 2.6 : secondsPerStep * 1.45);
            playMelodyNote(melodyFrequency, time + 0.012, duration, pattern.melodyGain, bar);
        }

        if (audio.mode === "gigaBoss" && localStep % 4 === 2 && melodyFrequency) {
            playMelodyNote(melodyFrequency * 0.5, time + 0.018, secondsPerStep * 1.2, pattern.melodyGain * 0.55, 1);
        }
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playMelodyNote(frequency, time, duration, gainAmount, variation = 0) {
        const oscA = audio.context.createOscillator();
        const oscB = audio.context.createOscillator();
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        oscA.type = "square";
        oscB.type = "sawtooth";
        oscA.frequency.setValueAtTime(frequency, time);
        oscB.frequency.setValueAtTime(frequency, time);
        oscB.detune.value = variation ? 8 : -6;
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(audio.mode === "normal" ? 1800 : 2600, time);
        filter.Q.value = 2.2;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(gainAmount, time + 0.012);
        gain.gain.setTargetAtTime(gainAmount * 0.48, time + 0.045, 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        oscA.connect(filter);
        oscB.connect(filter);
        filter.connect(gain);
        gain.connect(audio.musicGain);
        oscA.start(time); oscB.start(time);
        oscA.stop(time + duration + 0.03); oscB.stop(time + duration + 0.03);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playPadChord(time, pattern, chordTones, duration) {
        const gain = audio.context.createGain();
        const filter = audio.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(audio.mode === "normal" ? 980 : 1500, time);
        filter.frequency.exponentialRampToValueAtTime(audio.mode === "normal" ? 520 : 760, time + duration * 0.78);
        filter.Q.value = 1.1;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(pattern.padGain, time + 0.32);
        gain.gain.setTargetAtTime(pattern.padGain * 0.82, time + 0.55, 0.65);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        filter.connect(gain);
        gain.connect(audio.musicGain);

        const spread = [-13, -6, 6, 13];
        chordTones.forEach((semitone, index) => {
            for (let layer = 0; layer < 2; layer++) {
                const osc = audio.context.createOscillator();
                osc.type = layer === 0 ? "sawtooth" : "triangle";
                osc.frequency.setValueAtTime(midiToFrequency(pattern.rootMidi + 12 + semitone), time);
                osc.detune.value = spread[(index * 2 + layer) % spread.length];
                osc.connect(filter);
                osc.start(time);
                osc.stop(time + duration + 0.05);
            }
        });
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playSubDrone(time, pattern, chordRoot, duration) {
        const oscA = audio.context.createOscillator();
        const oscB = audio.context.createOscillator();
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        const frequency = midiToFrequency(pattern.rootMidi - 24 + chordRoot);
        oscA.type = "sine";
        oscB.type = "triangle";
        oscA.frequency.setValueAtTime(frequency, time);
        oscB.frequency.setValueAtTime(frequency * 2, time);
        oscB.detune.value = -5;
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(240, time);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(pattern.bassGain * 0.55, time + 0.035);
        gain.gain.setTargetAtTime(pattern.bassGain * 0.30, time + 0.12, 0.18);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        oscA.connect(filter); oscB.connect(filter); filter.connect(gain); gain.connect(audio.musicGain);
        oscA.start(time); oscB.start(time); oscA.stop(time + duration + 0.03); oscB.stop(time + duration + 0.03);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playTranceArp(frequency, time, duration, gainAmount, step) {
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        filter.type = "lowpass";
        const brightness = audio.mode === "normal" ? 1900 : audio.mode === "boss" ? 3100 : 4300;
        filter.frequency.setValueAtTime(brightness, time);
        filter.Q.value = 2.8;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(gainAmount, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        filter.connect(gain); gain.connect(audio.musicGain);
        [-10, 0, 10].forEach((detune, i) => {
            const osc = audio.context.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(frequency * (i === 1 && step % 8 === 7 ? 2 : 1), time);
            osc.detune.value = detune;
            osc.connect(filter);
            osc.start(time); osc.stop(time + duration + 0.025);
        });
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playKick(time, strength = 1) {
        const source = audio.context.createBufferSource();
        const drive = audio.context.createWaveShaper();
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        source.buffer = audio.kickBuffer;
        drive.curve = makeDistortionCurve(72);
        drive.oversample = "4x";
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1150, time);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.68 * strength, time + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);
        source.connect(drive);
        drive.connect(filter);
        filter.connect(gain);
        gain.connect(audio.kickBus);
        source.start(time);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playKickSaw(time, strength = 1, chordRoot = 0) {
        const oscillatorA = audio.context.createOscillator();
        const oscillatorB = audio.context.createOscillator();
        const filter = audio.context.createBiquadFilter();
        const drive = audio.context.createWaveShaper();
        const gain = audio.context.createGain();

        const baseMidi = MUSIC_PATTERNS[audio.mode].rootMidi - 12 + chordRoot;
        const rootFrequency = midiToFrequency(baseMidi);
        const buzzDuration = audio.mode === "gigaBoss" ? 0.38 : 0.44;

        oscillatorA.type = "sawtooth";
        oscillatorB.type = "sawtooth";
        oscillatorA.frequency.setValueAtTime(rootFrequency * 2, time);
        oscillatorB.frequency.setValueAtTime(rootFrequency * 2, time);
        oscillatorA.frequency.exponentialRampToValueAtTime(rootFrequency, time + 0.11);
        oscillatorB.frequency.exponentialRampToValueAtTime(rootFrequency, time + 0.115);
        oscillatorA.detune.setValueAtTime(-7, time);
        oscillatorB.detune.setValueAtTime(7, time);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1450, time);
        filter.frequency.exponentialRampToValueAtTime(280, time + buzzDuration * 0.82);
        filter.Q.setValueAtTime(4.8, time);

        drive.curve = makeDistortionCurve(52);
        drive.oversample = "4x";

        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.15 * strength, time + 0.005);
        gain.gain.setTargetAtTime(0.075 * strength, time + 0.055, 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + buzzDuration);

        oscillatorA.connect(filter);
        oscillatorB.connect(filter);
        filter.connect(drive);
        drive.connect(gain);
        gain.connect(audio.musicGain);
        oscillatorA.start(time);
        oscillatorB.start(time);
        oscillatorA.stop(time + buzzDuration + 0.025);
        oscillatorB.stop(time + buzzDuration + 0.025);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playSnare(time, gainAmount = 0.14) {
        const source = audio.context.createBufferSource();
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        source.buffer = audio.noiseBuffer;
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1700, time);
        filter.Q.value = 0.75;
        gain.gain.setValueAtTime(gainAmount, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(audio.musicGain);
        source.start(time);
        source.stop(time + 0.18);
        playTone(185, 0.09, "triangle", gainAmount * 0.55, time, audio.musicGain, 900);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playHiHat(time, gainAmount = 0.035, open = false) {
        const source = audio.context.createBufferSource();
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        source.buffer = audio.noiseBuffer;
        filter.type = "highpass";
        filter.frequency.setValueAtTime(open ? 5200 : 7000, time);
        gain.gain.setValueAtTime(gainAmount, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.16 : 0.045));
        source.connect(filter);
        filter.connect(gain);
        gain.connect(audio.musicGain);
        source.start(time);
        source.stop(time + (open ? 0.18 : 0.06));
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playBass(frequency, time, gainAmount = 0.12, duration = 0.12) {
        const osc = audio.context.createOscillator();
        const sub = audio.context.createOscillator();
        const drive = audio.context.createWaveShaper();
        const filter = audio.context.createBiquadFilter();
        const gain = audio.context.createGain();
        osc.type = "sawtooth";
        sub.type = "sine";
        osc.frequency.setValueAtTime(frequency, time);
        sub.frequency.setValueAtTime(frequency / 2, time);
        drive.curve = makeDistortionCurve(audio.mode === "normal" ? 20 : 38);
        drive.oversample = "2x";
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(audio.mode === "normal" ? 420 : 560, time);
        filter.Q.value = 2.2;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(gainAmount, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        osc.connect(drive);
        sub.connect(drive);
        drive.connect(filter);
        filter.connect(gain);
        gain.connect(audio.musicGain);
        osc.start(time);
        sub.start(time);
        osc.stop(time + duration + 0.03);
        sub.stop(time + duration + 0.03);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playTone(frequency, duration, type = "sine", gain = 0.1, startTime = null, destination = null, filterFrequency = 1800) {
        if (!audio.context || !audio.enabled) return;
        const time = startTime ?? audio.context.currentTime;
        const osc = audio.context.createOscillator();
        const gainNode = audio.context.createGain();
        const filter = audio.context.createBiquadFilter();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, time);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(filterFrequency, time);
        gainNode.gain.setValueAtTime(0.0001, time);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.006);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(destination ?? audio.sfxGain);
        osc.start(time);
        osc.stop(time + duration + 0.03);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    function playNoise(duration, gain = 0.08, startTime = null, destination = null, filterFrequency = 1400, filterType = "bandpass") {
        if (!audio.context || !audio.enabled) return;
        const time = startTime ?? audio.context.currentTime;
        const source = audio.context.createBufferSource();
        const gainNode = audio.context.createGain();
        const filter = audio.context.createBiquadFilter();
        source.buffer = audio.noiseBuffer;
        filter.type = filterType;
        filter.frequency.setValueAtTime(filterFrequency, time);
        gainNode.gain.setValueAtTime(gain, time);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(destination ?? audio.sfxGain);
        source.start(time);
        source.stop(time + duration + 0.02);
    }

    /**
     * Schedules or produces an audio voice. Keep gain conservative because multiple voices may overlap.
     */
    /**
     * Creates a pitched synth voice with an explicit frequency sweep. This is the
     * core building block for weapon zaps, warning tones, impacts, and UI cues.
     * Keep the destination configurable so future weapon buses can be added without
     * rewriting every sound definition.
     */
    function playPitchSweep({
        startFrequency,
        endFrequency,
        duration,
        type = "sawtooth",
        gain = 0.1,
        time = audio.context.currentTime,
        filterStart = 3200,
        filterEnd = 700,
        resonance = 1.2,
        destination = audio.sfxGain,
        distortion = 0,
    }) {
        if (!audio.context || !audio.enabled) return;
        const osc = audio.context.createOscillator();
        const filter = audio.context.createBiquadFilter();
        const envelope = audio.context.createGain();
        const drive = distortion > 0 ? audio.context.createWaveShaper() : null;

        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, startFrequency), time);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), time + duration);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(Math.max(80, filterStart), time);
        filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterEnd), time + duration);
        filter.Q.value = resonance;
        envelope.gain.setValueAtTime(0.0001, time);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.004);
        envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        osc.connect(filter);
        if (drive) {
            drive.curve = makeDistortionCurve(distortion);
            drive.oversample = "2x";
            filter.connect(drive);
            drive.connect(envelope);
        } else {
            filter.connect(envelope);
        }
        envelope.connect(destination);
        osc.start(time);
        osc.stop(time + duration + 0.03);
    }

    /**
     * Produces a filtered noise burst with a controlled attack. Noise carries the
     * physical texture of impacts, debris, sparks, claps, and explosive transients.
     */
    function playNoiseBurst({
        duration,
        gain = 0.1,
        time = audio.context.currentTime,
        filterType = "bandpass",
        frequency = 1200,
        endFrequency = null,
        resonance = 0.8,
        attack = 0.001,
        destination = audio.sfxGain,
    }) {
        if (!audio.context || !audio.enabled || !audio.noiseBuffer) return;
        const source = audio.context.createBufferSource();
        const filter = audio.context.createBiquadFilter();
        const envelope = audio.context.createGain();
        source.buffer = audio.noiseBuffer;
        filter.type = filterType;
        filter.frequency.setValueAtTime(frequency, time);
        if (endFrequency && endFrequency > 0) {
            filter.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
        }
        filter.Q.value = resonance;
        envelope.gain.setValueAtTime(0.0001, time);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        source.connect(filter);
        filter.connect(envelope);
        envelope.connect(destination);
        source.start(time);
        source.stop(time + duration + 0.02);
    }

    /**
     * Persistent player-fire synthesizer.
     *
     * WHY THIS EXISTS:
     * Automatic fire used to allocate one or more OscillatorNodes per bullet. Under
     * pressure those short-lived voices were correctly shed by the voice guard, but
     * that also removed the player's most important cadence feedback. These two
     * oscillators are created once, run silently, and are retriggered only through
     * AudioParam automation. A shot therefore creates zero new source nodes.
     *
     * LIFECYCLE CONTRACT:
     * - ensure() may be called before every shot and must remain allocation-free once
     *   the current AudioContext owns a healthy synth.
     * - destroy() must run before rebuilding/closing the AudioContext.
     * - Persistent fire sources use priority 6 and category "playerFirePersistent";
     *   ordinary voice stealing must never target them.
     */
    const PersistentFireSynth = (() => {
        function safeCancel(param, time) {
            try {
                if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
                else {
                    param.cancelScheduledValues(time);
                    param.setValueAtTime(Math.max(0.0001, Number(param.value) || 0.0001), time);
                }
            } catch (_) {
                try { param.cancelScheduledValues(time); } catch (_) {}
            }
        }

        function destroy() {
            const synth = audio.persistentFire;
            if (!synth) return;
            for (const osc of [synth.bodyOsc, synth.snapOsc]) {
                try { osc.stop(); } catch (_) {}
                try { osc.disconnect(); } catch (_) {}
            }
            for (const node of [synth.bodyFilter, synth.bodyGain, synth.snapFilter, synth.snapGain]) {
                try { node.disconnect(); } catch (_) {}
            }
            audio.persistentFire = null;
        }

        function ensure() {
            if (!audio.context || !audio.sfxGain) return null;
            const existing = audio.persistentFire;
            if (existing && existing.context === audio.context) return existing;
            if (existing) destroy();

            const ctx = audio.context;
            const previousPriority = audio.currentSfxPriority;
            const previousCategory = audio.currentSfxCategory;
            audio.currentSfxPriority = 6;
            audio.currentSfxCategory = "playerFirePersistent";

            try {
                const bodyOsc = ctx.createOscillator();
                const bodyFilter = ctx.createBiquadFilter();
                const bodyGain = ctx.createGain();
                const snapOsc = ctx.createOscillator();
                const snapFilter = ctx.createBiquadFilter();
                const snapGain = ctx.createGain();

                bodyOsc.type = "sawtooth";
                bodyOsc.frequency.value = 170;
                bodyFilter.type = "lowpass";
                bodyFilter.frequency.value = 900;
                bodyFilter.Q.value = 2.1;
                bodyGain.gain.value = 0.0001;

                snapOsc.type = "sawtooth";
                snapOsc.frequency.value = 2100;
                snapFilter.type = "bandpass";
                snapFilter.frequency.value = 3600;
                snapFilter.Q.value = 3.4;
                snapGain.gain.value = 0.0001;

                bodyOsc.connect(bodyFilter);
                bodyFilter.connect(bodyGain);
                bodyGain.connect(audio.sfxGain);
                snapOsc.connect(snapFilter);
                snapFilter.connect(snapGain);
                snapGain.connect(audio.sfxGain);

                bodyOsc.start();
                snapOsc.start();

                audio.persistentFire = {
                    context: ctx,
                    bodyOsc, bodyFilter, bodyGain,
                    snapOsc, snapFilter, snapGain,
                    lastTriggerAt: -Infinity,
                };
                return audio.persistentFire;
            } catch (error) {
                audio.diagnostics.lastError = error?.message || String(error);
                appendAudioDiagnostic(`Persistent fire synth creation failed: ${audio.diagnostics.lastError}`);
                destroy();
                return null;
            } finally {
                audio.currentSfxPriority = previousPriority;
                audio.currentSfxCategory = previousCategory;
            }
        }

        function trigger(level = 0, time = audio.context?.currentTime ?? 0) {
            if (!audio.enabled || !audio.context) return false;
            const synth = ensure();
            if (!synth) return false;

            const safeLevel = clamp(Math.floor(level || 0), 0, 40);
            const power = safeLevel / 40;
            const jitter = 1 + (Math.random() * 2 - 1) * 0.012;
            const bodyPeak = 0.046 + power * 0.018;
            const snapPeak = 0.064 + power * 0.020;

            // Retrigger safely even when the previous pew envelope is still decaying.
            for (const param of [
                synth.bodyGain.gain, synth.snapGain.gain,
                synth.bodyOsc.frequency, synth.snapOsc.frequency,
                synth.bodyFilter.frequency, synth.snapFilter.frequency,
            ]) safeCancel(param, time);

            synth.bodyGain.gain.setValueAtTime(0.0001, time);
            synth.bodyGain.gain.exponentialRampToValueAtTime(bodyPeak, time + 0.032);
            synth.bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.145);
            synth.bodyOsc.frequency.setValueAtTime((205 + safeLevel * 2.0) * jitter, time);
            synth.bodyOsc.frequency.exponentialRampToValueAtTime((108 + safeLevel) * jitter, time + 0.15);
            synth.bodyFilter.frequency.setValueAtTime(1450 + safeLevel * 30, time);
            synth.bodyFilter.frequency.exponentialRampToValueAtTime(520 + safeLevel * 12, time + 0.15);

            const snapTime = time + 0.018;
            synth.snapGain.gain.setValueAtTime(0.0001, time);
            synth.snapGain.gain.setValueAtTime(0.0001, snapTime);
            synth.snapGain.gain.exponentialRampToValueAtTime(snapPeak, snapTime + 0.006);
            synth.snapGain.gain.exponentialRampToValueAtTime(0.0001, snapTime + 0.105);
            synth.snapOsc.frequency.setValueAtTime((2850 + safeLevel * 42) * jitter, time);
            synth.snapOsc.frequency.exponentialRampToValueAtTime((620 + safeLevel * 7) * jitter, snapTime + 0.052);
            synth.snapOsc.frequency.exponentialRampToValueAtTime((980 + safeLevel * 9) * jitter, snapTime + 0.075);
            synth.snapOsc.frequency.exponentialRampToValueAtTime((410 + safeLevel * 4) * jitter, snapTime + 0.11);
            synth.snapFilter.frequency.setValueAtTime(5600 + safeLevel * 55, time);
            synth.snapFilter.frequency.exponentialRampToValueAtTime(1250 + safeLevel * 15, snapTime + 0.11);

            synth.lastTriggerAt = performance.now();
            return true;
        }

        return Object.freeze({ ensure, trigger, destroy });
    })();

    /**
     * Reusable procedural weapon synthesizer.
     *
     * DESIGN CONTRACT:
     * - Gameplay code requests semantic weapon events; it must not construct raw
     *   Web Audio nodes itself.
     * - Upgrade levels change timbre and texture, not only loudness. This prevents
     *   high-level weapons from becoming dangerously loud while still sounding
     *   more powerful and complex.
     * - Every voice has a short, explicit stop time. Never add infinite oscillators
     *   here: automatic fire can otherwise leak thousands of live audio nodes.
     * - Explosive-round impacts deliberately avoid the full enemy-death explosion
     *   sound. They use a compact plasma discharge so splash builds remain readable
     *   and do not starve the music scheduler during dense late waves.
     */
    const WeaponSynth = Object.freeze({
        playPrimary(level = 0, time = audio.context.currentTime) {
            if (!audio.context || !audio.enabled) return;

            const ctx = audio.context;
            const safeLevel = clamp(Math.floor(level || 0), 0, 40);
            const power = safeLevel / 40;
            const pitchJitter = 1 + (Math.random() * 2 - 1) * 0.018;

            // Low saw body: a real 0.10-0.15 second rise makes this read as a
            // projectile discharge rather than a mouse-click transient.
            const bodyOsc = ctx.createOscillator();
            const bodyFilter = ctx.createBiquadFilter();
            const bodyDrive = ctx.createWaveShaper();
            const bodyGain = ctx.createGain();
            bodyOsc.type = "sawtooth";
            bodyOsc.frequency.setValueAtTime((175 + safeLevel * 2.2) * pitchJitter, time);
            bodyOsc.frequency.exponentialRampToValueAtTime((105 + safeLevel * 1.1) * pitchJitter, time + 0.18);
            bodyFilter.type = "lowpass";
            bodyFilter.frequency.setValueAtTime(1150 + safeLevel * 42, time);
            bodyFilter.frequency.exponentialRampToValueAtTime(520 + safeLevel * 15, time + 0.2);
            bodyFilter.Q.value = 1.8 + power * 2.2;
            bodyDrive.curve = makeDistortionCurve(18 + safeLevel * 1.5);
            bodyDrive.oversample = "2x";
            bodyGain.gain.setValueAtTime(0.0001, time);
            bodyGain.gain.exponentialRampToValueAtTime(0.052 + power * 0.025, time + 0.115);
            bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
            bodyOsc.connect(bodyFilter);
            bodyFilter.connect(bodyDrive);
            bodyDrive.connect(bodyGain);
            bodyGain.connect(audio.sfxGain);
            bodyOsc.start(time);
            bodyOsc.stop(time + 0.245);

            // High elastic saw: rapid downward bend, slight rebound, then release.
            // The rebound is the "rubber-band" character requested for the pew.
            const snapTime = time + 0.035;
            const snapOsc = ctx.createOscillator();
            const snapFilter = ctx.createBiquadFilter();
            const snapGain = ctx.createGain();
            snapOsc.type = "sawtooth";
            const top = 2450 + safeLevel * 55;
            snapOsc.frequency.setValueAtTime(top * pitchJitter, snapTime);
            snapOsc.frequency.exponentialRampToValueAtTime((720 + safeLevel * 8) * pitchJitter, snapTime + 0.07);
            snapOsc.frequency.exponentialRampToValueAtTime((980 + safeLevel * 12) * pitchJitter, snapTime + 0.108);
            snapOsc.frequency.exponentialRampToValueAtTime((390 + safeLevel * 5) * pitchJitter, snapTime + 0.175);
            snapFilter.type = "bandpass";
            snapFilter.frequency.setValueAtTime(5000 + safeLevel * 80, snapTime);
            snapFilter.frequency.exponentialRampToValueAtTime(1250 + safeLevel * 18, snapTime + 0.18);
            snapFilter.Q.value = 3.2 + power * 2.6;
            snapGain.gain.setValueAtTime(0.0001, snapTime);
            snapGain.gain.exponentialRampToValueAtTime(0.074 + power * 0.026, snapTime + 0.012);
            snapGain.gain.exponentialRampToValueAtTime(0.0001, snapTime + 0.19);
            snapOsc.connect(snapFilter);
            snapFilter.connect(snapGain);
            snapGain.connect(audio.sfxGain);
            snapOsc.start(snapTime);
            snapOsc.stop(snapTime + 0.215);

            // Higher levels gain one quiet harmonic—not more volume. This gives
            // progression a richer identity without multiplying the node count at
            // every level or flooding the mix during rapid fire.
            if (safeLevel >= 6) {
                playPitchSweep({
                    startFrequency: top * 1.48,
                    endFrequency: 850 + safeLevel * 10,
                    duration: 0.11,
                    type: safeLevel >= 18 ? "sawtooth" : "triangle",
                    gain: 0.012 + Math.min(0.018, safeLevel * 0.0007),
                    time: snapTime + 0.004,
                    filterStart: 7600,
                    filterEnd: 2400,
                    resonance: 2.2,
                    distortion: safeLevel >= 18 ? 10 + safeLevel * 0.4 : 0,
                });
            }

            playNoiseBurst({
                duration: 0.045 + power * 0.02,
                gain: 0.012 + power * 0.008,
                time: snapTime + 0.01,
                filterType: "highpass",
                frequency: 6500,
                endFrequency: 9200,
                resonance: 0.35,
            });
        },

        /**
         * Lightweight fallback used when the global audio graph is under pressure.
         * It intentionally uses one oscillator source so the player's firing rhythm
         * remains audible without recreating the full layered pew for every bullet.
         */
        playCadencePulse(level = 0, time = audio.context.currentTime) {
            if (!audio.context || !audio.enabled) return;

            const ctx = audio.context;
            const safeLevel = clamp(Math.floor(level || 0), 0, 40);
            const pitchJitter = 1 + (Math.random() * 2 - 1) * 0.012;
            const osc = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();

            osc.type = "sawtooth";
            osc.frequency.setValueAtTime((1120 + safeLevel * 16) * pitchJitter, time);
            osc.frequency.exponentialRampToValueAtTime((390 + safeLevel * 5) * pitchJitter, time + 0.075);

            filter.type = "bandpass";
            filter.frequency.setValueAtTime(2600 + safeLevel * 28, time);
            filter.frequency.exponentialRampToValueAtTime(850 + safeLevel * 10, time + 0.08);
            filter.Q.value = 2.8;

            gain.gain.setValueAtTime(0.0001, time);
            gain.gain.exponentialRampToValueAtTime(0.055, time + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(audio.sfxGain);
            osc.start(time);
            osc.stop(time + 0.095);
        },

        playExplosiveImpact(level = 1, time = audio.context.currentTime) {
            if (!audio.context || !audio.enabled) return;

            const safeLevel = clamp(Math.floor(level || 1), 1, 40);
            const power = safeLevel / 40;
            const pitch = 1 + (Math.random() * 2 - 1) * 0.045;

            // Compact plasma "pwaang": distinctive from both the primary pew and
            // enemy-death explosion, and intentionally limited to three short voices.
            playPitchSweep({
                startFrequency: (720 + safeLevel * 12) * pitch,
                endFrequency: (115 + safeLevel * 2) * pitch,
                duration: 0.11 + power * 0.035,
                type: "sawtooth",
                gain: 0.052 + power * 0.018,
                time,
                filterStart: 2800 + safeLevel * 55,
                filterEnd: 430 + safeLevel * 9,
                resonance: 3.0,
                distortion: 20 + safeLevel * 0.9,
            });

            // Electrical arc supplies the futuristic "zzzt" without any boom tail.
            playNoiseBurst({
                duration: 0.07 + power * 0.025,
                gain: 0.026 + power * 0.01,
                time: time + 0.008,
                filterType: "bandpass",
                frequency: 3600 + safeLevel * 70,
                endFrequency: 1450 + safeLevel * 20,
                resonance: 4.0,
                attack: 0.002,
            });

            // Quiet upward energy tail keeps high-level splash hits melodic.
            playPitchSweep({
                startFrequency: (260 + safeLevel * 4) * pitch,
                endFrequency: (620 + safeLevel * 12) * pitch,
                duration: 0.105,
                type: "triangle",
                gain: 0.018 + power * 0.007,
                time: time + 0.018,
                filterStart: 1800,
                filterEnd: 4200,
                resonance: 1.5,
            });
        },
    });



    /**
     * Procedural pickup synthesizer.
     *
     * DESIGN CONTRACT:
     * - Pickup type determines the sound's physical metaphor: health rises warmly,
     *   speed accelerates outward, damage charges with electrical weight, slow
     *   collapses inward, and harmful pickups sound corrupted.
     * - Repeated pickups collected within a short window are folded into a small
     *   stack value. The stack raises pitch, width, and intensity slightly instead
     *   of spawning an uncontrolled wall of identical full-volume voices.
     * - Keep every voice finite. Pickups can chain rapidly during boss cleanup.
     */
    const PersistentAudioRackUtils = Object.freeze({
        cancel(param, time) {
            try {
                if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
                else {
                    param.cancelScheduledValues(time);
                    param.setValueAtTime(Math.max(0.0001, Number(param.value) || 0.0001), time);
                }
            } catch (_) {
                try { param.cancelScheduledValues(time); } catch (_) {}
            }
        },
        withPersistentMeta(category, callback) {
            const previousPriority = audio.currentSfxPriority;
            const previousCategory = audio.currentSfxCategory;
            const previousPersistent = audio.currentSourcePersistent;
            audio.currentSfxPriority = 6;
            audio.currentSfxCategory = category;
            audio.currentSourcePersistent = true;
            try { return callback(); }
            finally {
                audio.currentSfxPriority = previousPriority;
                audio.currentSfxCategory = previousCategory;
                audio.currentSourcePersistent = previousPersistent;
            }
        },
        disconnectAll(nodes) {
            for (const node of nodes || []) {
                try { node.disconnect(); } catch (_) {}
            }
        },
    });

    /**
     * Persistent pickup instrument.
     *
     * One tonal oscillator, one harmonic oscillator, and one looping noise source
     * are created once. Pickup events only automate their gains, filters, pitch,
     * and pan. This keeps pickup feedback punchy without increasing transient voice
     * pressure or causing garbage-collection spikes during reward collection.
     */
    const PersistentPickupSynth = (() => {
        const recent = new Map();
        function getStack(type) {
            const now = performance.now();
            const previous = recent.get(type) || { at: -Infinity, count: 0 };
            const count = now - previous.at < 650 ? Math.min(4, previous.count + 1) : 1;
            recent.set(type, { at: now, count });
            return count;
        }
        function destroy() {
            const synth = audio.persistentPickup;
            if (!synth) return;
            for (const source of [synth.bodyOsc, synth.sparkOsc, synth.noise]) {
                try { source.stop(); } catch (_) {}
            }
            PersistentAudioRackUtils.disconnectAll(Object.values(synth).filter(v => v && typeof v.disconnect === "function"));
            audio.persistentPickup = null;
        }
        function ensure() {
            if (!audio.context || !audio.sfxGain || !audio.noiseBuffer) return null;
            if (audio.persistentPickup?.context === audio.context) return audio.persistentPickup;
            destroy();
            return PersistentAudioRackUtils.withPersistentMeta("pickupPersistent", () => {
                const ctx = audio.context;
                const bodyOsc = ctx.createOscillator();
                const bodyFilter = ctx.createBiquadFilter();
                const bodyGain = ctx.createGain();
                const sparkOsc = ctx.createOscillator();
                const sparkFilter = ctx.createBiquadFilter();
                const sparkGain = ctx.createGain();
                const noise = ctx.createBufferSource();
                const noiseFilter = ctx.createBiquadFilter();
                const noiseGain = ctx.createGain();
                const panner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : ctx.createGain();
                bodyOsc.type = "sawtooth";
                sparkOsc.type = "triangle";
                noise.buffer = audio.noiseBuffer;
                noise.loop = true;
                bodyFilter.type = "lowpass";
                sparkFilter.type = "bandpass";
                noiseFilter.type = "highpass";
                bodyGain.gain.value = sparkGain.gain.value = noiseGain.gain.value = 0.0001;
                bodyOsc.connect(bodyFilter); bodyFilter.connect(bodyGain); bodyGain.connect(panner);
                sparkOsc.connect(sparkFilter); sparkFilter.connect(sparkGain); sparkGain.connect(panner);
                noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(panner);
                panner.connect(audio.sfxGain);
                bodyOsc.start(); sparkOsc.start(); noise.start();
                audio.persistentPickup = { context: ctx, bodyOsc, bodyFilter, bodyGain, sparkOsc, sparkFilter, sparkGain, noise, noiseFilter, noiseGain, panner };
                return audio.persistentPickup;
            });
        }
        function trigger(type, time = audio.context?.currentTime ?? 0) {
            if (!audio.enabled || !audio.context) return false;
            const s = ensure();
            if (!s) return false;
            const stack = getStack(type);
            const c = PersistentAudioRackUtils.cancel;
            for (const param of [s.bodyGain.gain,s.sparkGain.gain,s.noiseGain.gain,s.bodyOsc.frequency,s.sparkOsc.frequency,s.bodyFilter.frequency,s.sparkFilter.frequency,s.noiseFilter.frequency]) c(param,time);
            if (s.panner.pan) c(s.panner.pan,time);
            const cfg = {
                speed:  { body:[175,520,0.42,0.070], spark:[430,2100,0.38,0.050], noise:[450,6800,0.40,0.060], pan:[-0.8,0.8] },
                health: { body:[196,392,0.34,0.075], spark:[392,784,0.38,0.058], noise:[2200,6200,0.24,0.028], pan:[-0.15,0.15] },
                damage: { body:[92,310,0.38,0.090], spark:[420,1480,0.30,0.048], noise:[900,4200,0.27,0.040], pan:[-0.25,0.25] },
                slow:   { body:[330,72,0.39,0.078], spark:[980,120,0.36,0.050], noise:[5200,280,0.36,0.050], pan:[0.65,-0.65] },
                harm:   { body:[260,48,0.42,0.100], spark:[610,88,0.35,0.055], noise:[1300,210,0.34,0.065], pan:[0.35,-0.35] },
            }[type] || { body:[180,360,0.3,0.06], spark:[480,960,0.3,0.04], noise:[1800,4800,0.2,0.025], pan:[0,0] };
            const boost = 1 + (stack - 1) * 0.08;
            const schedule = (osc, gain, filter, values, filterStart, filterEnd) => {
                const [startF,endF,duration,peak] = values;
                osc.frequency.setValueAtTime(Math.max(20,startF*boost),time);
                osc.frequency.exponentialRampToValueAtTime(Math.max(20,endF*boost),time+duration);
                filter.frequency.setValueAtTime(Math.max(40,filterStart),time);
                filter.frequency.exponentialRampToValueAtTime(Math.max(40,filterEnd),time+duration);
                gain.gain.setValueAtTime(0.0001,time);
                gain.gain.exponentialRampToValueAtTime(peak*(1+(stack-1)*0.10),time+Math.min(0.09,duration*0.42));
                gain.gain.exponentialRampToValueAtTime(0.0001,time+duration);
            };
            schedule(s.bodyOsc,s.bodyGain,s.bodyFilter,cfg.body, Math.max(300,cfg.body[0]*5), Math.max(180,cfg.body[1]*3));
            schedule(s.sparkOsc,s.sparkGain,s.sparkFilter,cfg.spark, Math.max(900,cfg.spark[0]*3), Math.max(500,cfg.spark[1]*2));
            const [nStart,nEnd,nDur,nPeak]=cfg.noise;
            s.noiseFilter.frequency.setValueAtTime(Math.max(40,nStart),time);
            s.noiseFilter.frequency.exponentialRampToValueAtTime(Math.max(40,nEnd),time+nDur);
            s.noiseGain.gain.setValueAtTime(0.0001,time);
            s.noiseGain.gain.exponentialRampToValueAtTime(nPeak*(1+(stack-1)*0.08),time+Math.min(0.12,nDur*0.65));
            s.noiseGain.gain.exponentialRampToValueAtTime(0.0001,time+nDur);
            if (s.panner.pan) {
                s.panner.pan.setValueAtTime(cfg.pan[0],time);
                s.panner.pan.linearRampToValueAtTime(cfg.pan[1],time+Math.max(cfg.body[2],cfg.spark[2],nDur));
            }
            return true;
        }
        return Object.freeze({ ensure, destroy, playSpeed:t=>trigger("speed",t), playHealth:t=>trigger("health",t), playDamage:t=>trigger("damage",t), playSlow:t=>trigger("slow",t), playHarm:t=>trigger("harm",t) });
    })();

    /** Three reusable explosion voices. Dense kill bursts retrigger the oldest slot. */
    const PersistentExplosionSynth = (() => {
        function createVoice(ctx,index) {
            const osc=ctx.createOscillator(), filter=ctx.createBiquadFilter(), gain=ctx.createGain();
            const noise=ctx.createBufferSource(), noiseFilter=ctx.createBiquadFilter(), noiseGain=ctx.createGain();
            osc.type="sawtooth"; filter.type="lowpass"; noise.buffer=audio.noiseBuffer; noise.loop=true; noiseFilter.type="bandpass";
            gain.gain.value=noiseGain.gain.value=0.0001;
            osc.connect(filter); filter.connect(gain); gain.connect(audio.sfxGain);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(audio.sfxGain);
            osc.start(); noise.start();
            return {osc,filter,gain,noise,noiseFilter,noiseGain,index,lastUsed:-Infinity};
        }
        function destroy(){ const rack=audio.persistentExplosion; if(!rack)return; for(const v of rack.voices){for(const x of [v.osc,v.noise]){try{x.stop()}catch(_){}} PersistentAudioRackUtils.disconnectAll(Object.values(v).filter(x=>x&&typeof x.disconnect==="function"));} audio.persistentExplosion=null; }
        function ensure(){ if(!audio.context||!audio.noiseBuffer)return null; if(audio.persistentExplosion?.context===audio.context)return audio.persistentExplosion; destroy(); return PersistentAudioRackUtils.withPersistentMeta("explosionPersistent",()=>{const rack={context:audio.context,voices:[0,1,2].map(i=>createVoice(audio.context,i)),cursor:0}; audio.persistentExplosion=rack; return rack;}); }
        function trigger(time=audio.context?.currentTime??0){ if(!audio.enabled)return false; const rack=ensure(); if(!rack)return false; const v=rack.voices[rack.cursor++%rack.voices.length]; const c=PersistentAudioRackUtils.cancel; for(const p of [v.osc.frequency,v.filter.frequency,v.gain.gain,v.noiseFilter.frequency,v.noiseGain.gain])c(p,time); const jitter=0.92+Math.random()*0.16; v.osc.frequency.setValueAtTime(150*jitter,time); v.osc.frequency.exponentialRampToValueAtTime(38*jitter,time+0.28); v.filter.frequency.setValueAtTime(950,time); v.filter.frequency.exponentialRampToValueAtTime(120,time+0.28); v.gain.gain.setValueAtTime(0.0001,time); v.gain.gain.exponentialRampToValueAtTime(0.12,time+0.008); v.gain.gain.exponentialRampToValueAtTime(0.0001,time+0.30); v.noiseFilter.frequency.setValueAtTime(3100,time); v.noiseFilter.frequency.exponentialRampToValueAtTime(320,time+0.20); v.noiseGain.gain.setValueAtTime(0.0001,time); v.noiseGain.gain.exponentialRampToValueAtTime(0.085,time+0.004); v.noiseGain.gain.exponentialRampToValueAtTime(0.0001,time+0.22); v.lastUsed=performance.now(); return true; }
        return Object.freeze({ensure,destroy,trigger});
    })();

    /** Four reusable hostile-shot voices; enemy barrages no longer allocate per shot. */
    const PersistentEnemyWeaponSynth = (() => {
        function createVoice(ctx){const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),noise=ctx.createBufferSource(),noiseFilter=ctx.createBiquadFilter(),noiseGain=ctx.createGain(); osc.type="sawtooth"; filter.type="bandpass"; gain.gain.value=0.0001; noise.buffer=audio.noiseBuffer; noise.loop=true; noiseFilter.type="bandpass"; noiseGain.gain.value=0.0001; osc.connect(filter);filter.connect(gain);gain.connect(audio.sfxGain);noise.connect(noiseFilter);noiseFilter.connect(noiseGain);noiseGain.connect(audio.sfxGain);osc.start();noise.start();return{osc,filter,gain,noise,noiseFilter,noiseGain};}
        function destroy(){const r=audio.persistentEnemyWeapon;if(!r)return;for(const v of r.voices){for(const x of [v.osc,v.noise]){try{x.stop()}catch(_){}}PersistentAudioRackUtils.disconnectAll(Object.values(v).filter(x=>x&&typeof x.disconnect==="function"));}audio.persistentEnemyWeapon=null;}
        function ensure(){if(!audio.context||!audio.noiseBuffer)return null;if(audio.persistentEnemyWeapon?.context===audio.context)return audio.persistentEnemyWeapon;destroy();return PersistentAudioRackUtils.withPersistentMeta("enemyWeaponPersistent",()=>{const r={context:audio.context,voices:[0,1,2,3].map(()=>createVoice(audio.context)),cursor:0};audio.persistentEnemyWeapon=r;return r;});}
        function trigger(time=audio.context?.currentTime??0){if(!audio.enabled)return false;const r=ensure();if(!r)return false;const v=r.voices[r.cursor++%r.voices.length],c=PersistentAudioRackUtils.cancel,p=0.95+Math.random()*0.1;for(const x of [v.osc.frequency,v.filter.frequency,v.gain.gain,v.noiseFilter.frequency,v.noiseGain.gain])c(x,time);v.osc.frequency.setValueAtTime(340*p,time);v.osc.frequency.exponentialRampToValueAtTime(105*p,time+0.14);v.filter.frequency.setValueAtTime(1650,time);v.filter.frequency.exponentialRampToValueAtTime(330,time+0.14);v.gain.gain.setValueAtTime(0.0001,time);v.gain.gain.exponentialRampToValueAtTime(0.078,time+0.004);v.gain.gain.exponentialRampToValueAtTime(0.0001,time+0.15);v.noiseFilter.frequency.setValueAtTime(1900,time);v.noiseFilter.frequency.exponentialRampToValueAtTime(760,time+0.07);v.noiseGain.gain.setValueAtTime(0.0001,time);v.noiseGain.gain.exponentialRampToValueAtTime(0.026,time+0.003);v.noiseGain.gain.exponentialRampToValueAtTime(0.0001,time+0.075);return true;}
        return Object.freeze({ensure,destroy,trigger});
    })();

    /** Persistent UI instrument for point pickups, upgrades, and wave-clear cues. */
    const PersistentUiSynth = (() => {
        function destroy(){const s=audio.persistentUi;if(!s)return;for(const x of [s.oscA,s.oscB]){try{x.stop()}catch(_){}}PersistentAudioRackUtils.disconnectAll(Object.values(s).filter(x=>x&&typeof x.disconnect==="function"));audio.persistentUi=null;}
        function ensure(){if(!audio.context)return null;if(audio.persistentUi?.context===audio.context)return audio.persistentUi;destroy();return PersistentAudioRackUtils.withPersistentMeta("uiPersistent",()=>{const ctx=audio.context,oscA=ctx.createOscillator(),oscB=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gainA=ctx.createGain(),gainB=ctx.createGain();oscA.type="triangle";oscB.type="sine";filter.type="lowpass";gainA.gain.value=gainB.gain.value=0.0001;oscA.connect(gainA);oscB.connect(gainB);gainA.connect(filter);gainB.connect(filter);filter.connect(audio.sfxGain);oscA.start();oscB.start();audio.persistentUi={context:ctx,oscA,oscB,filter,gainA,gainB};return audio.persistentUi;});}
        function trigger(kind,time=audio.context?.currentTime??0){if(!audio.enabled)return false;const s=ensure();if(!s)return false;const c=PersistentAudioRackUtils.cancel;for(const p of [s.oscA.frequency,s.oscB.frequency,s.filter.frequency,s.gainA.gain,s.gainB.gain])c(p,time);const cfg={pickup:[660,990,0.14,0.060],upgrade:[220,880,0.42,0.085],waveClear:[392,1046,0.52,0.080]}[kind]||[440,660,0.18,0.05];const[a,b,d,g]=cfg;s.oscA.frequency.setValueAtTime(a,time);s.oscA.frequency.exponentialRampToValueAtTime(b,time+d);s.oscB.frequency.setValueAtTime(a*1.5,time);s.oscB.frequency.exponentialRampToValueAtTime(b*1.25,time+d);s.filter.frequency.setValueAtTime(1800,time);s.filter.frequency.exponentialRampToValueAtTime(5600,time+d);s.gainA.gain.setValueAtTime(0.0001,time);s.gainB.gain.setValueAtTime(0.0001,time);s.gainA.gain.exponentialRampToValueAtTime(g,time+0.035);s.gainB.gain.exponentialRampToValueAtTime(g*0.65,time+0.065);s.gainA.gain.exponentialRampToValueAtTime(0.0001,time+d);s.gainB.gain.exponentialRampToValueAtTime(0.0001,time+d);return true;}
        return Object.freeze({ensure,destroy,trigger});
    })();

    /**
     * Central SFX dispatcher. Gameplay code should continue to request semantic
     * events ("shoot", "pickup", "bossSpawn") instead of constructing synth nodes.
     * This preserves a stable public contract while allowing the audio palette to
     * be redesigned independently from weapons, enemies, pickups, and wave logic.
     */
    function playSound(name) {
        if (!ensureAudio() || !audio.enabled) return;

        const wallNow = performance.now();
        const SFX_POLICY = {
            // minimumInterval is global per semantic event, not per enemy. This is
            // intentional: twenty enemies firing together should read as a barrage,
            // not allocate sixty synth voices in the same rendering quantum.
            shoot:           { minimumInterval: 20, priority: 5 },
            enemyShoot:      { minimumInterval: 90, priority: 1 },
            hit:             { minimumInterval: 45, priority: 1 },
            explosion:       { minimumInterval: 240, priority: 1 },
            explosiveImpact: { minimumInterval: 90, priority: 2 },
            pickup:        { minimumInterval: 45, priority: 4 },
            healthPickup:  { minimumInterval: 90, priority: 4 },
            speedPickup:   { minimumInterval: 110, priority: 5 },
            damagePickup:  { minimumInterval: 110, priority: 4 },
            slowPickup:    { minimumInterval: 110, priority: 4 },
            harmPickup:    { minimumInterval: 110, priority: 5 },
            trap:          { minimumInterval: 80, priority: 4 },
            playerHit:     { minimumInterval: 90, priority: 5 },
            upgrade:       { minimumInterval: 120, priority: 5 },
            bossSpawn:     { minimumInterval: 500, priority: 5 },
            miniBossSpawn: { minimumInterval: 280, priority: 5 },
            waveClear:     { minimumInterval: 500, priority: 5 },
            gameOver:      { minimumInterval: 1000, priority: 5 },
        };
        const policy = SFX_POLICY[name] || { minimumInterval: 40, priority: 2 };

        // Source-pressure shedding happens before any synth graph is created. This is
        // the main defense against the late-wave mute-out seen at 70–110 voices.
        const activeVoices = getTransientAudioVoiceCount();
        if (activeVoices >= audio.hardVoiceLimit && policy.priority < 5) {
            audio.diagnostics.droppedEvents++;
            audio.diagnostics.hardVoiceDrops++;
            return;
        }
        if (activeVoices >= audio.softVoiceLimit && policy.priority <= 2) {
            audio.diagnostics.droppedEvents++;
            audio.diagnostics.softVoiceDrops++;
            return;
        }
        if (activeVoices >= audio.softVoiceLimit + 8 && policy.priority <= 3) {
            audio.diagnostics.droppedEvents++;
            audio.diagnostics.softVoiceDrops++;
            return;
        }

        const lastPlayed = audio.sfxLastPlayed[name] || -Infinity;
        if (wallNow - lastPlayed < policy.minimumInterval) {
            audio.diagnostics.droppedEvents++;
            return;
        }

        // One-second rolling budget prevents pathological voice creation. Low-priority
        // combat texture is dropped first; navigation, damage, upgrades, and bosses
        // remain audible even when the arena is saturated.
        if (wallNow - audio.sfxWindowStartedAt >= 1000) {
            audio.sfxWindowStartedAt = wallNow;
            audio.sfxEventsInWindow = 0;
        }
        const budget = audio.maxSfxEventsPerSecond;
        if (audio.sfxEventsInWindow >= budget && policy.priority < 4) {
            audio.diagnostics.droppedEvents++;
            return;
        }
        if (audio.sfxEventsInWindow >= budget + 12 && policy.priority < 5) {
            audio.diagnostics.droppedEvents++;
            return;
        }

        audio.sfxLastPlayed[name] = wallNow;
        audio.sfxEventsInWindow++;
        audio.diagnostics.eventCounts[name] = (audio.diagnostics.eventCounts[name] || 0) + 1;

        const now = audio.context.currentTime;
        const jitter = (amount) => 1 + (Math.random() * 2 - 1) * amount;

        // The AudioContext wrapper reads these while nodes are constructed so every
        // SFX voice carries priority/category metadata for diagnostics and stealing.
        audio.currentSfxPriority = policy.priority;
        audio.currentSfxCategory = name;

        const sounds = {
            // Player weapon synthesis scales with the current explosive-round
            // level while keeping the semantic gameplay call stable.
            shoot: () => {
                // Player fire is generated by two persistent, normally silent
                // oscillators. Retriggering changes only AudioParams, so the cadence
                // cannot be dropped or voice-stolen and creates zero new sources.
                if (!PersistentFireSynth.trigger(player.explosiveLevel, now)) {
                    // Defensive fallback only if the persistent graph could not be
                    // created. This path should be rare and remains voice-guarded.
                    WeaponSynth.playCadencePulse(player.explosiveLevel, now);
                }
            },

            // Splash impacts use a compact plasma discharge instead of the full
            // enemy-death explosion. This is the critical late-wave mix safeguard.
            explosiveImpact: () => WeaponSynth.playExplosiveImpact(player.explosiveLevel, now),

            // Enemy fire: darker and more hollow so hostile projectiles remain identifiable.
            enemyShoot: () => PersistentEnemyWeaponSynth.trigger(now),

            // Standard hit: metallic spark plus compact low-mid thud.
            hit: () => {
                playNoiseBurst({ duration: 0.075, gain: 0.095, time: now, filterType: "bandpass", frequency: 2700, endFrequency: 950, resonance: 1.5 });
                playPitchSweep({ startFrequency: 185, endFrequency: 74, duration: 0.09, type: "triangle", gain: 0.055, time: now, filterStart: 850, filterEnd: 280, resonance: 1.2 });
                playPitchSweep({ startFrequency: 4200, endFrequency: 1750, duration: 0.035, type: "square", gain: 0.018, time: now, filterStart: 6500, filterEnd: 2200, resonance: 2.7 });
            },

            // Player damage: unmistakable hull slam, sub impact, and electrical scrape.
            playerHit: () => {
                playNoiseBurst({ duration: 0.22, gain: 0.19, time: now, filterType: "lowpass", frequency: 1050, endFrequency: 260, resonance: 1.0, attack: 0.002 });
                playPitchSweep({ startFrequency: 155, endFrequency: 38, duration: 0.31, type: "sawtooth", gain: 0.17, time: now, filterStart: 900, filterEnd: 180, resonance: 2.3, distortion: 38 });
                playPitchSweep({ startFrequency: 66, endFrequency: 31, duration: 0.36, type: "sine", gain: 0.15, time: now + 0.008, filterStart: 240, filterEnd: 90 });
                playNoiseBurst({ duration: 0.14, gain: 0.055, time: now + 0.025, filterType: "highpass", frequency: 3300, endFrequency: 1600, resonance: 2.0 });
            },

            // Enemy destruction: deliberately lightweight three-layer design.
            // Late waves may destroy many enemies in a short burst, so this sound
            // must remain expressive without allocating a large Web Audio graph
            // for every death. Visual explosions still carry the spectacle.
            explosion: () => PersistentExplosionSynth.trigger(now),

            // Dedicated pickup identities. Keep generic `pickup` for point orbs
            // and debug rewards; physical powerups use PickupSynth presets.
            healthPickup: () => PersistentPickupSynth.playHealth(now),
            speedPickup: () => PersistentPickupSynth.playSpeed(now),
            damagePickup: () => PersistentPickupSynth.playDamage(now),
            slowPickup: () => PersistentPickupSynth.playSlow(now),
            harmPickup: () => PersistentPickupSynth.playHarm(now),

            // Positive pickup: clean rising triad with a glitter transient.
            pickup: () => PersistentUiSynth.trigger("pickup", now),

            // Harmful pickup: descending alarm buzz with rough electrical noise.
            trap: () => {
                playPitchSweep({ startFrequency: 260, endFrequency: 58, duration: 0.34, type: "sawtooth", gain: 0.16, time: now, filterStart: 1700, filterEnd: 230, resonance: 4.0, distortion: 48 });
                playPitchSweep({ startFrequency: 520, endFrequency: 116, duration: 0.28, type: "square", gain: 0.055, time: now + 0.018, filterStart: 2400, filterEnd: 430, resonance: 2.2 });
                playNoiseBurst({ duration: 0.22, gain: 0.105, time: now, filterType: "bandpass", frequency: 820, endFrequency: 240, resonance: 2.8 });
            },

            // Upgrade purchase: confident power-up sweep and resolved major-colored stack.
            upgrade: () => PersistentUiSynth.trigger("upgrade", now),

            // Boss entrance: long tonal horn, sub pressure, and widening mechanical roar.
            bossSpawn: () => {
                playPitchSweep({ startFrequency: 73.42, endFrequency: 36.71, duration: 0.9, type: "sawtooth", gain: 0.22, time: now, filterStart: 1050, filterEnd: 190, resonance: 5.0, distortion: 58 });
                playPitchSweep({ startFrequency: 49, endFrequency: 27.5, duration: 1.05, type: "sine", gain: 0.21, time: now, filterStart: 210, filterEnd: 70 });
                playPitchSweep({ startFrequency: 293.66, endFrequency: 92.5, duration: 0.72, type: "square", gain: 0.06, time: now + 0.08, filterStart: 2200, filterEnd: 340, resonance: 3.8, distortion: 25 });
                playNoiseBurst({ duration: 0.86, gain: 0.18, time: now + 0.035, filterType: "lowpass", frequency: 1200, endFrequency: 130, resonance: 1.4 });
            },

            miniBossSpawn: () => {
                playPitchSweep({ startFrequency: 130.81, endFrequency: 49, duration: 0.55, type: "sawtooth", gain: 0.17, time: now, filterStart: 1150, filterEnd: 260, resonance: 4.0, distortion: 42 });
                playPitchSweep({ startFrequency: 65.41, endFrequency: 36.71, duration: 0.62, type: "sine", gain: 0.16, time: now + 0.012, filterStart: 260, filterEnd: 85 });
                playNoiseBurst({ duration: 0.43, gain: 0.115, time: now, filterType: "bandpass", frequency: 760, endFrequency: 220, resonance: 1.9 });
            },

            // Wave clear: ascending fanfare with a broad sparkle tail.
            waveClear: () => PersistentUiSynth.trigger("waveClear", now),

            // Game over: falling power-down sequence with a final sub collapse.
            gameOver: () => {
                playPitchSweep({ startFrequency: 440, endFrequency: 55, duration: 0.95, type: "sawtooth", gain: 0.15, time: now, filterStart: 2200, filterEnd: 160, resonance: 3.5, distortion: 32 });
                playPitchSweep({ startFrequency: 220, endFrequency: 41.2, duration: 1.12, type: "square", gain: 0.085, time: now + 0.08, filterStart: 1200, filterEnd: 120, resonance: 2.7 });
                playPitchSweep({ startFrequency: 82.41, endFrequency: 24.5, duration: 1.28, type: "sine", gain: 0.16, time: now + 0.16, filterStart: 260, filterEnd: 65 });
                playNoiseBurst({ duration: 0.92, gain: 0.11, time: now + 0.22, filterType: "lowpass", frequency: 680, endFrequency: 90, resonance: 1.1 });
            },
        };
        try {
            sounds[name]?.();
        } finally {
            audio.currentSfxPriority = null;
            audio.currentSfxCategory = null;
            audio.currentSourcePersistent = false;
        }
    }


    const camera = { x: 0, y: 0 };
    const keysHeld = {};
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // Unified analog input state. Keyboard/mouse remain authoritative until a
    // touch stick or gamepad axis moves beyond its dead zone.
    const analogInput = {
        moveX: 0,
        moveY: 0,
        aimX: 1,
        aimY: 0,
        aimActive: false,
        source: "keyboard",
        lastTouchAt: 0,
        gamepadPauseHeld: false,
    };
    let cursorFrameRequest = 0;
    let cursorPendingX = 0;
    let cursorPendingY = 0;
    let minimapFrameCounter = 0;
    let renderFrameCounter = 0;

    const state = {
        started: false,
        paused: true,
        manuallyPaused: false,
        ended: false,
        wave: 1,
        score: 0,
        upgradePoints: 0,
        damageFlash: 0,
        enemiesToSpawn: 8,
        enemiesSpawned: 0,
        spawnTimer: 0,
        clearPhaseActive: false,
        clearPhaseStartedAt: 0,
        clearPhaseDuration: 4200,
        clearPhaseTitle: "WAVE CLEARED",
        enemyBulletsClearAt: 0,
        screenShake: 0,
        screenShakeDecay: 0.86,
        difficulty: "easy",
        musicScene: "combat",
        // Queued, non-stacking end-of-wave reward. Applied once when the next wave begins.
        nextWaveSpeedBoostMs: 0,
    };

    const player = {
        x: WORLD.width / 2,
        y: WORLD.height / 2,
        r: 18,
        speed: 4,
        health: 100,
        maxHealth: 100,
        damage: 10,
        fireRate: 250,
        bulletSpeed: 9,
        bulletsPerShot: 1,
        explosiveLevel: 0,
        explosiveRadius: 0,
        explosiveDamageRatio: 0.45,
        speedBoostUntil: 0,
        slowUntil: 0,
        slowMultiplier: 1,
        pointMagnetRadius: 95,
        pointMagnetStrength: 0.18,
        missileLevel: 0,
        missileCount: 0,
        missileDamage: 0,
        missileCooldown: 950,
        lastMissileAt: 0,
        auraLevel: 0,
        auraDamage: 0,
        auraRadius: 0,
        auraTickRate: 500,
        lastAuraTickAt: 0,
        regenLevel: 0,
        regenAmount: 0,
        regenPerSecond: 0,
        regenTickRate: 1000,
        regenAccumulator: 0,
        regenDelayAfterDamage: 2000,
        lastDamageAt: -999999,
        lastRegenTickAt: 0,
        regenGlowUntil: 0,
        lifeStealLevel: 0,
        lifeStealAmount: 0,
        healthFlashUntil: 0,
        damageFlashUntil: 0,
        lastShotAt: 0,
        damageReduction: 0,
        shield: 0,
        maxShield: 0,
        boostDurationMultiplier: 1,
        slowResistance: 1,
        autonomousDamageMultiplier: 1,
        autonomousArsenal: false,
        volleyCounter: 0,
        adaptiveHull: false,
        livingDrones: false,
    };

    const upgradeLevels = Object.fromEntries(Object.keys(UPGRADE_DATA).map(type => [type, 0]));

    const SHIP_SYSTEMS = Object.freeze({
        green: { label: "NANOBOTS", color: "#55e889" },
        red: { label: "WEAPON AI", color: "#ff6b5f" },
        blue: { label: "ANTI-GRAV", color: "#59c8ff" },
        purple: { label: "QUANTUM", color: "#bd78ff" },
    });

    function getSystemInvestment(system) {
        return Object.entries(UPGRADE_DATA).reduce((total, [type, data]) =>
            total + (data.system === system ? upgradeLevels[type] : 0), 0);
    }

    function getResearchLock(type) {
        const data = UPGRADE_DATA[type];
        const requirement = data?.requires;
        if (!requirement) return null;
        if (requirement.system) {
            const current = getSystemInvestment(requirement.system);
            if (current < requirement.investment) {
                return `Requires ${requirement.investment} ${SHIP_SYSTEMS[requirement.system].label} investment (${current}/${requirement.investment})`;
            }
        }
        if (requirement.systems) {
            const missing = Object.entries(requirement.systems)
                .filter(([system, amount]) => getSystemInvestment(system) < amount)
                .map(([system, amount]) => `${amount} ${SHIP_SYSTEMS[system].label}`);
            if (missing.length) return `Requires ${missing.join(" + ")}`;
        }
        if (requirement.upgrade && !upgradeLevels[requirement.upgrade]) {
            return `Requires ${UPGRADE_DATA[requirement.upgrade].label}`;
        }
        return null;
    }

    function updateSystemInvestmentUI() {
        for (const system of Object.keys(SHIP_SYSTEMS)) {
            const value = document.querySelector(`[data-system-investment="${system}"]`);
            if (value) value.textContent = getSystemInvestment(system);
        }
    }

    const waveResearch = { offeredForWave: 0, claimed: false, selectedId: null };

    // ---------------------------------------------------------------------
    // Relic Research
    // ---------------------------------------------------------------------
    // Player-facing cards intentionally expose only a relic codename, affinity,
    // progress, and lore fragment. Runtime behaviors remain isolated in the
    // update/draw helpers below so relics can be expanded without modifying the
    // core upgrade tree or adding any new combat buttons.
    const RELIC_DEFINITIONS = Object.freeze({
        relic_green_01: {
            system: "green",
            name: "VERDANT CORE",
            hint: "A patient orbit waits beneath the hull.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "ORBITAL ENERGY SPHERE ONLINE", description: "A verdant energy sphere now circles the ship and detonates when it collides with an enemy.", next: "Resonant research increases sphere count, impact damage, and recovery speed." },
                { title: "VERDANT CORE — RESONANT", description: "The orbital defense gains additional coverage and strikes with greater force.", next: "Ascendant research further expands the living orbital array." },
                { title: "VERDANT CORE — ASCENDANT", description: "The orbital energy array reaches its highest known combat configuration.", next: "Further fragments refine damage and uptime." },
            ],
        },
        relic_red_01: {
            system: "red",
            name: "ASTRAL LENS",
            hint: "Light compressed beyond conventional limits.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "TACTICAL LASER ONLINE", description: "The Astral Lens now periodically fires a piercing beam in the ship's current aim direction. The beam can strike multiple enemies in a line.", next: "Resonant research reduces its cooldown and increases beam width, duration, and damage." },
                { title: "ASTRAL LENS — RESONANT", description: "The tactical laser charges faster, remains active longer, and cuts a wider path through enemy formations.", next: "Ascendant research pushes the beam toward maximum output." },
                { title: "ASTRAL LENS — ASCENDANT", description: "The tactical laser reaches its highest known output, with substantially improved damage, coverage, and firing frequency.", next: "Further fragments continue refining beam output." },
            ],
        },
        relic_blue_01: {
            system: "blue",
            name: "GRAVITY HEART",
            hint: "Space folds, then remembers its shape.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "GRAVITY PULSE ONLINE", description: "The Gravity Heart now releases an automatic pulse that pushes nearby enemies away and briefly slows them.", next: "Resonant research increases pulse radius, force, slow duration, and activation frequency." },
                { title: "GRAVITY HEART — RESONANT", description: "Gravity pulses cover more space, trigger more often, and hold enemies in a weakened movement state for longer.", next: "Ascendant research further strengthens battlefield control." },
                { title: "GRAVITY HEART — ASCENDANT", description: "The gravity pulse reaches its highest known radius, force, and control frequency.", next: "Further fragments continue refining pulse efficiency." },
            ],
        },
        relic_purple_01: {
            system: "purple",
            name: "ECHOING SWARM",
            hint: "Small voices answer from outside the signal.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "COMBAT DRONE WING ONLINE", description: "Temporary autonomous followers now orbit the ship, acquire nearby targets, and fire independently. They can be destroyed and are rebuilt automatically.", next: "Resonant research increases drone count, durability, lifetime, and weapon damage." },
                { title: "ECHOING SWARM — RESONANT", description: "The drone wing fields stronger, longer-lived followers with improved weapons and battlefield presence.", next: "Ascendant research expands the swarm to its highest known configuration." },
                { title: "ECHOING SWARM — ASCENDANT", description: "The combat-drone wing reaches its highest known count, durability, lifetime, and damage output.", next: "Further fragments continue refining swarm performance." },
            ],
        },
    });

    const relicResearch = Object.fromEntries(Object.keys(RELIC_DEFINITIONS).map(id => [id, {
        stage: 0,
        progress: 0,
        awakened: false,
    }]));

    const relicOrbs = [];
    const relicDrones = [];
    const relicLaser = { nextAt: 0, activeUntil: 0, angle: 0, hitIds: new Set() };
    const relicPulse = { nextAt: 0, visualUntil: 0, radius: 0 };
    let nextRelicDroneId = 1;

    function getRelicThreshold(id) {
        const def = RELIC_DEFINITIONS[id];
        const stateData = relicResearch[id];
        if (!def || !stateData) return Infinity;
        return def.thresholds[Math.min(stateData.stage, def.thresholds.length - 1)];
    }

    function getRelicStageLabel(id) {
        const stage = relicResearch[id]?.stage || 0;
        return stage === 0 ? "DORMANT SIGNAL" : stage === 1 ? "AWAKENED" : stage === 2 ? "RESONANT" : "ASCENDANT";
    }

    function getRelicReveal(id, stage = relicResearch[id]?.stage || 0) {
        const def = RELIC_DEFINITIONS[id];
        if (!def || stage <= 0) return null;
        // Stages beyond the authored reveal list remain valid repeatable refinements.
        return def.reveals[Math.min(stage - 1, def.reveals.length - 1)] || null;
    }

    function ensureRelicAwakeningOverlay() {
        let overlay = document.getElementById("relicAwakeningOverlay");
        if (overlay) return overlay;
        overlay = document.createElement("div");
        overlay.id = "relicAwakeningOverlay";
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
            <div class="relic-awakening-card">
                <div class="relic-awakening-kicker">RELIC RESEARCH COMPLETE</div>
                <div class="relic-awakening-name" id="relicAwakeningName"></div>
                <div class="relic-awakening-title" id="relicAwakeningTitle"></div>
                <p class="relic-awakening-description" id="relicAwakeningDescription"></p>
                <p class="relic-awakening-next" id="relicAwakeningNext"></p>
                <button type="button" id="relicAwakeningContinue">Continue Reconstruction</button>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector("#relicAwakeningContinue")?.addEventListener("click", () => {
            overlay.classList.remove("active");
            overlay.setAttribute("aria-hidden", "true");
        });
        return overlay;
    }

    function showRelicAwakening(id) {
        const def = RELIC_DEFINITIONS[id];
        const data = relicResearch[id];
        const reveal = getRelicReveal(id, data?.stage || 0);
        if (!def || !data || !reveal) return;
        const overlay = ensureRelicAwakeningOverlay();
        overlay.style.setProperty("--relic-awaken-color", SHIP_SYSTEMS[def.system].color);
        overlay.querySelector("#relicAwakeningName").textContent = def.name;
        overlay.querySelector("#relicAwakeningTitle").textContent = reveal.title;
        overlay.querySelector("#relicAwakeningDescription").textContent = reveal.description;
        overlay.querySelector("#relicAwakeningNext").textContent = reveal.next;
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
    }

    function allocateRelicResearch(id) {
        if (waveResearch.claimed || !RELIC_DEFINITIONS[id]) return;
        captureReconstructionSnapshot(`Relic Research: ${RELIC_DEFINITIONS[id].name}`);
        const data = relicResearch[id];
        data.progress++;
        const threshold = getRelicThreshold(id);
        if (data.progress >= threshold) {
            data.progress = 0;
            data.stage++;
            data.awakened = true;
            particles.push({ x: player.x, y: player.y, dx: 0, dy: 0, r: 180, color: SHIP_SYSTEMS[RELIC_DEFINITIONS[id].system].color, life: 32, maxLife: 32, auraRing: true });
            playSound("upgrade");
            showRelicAwakening(id);
        } else {
            playSound("pickup");
        }
        waveResearch.claimed = true;
        waveResearch.selectedId = id;
        renderRelicResearchChoices();
        document.querySelector(".wave-research-panel")?.classList.add("claimed");
        updateUI();
    }

    function renderRelicResearchChoices() {
        const panel = document.getElementById("waveResearchChoices");
        if (!panel) return;
        panel.innerHTML = Object.entries(RELIC_DEFINITIONS).map(([id, def]) => {
            const data = relicResearch[id];
            const threshold = getRelicThreshold(id);
            const progress = Math.min(100, (data.progress / threshold) * 100);
            const selected = waveResearch.claimed && waveResearch.selectedId === id;
            const reveal = getRelicReveal(id);
            const knowledge = reveal
                ? `<span class="relic-revealed-label">AWAKENED EFFECT</span>
                   <span class="relic-revealed-title">${reveal.title}</span>
                   <span class="relic-revealed-description">${reveal.description}</span>
                   <span class="relic-next-stage">NEXT: ${reveal.next}</span>`
                : `<span class="relic-hint">“${def.hint}”</span>`;
            return `<button type="button" class="wave-research-choice relic-research-choice system-${def.system}${selected ? " selected" : ""}${data.awakened ? " awakened" : ""}" data-relic-research="${id}" ${waveResearch.claimed ? "disabled" : ""}>
                <span class="relic-affinity">${SHIP_SYSTEMS[def.system].label} RELIC · ${getRelicStageLabel(id)}</span>
                <strong>${def.name}</strong>
                ${knowledge}
                <span class="relic-progress"><i style="width:${progress}%"></i></span>
                <span class="relic-count">${data.progress}/${threshold}</span>
            </button>`;
        }).join("");
    }

    const bullets = [];
    const missiles = [];
    const enemyBullets = [];
    const carrierMissiles = [];
    const enemies = [];
    const explosions = [];
    const pickups = [];
    const pointOrbs = [];
    const lifeStealOrbs = [];
    const particles = [];
    const damageNumbers = [];
    const backgroundPanels = [];
    const backgroundStars = [];

    // -------------------------------------------------------------------------
    // Coordinate helpers
    // -------------------------------------------------------------------------
    /**
     * Handles the worldToScreen operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    const CAMERA_ZOOM = clamp(Number(PLATFORM_PROFILE.cameraZoom) || 1, 0.5, 1);

    function getVisibleWorldWidth() {
        return canvas.width / CAMERA_ZOOM;
    }

    function getVisibleWorldHeight() {
        return canvas.height / CAMERA_ZOOM;
    }

    function worldToScreen(pos) {
        // Returned coordinates are in logical world-view units. drawGame() applies
        // CAMERA_ZOOM once to the full scene so positions and object sizes scale
        // together. Do not multiply by CAMERA_ZOOM here.
        return { x: pos.x - camera.x, y: pos.y - camera.y };
    }

    /**
     * Converts CSS-pixel pointer coordinates into world coordinates. The inverse
     * zoom is required for mouse, touch aim, and controller-generated aim points.
     */
    function screenToWorld(pos) {
        return {
            x: pos.x / CAMERA_ZOOM + camera.x,
            y: pos.y / CAMERA_ZOOM + camera.y,
        };
    }

    /**
     * Returns a boolean predicate and should not mutate state.
     */
    function isInView(pos, margin = 0) {
        const screen = worldToScreen(pos);
        return screen.x > -margin &&
            screen.x < getVisibleWorldWidth() + margin &&
            screen.y > -margin &&
            screen.y < getVisibleWorldHeight() + margin;
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateCanvasSize() {
        // Prefer the visual viewport on mobile. Browser chrome and fullscreen
        // transitions can make window.innerHeight describe a larger layout
        // viewport than the pixels actually visible to the player.
        const viewport = window.visualViewport;
        const width = Math.max(1, Math.round(viewport?.width || window.innerWidth));
        const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));

        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.style.left = `${Math.round(viewport?.offsetLeft || 0)}px`;
        canvas.style.top = `${Math.round(viewport?.offsetTop || 0)}px`;

        keepPlayerInWorld();
        updateCamera();
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateCamera() {
        const viewWidth = getVisibleWorldWidth();
        const viewHeight = getVisibleWorldHeight();
        const maxCameraX = Math.max(0, WORLD.width - viewWidth);
        const maxCameraY = Math.max(0, WORLD.height - viewHeight);

        camera.x = clamp(player.x - viewWidth / 2, 0, maxCameraX);
        camera.y = clamp(player.y - viewHeight / 2, 0, maxCameraY);
    }

    /**
     * Handles the keepPlayerInWorld operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function keepPlayerInWorld() {
        player.x = clamp(player.x, player.r, WORLD.width - player.r);
        player.y = clamp(player.y, player.r, WORLD.height - player.r);
    }


    /**
     * Normalizes external or computed input into the safe format expected by downstream code.
     */
    function normalizeColor(color) {
        return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#7cffd4";
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateCursorPosition(x = mouse.x, y = mouse.y) {
        mouse.x = x;
        mouse.y = y;
        cursorPendingX = x;
        cursorPendingY = y;

        if (!ui.customCursor || cursorFrameRequest) return;

        cursorFrameRequest = requestAnimationFrame(() => {
            ui.customCursor.style.transform = `translate3d(${cursorPendingX}px, ${cursorPendingY}px, 0) translate(-50%, -50%)`;
            cursorFrameRequest = 0;
        });
    }

    /**
     * Starts cursor tracking independently from game and audio initialization so UI remains usable when optional systems fail.
     */
    function initializeCustomCursorTracking() {
        if (!ui.customCursor) {
            document.body.style.cursor = "auto";
            return;
        }

        const moveCursor = event => {
            updateCursorPosition(event.clientX, event.clientY);
            ui.customCursor.classList.add("cursor-visible");
        };

        // Capture-phase document listeners keep the cursor independent from
        // canvas, menu, audio, and game initialization state.
        document.addEventListener("pointermove", moveCursor, { capture: true, passive: true });
        document.addEventListener("mousemove", event => {
            if (event.movementX || event.movementY) {
                analogInput.aimActive = false;
                setInputSource("keyboard");
            }
            moveCursor(event);
        }, { capture: true, passive: true });
        document.addEventListener("pointerenter", moveCursor, { capture: true, passive: true });
        document.addEventListener("pointerleave", () => {
            ui.customCursor.classList.remove("cursor-visible");
        }, { capture: true, passive: true });

        ui.customCursor.classList.add("cursor-ready");
    }

    /**
     * Updates one authoritative setting and synchronizes dependent UI or runtime state.
     */
    function setCursorColor(color) {
        const finalColor = normalizeColor(color);
        document.body.style.setProperty("--cursor-color", finalColor);
        safeStorage.set("starwakeCursorColor", finalColor);

        if (ui.menuCursorColor) ui.menuCursorColor.value = finalColor;
        if (ui.pauseCursorColor) ui.pauseCursorColor.value = finalColor;

        for (const button of document.querySelectorAll("[data-cursor-color]")) {
            button.classList.toggle("selected", button.dataset.cursorColor.toLowerCase() === finalColor);
        }
    }

    // -------------------------------------------------------------------------
    // Fullscreen support
    // -------------------------------------------------------------------------
    // Standard Fullscreen API works in most desktop and Android browsers. Some
    // iOS browsers do not expose page fullscreen; buttons remain harmless and
    // report that limitation instead of throwing.
    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    async function toggleFullscreen() {
        const root = document.documentElement;
        try {
            if (getFullscreenElement()) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) await exit.call(document);
                return;
            }

            const request = root.requestFullscreen || root.webkitRequestFullscreen;
            if (!request) {
                const status = document.getElementById("platformStatus");
                if (status) status.textContent = "Fullscreen is not supported by this browser. Use Add to Home Screen for an app-like view.";
                return;
            }

            await request.call(root, { navigationUI: "hide" });
            try { screen.orientation?.lock?.("landscape"); } catch (_) { /* Optional browser permission. */ }
        } catch (error) {
            console.warn("Fullscreen request was rejected:", error);
            const status = document.getElementById("platformStatus");
            if (status) status.textContent = "Fullscreen request was blocked. Tap the button again after interacting with the page.";
        } finally {
            updateFullscreenButtons();
        }
    }

    function updateFullscreenButtons() {
        const active = Boolean(getFullscreenElement());
        for (const button of document.querySelectorAll("[data-fullscreen-button]")) {
            button.textContent = active ? "Exit Fullscreen" : (button.classList.contains("compact") ? "Fullscreen" : "Enter Fullscreen");
            button.setAttribute("aria-pressed", String(active));
        }
        // Browser UI changes alter the usable viewport on mobile. Recalculate the
        // canvas after fullscreen transitions rather than relying only on resize.
        requestAnimationFrame(updateCanvasSize);
    }

    // -------------------------------------------------------------------------
    // Game state
    // -------------------------------------------------------------------------
    /**
     * Transitions from menus into active play. Optional systems such as audio must never be allowed to block this path.
     */
    function startGame() {
        applyDifficultyToWave();
        state.started = true;
        state.paused = false;
        lastPlayerMovementAt = performance.now();
        state.ended = false;
        ui.splashScreen.style.display = "none";
        ui.startMenu.style.display = "none";
        try {
            resumeAudio();
        } catch (audioError) {
            console.error("Audio startup failed; gameplay will continue:", audioError);
            if (ui.audioStatus) ui.audioStatus.textContent = "Audio unavailable — gameplay active";
        }
    }

    /**
     * Handles the showStartMenu operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function showStartMenu() {
        ui.splashScreen.style.display = "none";
        ui.startMenu.style.display = "flex";
    }

    // Public, fail-safe launch entry point. The menu can call this even when
    // another optional subsystem (audio, cursor, etc.) has encountered an error.
    window.StarwakeLaunchProtocol = function StarwakeLaunchProtocol() {
        const startButton = document.getElementById("startButton");
        try {
            if (startButton) {
                startButton.disabled = true;
                startButton.textContent = "Launching…";
            }
            startGame();
        } catch (error) {
            console.error("Launch Protocol failed:", error);
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = "Launch Protocol";
            }
            const label = document.getElementById("selectedDifficultyLabel");
            if (label) label.textContent = "Launch error — press F12 for details";
        }
    };

    /**
     * Updates one authoritative setting and synchronizes dependent UI or runtime state.
     */
    function setDifficulty(difficultyKey) {
        if (!DIFFICULTY_DATA[difficultyKey]) return;
        state.difficulty = difficultyKey;
        for (const button of difficultyButtons) {
            button.classList.toggle("selected", button.dataset.difficulty === difficultyKey);
        }
        ui.selectedDifficultyLabel.textContent = DIFFICULTY_DATA[difficultyKey].label;
        applyDifficultyToWave();
    }

    /**
     * Recomputes wave pressure from difficulty data. Centralize scaling here instead of scattering multipliers through enemy code.
     */
    function applyDifficultyToWave() {
        const difficulty = getDifficulty();
        state.enemiesToSpawn = Math.max(4, Math.round((difficulty.spawnBase + state.wave * difficulty.spawnGrowth) * (PLATFORM_PROFILE.spawnMultiplier || 1)));
    }

    /**
     * Handles the restartGame operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function restartGame() {
        location.reload();
    }

    /**
     * Switches a boolean UI or gameplay state while preserving a single source of truth.
     */
    function togglePause() {
        state.manuallyPaused = !state.manuallyPaused;
        state.paused = state.manuallyPaused;
        ui.pauseOverlay.style.display = state.manuallyPaused ? "flex" : "none";
    }

    /**
     * Handles the gameOver operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function gameOver() {
        playSound("gameOver");
        state.ended = true;
        state.paused = true;
        ui.finalScore.textContent = state.score;
        ui.finalWave.textContent = state.wave;
        ui.waveClearOverlay.style.opacity = 0;
        ui.speedBoostOverlay.style.opacity = 0;
        ui.slowStatusOverlay.style.opacity = 0;
        ui.waveClearMessage.classList.remove("active");
        ui.gameOverMenu.style.display = "flex";
    }

    /**
     * Returns a boolean predicate and should not mutate state.
     */
    function isBossWave() {
        return state.wave % 10 === 0;
    }

    /**
     * Returns a boolean predicate and should not mutate state.
     */
    function isGigaBossWave() {
        return state.wave % 20 === 0;
    }

    /**
     * Pauses wave progression and exposes the upgrade flow. Keep menu audio and UI changes reversible when the next wave starts.
     */
    // Single-step reconstruction undo. The snapshot is intentionally scoped to
    // upgrade-menu state only: player build data, currency, research selection,
    // and the displayed weapon label. It is cleared when the menu opens or the
    // next wave begins so combat state can never be rewound accidentally.
    let lastReconstructionAction = null;

    function captureReconstructionSnapshot(label) {
        lastReconstructionAction = {
            label,
            player: { ...player },
            upgradeLevels: { ...upgradeLevels },
            upgradePoints: state.upgradePoints,
            waveResearch: { ...waveResearch },
            relicResearch: structuredClone(relicResearch),
            nextWaveSpeedBoostMs: state.nextWaveSpeedBoostMs,
            weaponLabel: ui.weapon?.textContent ?? "",
        };
        updateUndoUpgradeButton();
    }

    function clearReconstructionUndo() {
        lastReconstructionAction = null;
        updateUndoUpgradeButton();
    }

    function updateUndoUpgradeButton() {
        if (!ui.undoUpgradeButton) return;
        ui.undoUpgradeButton.disabled = !lastReconstructionAction;
        ui.undoUpgradeButton.textContent = lastReconstructionAction
            ? `Undo: ${lastReconstructionAction.label}`
            : "Undo Last Choice";
    }

    function restoreWaveResearchUI() {
        const panel = document.querySelector(".wave-research-panel");
        panel?.classList.toggle("claimed", waveResearch.claimed);
        renderRelicResearchChoices();
    }

    function undoLastReconstructionAction() {
        if (!lastReconstructionAction) return;
        const snapshot = lastReconstructionAction;
        lastReconstructionAction = null;

        for (const key of Object.keys(player)) {
            if (!(key in snapshot.player)) delete player[key];
        }
        Object.assign(player, snapshot.player);
        Object.assign(upgradeLevels, snapshot.upgradeLevels);
        state.upgradePoints = snapshot.upgradePoints;
        Object.assign(waveResearch, snapshot.waveResearch);
        if (snapshot.relicResearch) {
            for (const [id, data] of Object.entries(snapshot.relicResearch)) Object.assign(relicResearch[id], data);
        }
        state.nextWaveSpeedBoostMs = snapshot.nextWaveSpeedBoostMs || 0;
        if (ui.weapon) ui.weapon.textContent = snapshot.weaponLabel;

        restoreWaveResearchUI();
        updateUI();
        updateUpgradeButtons();
        updateUndoUpgradeButton();
        playSound("pickup");
    }

    const END_WAVE_BONUSES = Object.freeze([
        // End-of-wave rewards are intentionally recovery, economy, or one-wave utility.
        // Do not add permanent offense here: receiving a free permanent damage bonus
        // after every wave compounds faster than the paid research tree can be balanced.
        { id: "researchCache", label: "RESEARCH CACHE", description: "Recover a modest cache of upgrade points immediately.", apply: () => { state.upgradePoints += 35 + state.wave * 5; } },
        { id: "fieldRepair", label: "FIELD REPAIR", description: "Restore 22% hull and recharge half of installed nanobot shielding.", apply: () => { player.health = Math.min(player.maxHealth, player.health + player.maxHealth * 0.22); player.shield = Math.min(player.maxShield, Math.max(player.shield, player.maxShield * 0.50)); } },
        { id: "momentumReserve", label: "MOMENTUM RESERVE", description: "Begin the next wave with a 7-second speed boost. Does not stack.", apply: () => { state.nextWaveSpeedBoostMs = Math.max(state.nextWaveSpeedBoostMs, 7000); } },
        { id: "emergencyArmor", label: "EMERGENCY ARMOR", description: "Gain a temporary barrier worth 18% of maximum hull. Does not stack.", apply: () => { const reserve = Math.ceil(player.maxHealth * 0.18); player.shield = Math.max(player.shield, reserve); } },
    ]);

    function prepareEndWaveResearch() {
        waveResearch.offeredForWave = state.wave;
        waveResearch.claimed = false;
        waveResearch.selectedId = null;
        renderRelicResearchChoices();
        document.querySelector(".wave-research-panel")?.classList.remove("claimed");
    }

    function claimEndWaveResearch(id) {
        // Legacy entry point retained for compatibility with older cached markup.
        allocateRelicResearch(id);
    }

    function openUpgradeMenu() {
        state.musicScene = "upgrade";
        state.paused = true;
        state.clearPhaseActive = false;
        ui.waveClearOverlay.style.opacity = 0;
        ui.waveClearMessage.classList.remove("active");
        document.body.classList.add("upgrade-menu-open");
        ui.upgradeMenu.style.display = "flex";
        ui.upgradeMenu.scrollTop = 0;
        const upgradeCard = document.getElementById("upgradeCard");
        if (upgradeCard) upgradeCard.scrollTop = 0;
        clearReconstructionUndo();
        prepareEndWaveResearch();
        updateUpgradeButtons();
    }

    /**
     * Closes upgrade state, reapplies difficulty scaling, and begins the next encounter. This is the canonical wave-transition entry point.
     */
    function startNextWave() {
        clearReconstructionUndo();
        state.musicScene = "combat";
        state.wave++;
        applyDifficultyToWave();
        state.enemiesSpawned = 0;
        state.spawnTimer = 0;

        bullets.length = 0;
        missiles.length = 0;
        enemyBullets.length = 0;
        carrierMissiles.length = 0;
        explosions.length = 0;
        pickups.length = 0;
        pointOrbs.length = 0;
        lifeStealOrbs.length = 0;
        particles.length = 0;
        damageNumbers.length = 0;
        state.clearPhaseActive = false;
        ui.waveClearOverlay.style.opacity = 0;
        ui.waveClearMessage.classList.remove("active");

        player.health = Math.min(player.maxHealth, player.health + 5);
        if (state.nextWaveSpeedBoostMs > 0) {
            player.speedBoostUntil = Math.max(player.speedBoostUntil, performance.now() + state.nextWaveSpeedBoostMs);
            state.nextWaveSpeedBoostMs = 0;
        }
        state.paused = false;
        ui.upgradeMenu.style.display = "none";
        document.body.classList.remove("upgrade-menu-open");
        resumeAudio();
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkWaveComplete(now) {
        if (state.clearPhaseActive) {
            updateWaveClearPhase(now);
            return;
        }

        if (state.enemiesSpawned >= state.enemiesToSpawn && enemies.length === 0) {
            startWaveClearPhase(now);
        }
    }

    /**
     * Handles the startWaveClearPhase operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function startWaveClearPhase(now) {
        state.clearPhaseActive = true;
        state.clearPhaseStartedAt = now;
        state.enemyBulletsClearAt = now + 850;

        // Remove transient player-combat visuals immediately when the final enemy dies.
        // Point orbs and pickups live in separate arrays, so they remain visible and easy
        // to collect during the wave-clear countdown. Keep this cleanup centralized here
        // rather than scattering wave-end checks through projectile and particle updates.
        clearWaveEndCombatClutter();

        state.clearPhaseTitle = getWaveClearTitle();
        playSound("waveClear");
        addScreenShake(10);
        ui.waveClearTitle.textContent = state.clearPhaseTitle;
        ui.waveClearMessage.classList.add("active");
    }

    /**
     * Clears short-lived combat visuals at wave end without touching rewards.
     *
     * Preserved intentionally:
     * - pointOrbs: the player's earned upgrade currency
     * - pickups: health, speed, traps, and other collectible objects
     * - lifeStealOrbs: healing rewards still travelling toward the player
     *
     * Cleared intentionally:
     * - bullets and missiles: no valid targets remain after the wave ends
     * - particles and explosions: visual clutter can hide point orbs and pickups
     */
    function clearWaveEndCombatClutter() {
        bullets.length = 0;
        missiles.length = 0;
        particles.length = 0;
        explosions.length = 0;
        damageNumbers.length = 0;
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getWaveClearTitle() {
        if (isGigaBossWave()) return "GIGA BOSS DEFEATED";
        if (isBossWave()) return "BOSS DEFEATED";
        return "WAVE CLEARED";
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateWaveClearPhase(now) {
        const elapsed = now - state.clearPhaseStartedAt;
        const remainingMs = Math.max(0, state.clearPhaseDuration - elapsed);
        const opacity = remainingMs > 600 ? 0.82 : remainingMs / 600 * 0.82;

        ui.waveClearOverlay.style.opacity = opacity;
        ui.waveClearTitle.textContent = state.clearPhaseTitle;
        ui.waveClearSubtext.textContent = `Upgrade menu in ${Math.ceil(remainingMs / 1000)}...`;

        if (now >= state.enemyBulletsClearAt) {
            enemyBullets.forEach(bullet => bullet.dead = true);
        }

        if (remainingMs <= 0) {
            openUpgradeMenu();
        }
    }


    // -------------------------------------------------------------------------
    // Debug helpers
    // -------------------------------------------------------------------------
    /**
     * Handles the debugAddPoints operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function debugAddPoints() {
        state.upgradePoints += 1000;
        addDamageNumber(player.x, player.y - 36, "+1000 pts", "#ffe066");
        playSound("pickup");
        updateUpgradeButtons();
    }

    /**
     * Handles the debugSkipWave operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function debugSkipWave() {
        if (!state.started || state.ended) return;

        if (ui.upgradeMenu.style.display === "flex") {
            startNextWave();
            return;
        }

        state.paused = false;
        state.manuallyPaused = false;
        ui.pauseOverlay.style.display = "none";
        state.enemiesSpawned = state.enemiesToSpawn;

        for (const enemy of enemies) {
            if (!enemy || enemy.dead) continue;
            spawnDeathParticles(enemy, 6);
            enemy.dead = true;
        }

        bullets.forEach(bullet => bullet.dead = true);
        missiles.forEach(missile => missile.dead = true);
        enemyBullets.forEach(bullet => bullet.dead = true);
        cleanupDeadObjects();

        if (!state.clearPhaseActive) {
            startWaveClearPhase(Date.now());
        }
    }

    /**
     * Debug-only direct wave jump. This bypasses rewards and upgrade flow, clears
     * all encounter-owned objects, reapplies the selected difficulty curve, and
     * begins the requested wave from a clean state. It must never be used by
     * normal progression because it intentionally skips score/economy events.
     */
    function debugGoToWave() {
        if (!state.started || state.ended) return;

        const input = document.getElementById("debugWaveInput");
        const requested = Number.parseInt(input?.value ?? "1", 10);
        const targetWave = clamp(Number.isFinite(requested) ? requested : 1, 1, 999);
        if (input) input.value = String(targetWave);

        state.wave = targetWave;
        state.musicScene = "combat";
        state.paused = false;
        state.manuallyPaused = false;
        state.clearPhaseActive = false;
        state.clearPhaseStartedAt = 0;
        state.enemiesSpawned = 0;
        state.spawnTimer = 0;
        state.enemyBulletsClearAt = 0;
        applyDifficultyToWave();

        enemies.length = 0;
        bullets.length = 0;
        missiles.length = 0;
        enemyBullets.length = 0;
        carrierMissiles.length = 0;
        explosions.length = 0;
        pickups.length = 0;
        pointOrbs.length = 0;
        lifeStealOrbs.length = 0;
        particles.length = 0;
        damageNumbers.length = 0;

        ui.pauseOverlay.style.display = "none";
        ui.upgradeMenu.style.display = "none";
        ui.waveClearOverlay.style.opacity = 0;
        ui.waveClearMessage.classList.remove("active");
        document.body.classList.remove("upgrade-menu-open");

        // Restore enough health for debugging without changing the player's build.
        player.health = player.maxHealth;
        player.lastDamageAt = -999999;
        updateUI();
        resumeAudio();
    }

    // -------------------------------------------------------------------------
    // Upgrades
    // -------------------------------------------------------------------------
    /**
     * Calculates economy cost from upgrade level and difficulty modifiers. Keep all pricing logic here for balance consistency.
     */
    function getUpgradeCost(type) {
        const upgrade = UPGRADE_DATA[type];
        const level = upgradeLevels[type] || 0;
        const difficultyCost = getDifficulty().upgradeCost ?? 1;

        // Pricing is deliberately nonlinear. Core upgrades stay approachable,
        // while high-impact research and heavily stacked stats become expensive
        // enough that a complete "god build" should not arrive in the teens.
        const tierMultipliers = {
            core: 1.05,
            advanced: 1.16,
            experimental: 1.32,
            hybrid: 1.26,
            capstone: 1.48,
        };
        const tierMultiplier = tierMultipliers[upgrade.tier] || 1.05;

        // More powerful base items receive a slightly larger initial premium,
        // rather than applying the same flat percentage to every purchase.
        const powerPremium = 1 + clamp((upgrade.baseCost - 70) / 2400, 0, 0.18);

        // Repeated investment into one core stat gains extra cost pressure after
        // the first few levels. This preserves early build formation but slows
        // extreme single-stat rushing.
        const stackPressure = upgrade.tier === "core"
            ? 1 + Math.max(0, level - 2) * 0.055 + Math.max(0, level - 7) * 0.035
            : 1;

        const totalOwnedLevels = Object.values(upgradeLevels).reduce((sum, value) => sum + value, 0);
        const buildMaturityPressure = totalOwnedLevels <= 10
            ? 1
            : 1 + Math.min(0.28, (totalOwnedLevels - 10) * 0.012);

        const rawCost = upgrade.baseCost
            * difficultyCost
            * Math.pow(upgrade.growth, level)
            * tierMultiplier
            * powerPremium
            * stackPressure
            * buildMaturityPressure;

        return Math.max(1, Math.floor(rawCost));
    }

    /**
     * Validates affordability, spends points, applies the upgrade, and refreshes UI. Never deduct currency before validation succeeds.
     */
    function buyUpgrade(type) {
        const data = UPGRADE_DATA[type];
        const lockReason = getResearchLock(type);
        if (lockReason) return;
        if (data.maxLevel && upgradeLevels[type] >= data.maxLevel) return;
        const cost = getUpgradeCost(type);
        if (state.upgradePoints < cost) return;

        captureReconstructionSnapshot(`${data.label} (${cost} pts)`);
        state.upgradePoints -= cost;
        upgradeLevels[type]++;
        applyUpgrade(type);
        playSound("upgrade");
        updateUpgradeButtons();
    }

    /**
     * Handles the applyUpgrade operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function applyUpgrade(type) {
        const upgradeActions = {
            damage: () => {
                player.damage += 4;
                ui.weapon.textContent = "Heavy";
            },
            fireRate: () => {
                player.fireRate = Math.max(85, player.fireRate - 25);
                ui.weapon.textContent = "Rapid";
            },
            multiShot: () => {
                player.bulletsPerShot++;
                ui.weapon.textContent = "Spread";
            },
            bulletVelocity: () => {
                player.bulletSpeed += 1.15;
                ui.weapon.textContent = "High Velocity";
            },
            explosive: () => {
                player.explosiveLevel++;
                player.explosiveRadius = 42 + player.explosiveLevel * 10;
                player.explosiveDamageRatio = Math.min(0.8, player.explosiveDamageRatio + 0.06);
                ui.weapon.textContent = "Explosive";
            },
            speed: () => {
                player.speed += 0.28;
                ui.weapon.textContent = "Swift";
            },
            magnet: () => {
                player.pointMagnetRadius += 85;
                player.pointMagnetStrength += 0.055;
                ui.weapon.textContent = "Collector";
            },
            autoMissile: () => {
                player.missileLevel++;
                player.missileDamage += 9;
                player.missileCount = Math.max(1, Math.ceil(player.missileLevel / 3));
                player.missileCooldown = Math.max(520, 950 - player.missileLevel * 18);
                ui.weapon.textContent = `Missiles x${player.missileCount}`;
            },
            damageAura: () => {
                player.auraLevel++;
                player.auraDamage += 22;
                player.auraRadius = 135 + Math.floor((player.auraLevel - 1) / 4) * 28;
                ui.weapon.textContent = `Aura ${player.auraRadius}px / ${player.auraDamage} dmg`;
            },
            healthRegen: () => {
                player.regenLevel++;
                player.regenPerSecond = player.regenLevel * 0.15;
                player.regenAmount = player.regenPerSecond;
                player.regenTickRate = 1000;
                ui.weapon.textContent = `Regen ${player.regenPerSecond.toFixed(2)} HP/s`;
            },
            lifeSteal: () => {
                player.lifeStealLevel++;
                player.lifeStealAmount += 1;
                ui.weapon.textContent = `Life Steal ${player.lifeStealAmount}%`;
            },
            maxHealth: () => {
                player.maxHealth += 15;
                player.health = Math.min(player.maxHealth, player.health + 20);
                ui.weapon.textContent = "Fortified";
            },
            adaptivePlating: () => { player.damageReduction = Math.max(player.damageReduction, 0.10); },
            combatNanobots: () => { player.regenDelayAfterDamage = 1000; player.regenPerSecond += 0.35; },
            livingColony: () => { player.maxShield = Math.max(player.maxShield, Math.floor(player.maxHealth * 0.30)); player.shield = player.maxShield; },
            predictiveTargeting: () => { player.damage = Math.round(player.damage * 1.15); player.bulletSpeed += 1.2; },
            heatManagement: () => { player.fireRate = Math.max(65, Math.round(player.fireRate * 0.85)); },
            autonomousArsenal: () => { player.autonomousArsenal = true; },
            boostCapacitor: () => { player.speed += 0.35; player.boostDurationMultiplier = 1.5; },
            inertialDampeners: () => { player.speed += 0.25; player.slowResistance = 0.65; },
            zeroPointReactor: () => { player.speed += 0.55; player.pointMagnetRadius += 160; },
            combatHeuristics: () => { player.missileCooldown = Math.max(380, player.missileCooldown * 0.78); player.missileDamage += 18; },
            swarmMatrix: () => { player.missileCount += 2; player.auraRadius += 55; },
            distributedConsciousness: () => { player.missileCount += 3; player.missileDamage += 40; player.auraDamage += 45; },
            adaptiveHull: () => { player.adaptiveHull = true; player.maxHealth += 20; },
            combatAlgorithms: () => { player.autonomousDamageMultiplier = 1.25; player.missileDamage = Math.round(player.missileDamage * 1.25); },
            railAcceleration: () => { player.bulletSpeed += 3; player.damage += 6; },
            livingDrones: () => { player.livingDrones = true; player.regenPerSecond += 0.30; player.missileDamage += 12; },
        };

        upgradeActions[type]?.();
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getUpgradeStatText(type, next = false) {
        const level = upgradeLevels[type] + (next ? 1 : 0);
        const value = (current, increment) => current + (next ? increment : 0);

        const statMap = {
            multiShot: () => `${next ? "Next" : "Current"}: ${value(player.bulletsPerShot, 1)} projectile${value(player.bulletsPerShot, 1) === 1 ? "" : "s"}`,
            damage: () => `${next ? "Next" : "Current"}: ${value(player.damage, 4)} damage`,
            fireRate: () => `${next ? "Next" : "Current"}: ${Math.max(85, value(player.fireRate, -25))} ms delay`,
            bulletVelocity: () => `${next ? "Next" : "Current"}: ${value(player.bulletSpeed, 1.15).toFixed(1)} speed`,
            explosive: () => next
                ? `Next: ${42 + (player.explosiveLevel + 1) * 10}px blast / stronger splash`
                : `Current: ${player.explosiveLevel ? `${player.explosiveRadius}px blast` : "inactive"}`,
            speed: () => `${next ? "Next" : "Current"}: ${value(player.speed, 0.28).toFixed(2)} move speed`,
            magnet: () => `${next ? "Next" : "Current"}: ${value(player.pointMagnetRadius, 85)}px range`,
            autoMissile: () => {
                const nextLevel = player.missileLevel + (next ? 1 : 0);
                const count = nextLevel > 0 ? Math.max(1, Math.ceil(nextLevel / 3)) : 0;
                const damage = player.missileDamage + (next ? 9 : 0);
                return `${next ? "Next" : "Current"}: ${count} missile${count === 1 ? "" : "s"} / ${damage} dmg`;
            },
            damageAura: () => {
                const nextLevel = player.auraLevel + (next ? 1 : 0);
                const radius = nextLevel > 0 ? 135 + Math.floor((nextLevel - 1) / 4) * 28 : 0;
                const damage = player.auraDamage + (next ? 22 : 0);
                return `${next ? "Next" : "Current"}: ${damage} dmg / ${radius}px radius`;
            },
            healthRegen: () => `${next ? "Next" : "Current"}: ${(player.regenPerSecond + (next ? 0.15 : 0)).toFixed(2)} HP/s`,
            lifeSteal: () => `${next ? "Next" : "Current"}: ${player.lifeStealAmount + (next ? 1 : 0)}% weapon steal`,
            maxHealth: () => `${next ? "Next" : "Current"}: ${value(player.maxHealth, 15)} max HP`,
        };

        return statMap[type]?.() ?? `${next ? "Next" : "Current"}: Level ${level}`;
    }

    /**
     * Rebuilds upgrade-card labels and enabled states from current player data. Inner card elements should remain pointer-transparent.
     */
    function updateUpgradeButtons() {
        ui.menuPoints.textContent = state.upgradePoints;

        for (const button of upgradeButtons) {
            const type = button.dataset.upgrade;
            const data = UPGRADE_DATA[type];
            const cost = getUpgradeCost(type);
            const level = upgradeLevels[type];
            const lockReason = getResearchLock(type);
            const maxed = Boolean(data.maxLevel && level >= data.maxLevel);
            const tierLabel = data.tier === "core" ? "CORE" : data.tier.toUpperCase();

            button.className = `upgrade-button upgrade-${data.category} system-${data.system} tier-${data.tier}`;
            button.style.setProperty("--upgrade-accent", data.accent);
            button.disabled = Boolean(lockReason || maxed || state.upgradePoints < cost);
            const stateText = lockReason ? `<span class="research-lock">LOCKED — ${lockReason}</span>`
                : maxed ? `<span class="research-complete">RESEARCH COMPLETE</span>`
                : `<span class="upgrade-next">${getUpgradeStatText(type, true)}</span>`;
            button.innerHTML = `
                <span class="upgrade-icon" aria-hidden="true">${data.icon}</span>
                <span class="upgrade-copy">
                    <span class="research-tier">${tierLabel}${data.system !== "hybrid" ? ` · ${SHIP_SYSTEMS[data.system].label}` : " · HYBRID"}</span>
                    <span class="upgrade-title">${data.label}</span>
                    <span class="upgrade-description">${data.description}</span>
                    <span class="upgrade-stats">${getUpgradeStatText(type)}<br>${stateText}</span>
                    <span class="upgrade-footer"><span class="upgrade-level">LV ${level}${data.maxLevel ? `/${data.maxLevel}` : ""}</span><span class="upgrade-cost">${maxed ? "ONLINE" : `${cost} PTS`}</span></span>
                </span>`;
            button.setAttribute("aria-label", `${data.label}, level ${level}, ${lockReason || (maxed ? "complete" : `costs ${cost} points`)}. ${data.description}`);
        }
        updateSystemInvestmentUI();
    }

    // -------------------------------------------------------------------------
    // Player movement / shooting
    // -------------------------------------------------------------------------
    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getPlayerMoveSpeed(now) {
        let speed = player.speed;
        if (now < player.speedBoostUntil) speed *= 1.45;
        if (now < player.slowUntil) speed *= player.slowMultiplier;
        return speed;
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    let lastPlayerMovementAt = 0;

    function updatePlayer(now) {
        let keyboardX = 0;
        let keyboardY = 0;

        if (keysHeld.w || keysHeld.arrowup) keyboardY--;
        if (keysHeld.s || keysHeld.arrowdown) keyboardY++;
        if (keysHeld.a || keysHeld.arrowleft) keyboardX--;
        if (keysHeld.d || keysHeld.arrowright) keyboardX++;

        // Keyboard remains digital/full-speed. Analog input preserves stick
        // magnitude, so a small thumb movement produces slow movement instead
        // of being normalized immediately to maximum speed.
        const keyboardLength = Math.hypot(keyboardX, keyboardY);
        if (keyboardLength > 0) {
            keyboardX /= keyboardLength;
            keyboardY /= keyboardLength;
        }

        let dx = keyboardX || analogInput.moveX;
        let dy = keyboardY || analogInput.moveY;

        // Clamp combined input to the unit circle without destroying analog
        // magnitude. This also prevents diagonal movement from becoming faster.
        const inputLength = Math.hypot(dx, dy);
        if (inputLength > 1) {
            dx /= inputLength;
            dy /= inputLength;
        }

        // Movement used to be measured in pixels per rendered frame, causing
        // 90/120 Hz mobile displays to move substantially faster than 60 Hz.
        // Normalize to a 60 Hz baseline and cap long-frame catch-up after pauses.
        const elapsedMs = lastPlayerMovementAt > 0 ? now - lastPlayerMovementAt : 1000 / 60;
        lastPlayerMovementAt = now;
        const frameScale = clamp(elapsedMs / (1000 / 60), 0.25, 1.75);

        const speed = getPlayerMoveSpeed(now);
        player.x += dx * speed * frameScale;
        player.y += dy * speed * frameScale;
        keepPlayerInWorld();
    }

    /**
     * Handles the shootPlayerWeapon operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function shootPlayerWeapon(now) {
        if (state.clearPhaseActive) return;
        if (now - player.lastShotAt < player.fireRate) return;

        player.lastShotAt = now;
        player.volleyCounter++;

        const target = screenToWorld(mouse);
        const aimAngle = Math.atan2(target.y - player.y, target.x - player.x);
        const spread = 0.18;
        const centerOffset = (player.bulletsPerShot - 1) / 2;

        playSound("shoot");

        for (let i = 0; i < player.bulletsPerShot; i++) {
            const angle = aimAngle + (i - centerOffset) * spread;
            createPlayerBullet(angle);
        }
        if (player.autonomousArsenal && player.volleyCounter % 5 === 0) {
            createPlayerBullet(aimAngle - 0.30);
            createPlayerBullet(aimAngle + 0.30);
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function createPlayerBullet(angle) {
        bullets.push({
            x: player.x + Math.cos(angle) * 24,
            y: player.y + Math.sin(angle) * 24,
            r: player.explosiveLevel > 0 ? 6 : 5,
            dx: Math.cos(angle) * player.bulletSpeed,
            dy: Math.sin(angle) * player.bulletSpeed,
            damage: player.damage,
            explosive: player.explosiveLevel > 0,
            explosionRadius: player.explosiveRadius,
            explosionDamage: Math.max(2, Math.floor(player.damage * player.explosiveDamageRatio)),
        });
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateAutoMissiles(now) {
        if (player.missileCount <= 0 || state.clearPhaseActive) return;
        if (now - player.lastMissileAt < player.missileCooldown) return;

        const targets = getNearestEnemies(player.missileCount);
        if (targets.length === 0) return;

        player.lastMissileAt = now;
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const angle = Math.atan2(target.y - player.y, target.x - player.x) + (i - (targets.length - 1) / 2) * 0.18;
            missiles.push({
                x: player.x + Math.cos(angle) * 30,
                y: player.y + Math.sin(angle) * 30,
                r: 7,
                dx: Math.cos(angle) * 6.4,
                dy: Math.sin(angle) * 6.4,
                speed: 6.4,
                turnRate: 0.12,
                damage: player.missileDamage,
                explosionRadius: 58 + Math.floor(player.missileLevel / 4) * 6,
                explosionDamage: Math.max(4, Math.floor(player.missileDamage * 0.45)),
                life: 190,
                target,
            });
        }
        playSound("shoot");
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getNearestEnemies(limit) {
        return enemies
            .filter(enemy => enemy && !enemy.dead)
            .sort((a, b) => distance(player, a) - distance(player, b))
            .slice(0, limit);
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateMissiles() {
        for (const missile of missiles) {
            if (!missile || missile.dead) continue;

            missile.life--;
            if (missile.life <= 0) {
                missile.dead = true;
                continue;
            }

            if (!missile.target || missile.target.dead) {
                missile.target = getNearestEnemies(1)[0] || null;
            }

            if (missile.target) {
                const desiredAngle = Math.atan2(missile.target.y - missile.y, missile.target.x - missile.x);
                const currentAngle = Math.atan2(missile.dy, missile.dx);
                const angleDelta = Math.atan2(Math.sin(desiredAngle - currentAngle), Math.cos(desiredAngle - currentAngle));
                const nextAngle = currentAngle + clamp(angleDelta, -missile.turnRate, missile.turnRate);
                missile.dx = Math.cos(nextAngle) * missile.speed;
                missile.dy = Math.sin(nextAngle) * missile.speed;
            }

            missile.x += missile.dx;
            missile.y += missile.dy;

            if (isOutsideWorld(missile, 80)) {
                missile.dead = true;
            }
        }

        checkMissileHits();
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkMissileHits() {
        for (const missile of missiles) {
            if (!missile || missile.dead) continue;

            for (let enemyIndex = enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
                const enemy = enemies[enemyIndex];
                if (!enemy || enemy.dead) continue;
                if (distance(missile, enemy) >= missile.r + enemy.r) continue;

                missile.dead = true;
                damageEnemy(enemyIndex, missile.damage, "missile");
                explodeAt(missile.x, missile.y, missile.explosionRadius, missile.explosionDamage, enemy);
                break;
            }
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateDamageAura(now) {
        if (player.auraLevel <= 0 || player.auraRadius <= 0) return;
        if (now - player.lastAuraTickAt < player.auraTickRate) return;

        player.lastAuraTickAt = now;
        let hitSomething = false;

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (!enemy || enemy.dead) continue;
            if (distance(player, enemy) > player.auraRadius + enemy.r) continue;

            enemy.auraFlashUntil = now + 180;
            damageEnemy(i, player.auraDamage, "aura");
            addDamageNumber(enemy.x, enemy.y - enemy.r - 12, player.auraDamage, "#63d7ff");
            hitSomething = true;
        }

        if (hitSomething) {
            particles.push({
                x: player.x, y: player.y, dx: 0, dy: 0, r: player.auraRadius,
                color: "#63d7ff", life: 16, maxLife: 16, auraRing: true,
            });
        }
    }

    // -------------------------------------------------------------------------
    // Relic runtime systems
    // -------------------------------------------------------------------------
    function getAwakenedRelicStage(id) {
        return relicResearch[id]?.awakened ? Math.max(1, relicResearch[id].stage) : 0;
    }

    function updateRelicSystems(now) {
        updateVerdantCore(now);
        updateAstralLens(now);
        updateGravityHeart(now);
        updateEchoingSwarm(now);
    }

    function updateVerdantCore(now) {
        const stage = getAwakenedRelicStage("relic_green_01");
        if (!stage) { relicOrbs.length = 0; return; }
        const desired = Math.min(3, stage);
        while (relicOrbs.length < desired) relicOrbs.push({ angle: (TWO_PI / desired) * relicOrbs.length, cooldownUntil: 0 });
        relicOrbs.length = desired;
        const radius = 72 + stage * 12;
        for (let i = 0; i < relicOrbs.length; i++) {
            const orb = relicOrbs[i];
            orb.angle += 0.026 + stage * 0.004;
            orb.x = player.x + Math.cos(orb.angle + i * TWO_PI / desired) * radius;
            orb.y = player.y + Math.sin(orb.angle + i * TWO_PI / desired) * radius;
            if (now < orb.cooldownUntil) continue;
            for (let e = enemies.length - 1; e >= 0; e--) {
                const enemy = enemies[e];
                if (!enemy || enemy.dead || distance(orb, enemy) > enemy.r + 12) continue;
                damageEnemy(e, 24 + stage * 16, "relic");
                explodeAt(orb.x, orb.y, 48 + stage * 10, 12 + stage * 8, enemy);
                orb.cooldownUntil = now + Math.max(850, 1550 - stage * 180);
                break;
            }
        }
    }

    function updateAstralLens(now) {
        const stage = getAwakenedRelicStage("relic_red_01");
        if (!stage) return;
        const cooldown = Math.max(6500, 12500 - stage * 1900);
        if (now >= relicLaser.nextAt && now >= relicLaser.activeUntil) {
            const aim = screenToWorld(mouse);
            relicLaser.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
            relicLaser.activeUntil = now + 360 + stage * 90;
            relicLaser.nextAt = now + cooldown;
            relicLaser.hitIds = new Set();
            playSound("upgrade");
        }
        if (now >= relicLaser.activeUntil) return;
        const width = 16 + stage * 7;
        const ax = Math.cos(relicLaser.angle), ay = Math.sin(relicLaser.angle);
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (!enemy || enemy.dead || relicLaser.hitIds.has(enemy)) continue;
            const rx = enemy.x - player.x, ry = enemy.y - player.y;
            const forward = rx * ax + ry * ay;
            const lateral = Math.abs(rx * ay - ry * ax);
            if (forward > 0 && forward < 1500 && lateral < width + enemy.r) {
                relicLaser.hitIds.add(enemy);
                damageEnemy(i, 70 + stage * 45, "relic");
            }
        }
    }

    function updateGravityHeart(now) {
        const stage = getAwakenedRelicStage("relic_blue_01");
        if (!stage) return;
        const cooldown = Math.max(5500, 10500 - stage * 1500);
        if (now < relicPulse.nextAt) return;
        relicPulse.nextAt = now + cooldown;
        relicPulse.visualUntil = now + 500;
        relicPulse.radius = 230 + stage * 70;
        for (const enemy of enemies) {
            if (!enemy || enemy.dead) continue;
            const dx = enemy.x - player.x, dy = enemy.y - player.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist > relicPulse.radius) continue;
            const push = (relicPulse.radius - dist) * (0.28 + stage * 0.05);
            enemy.x = clamp(enemy.x + dx / dist * push, enemy.r, WORLD.width - enemy.r);
            enemy.y = clamp(enemy.y + dy / dist * push, enemy.r, WORLD.height - enemy.r);
            enemy.relicSlowUntil = now + 900 + stage * 250;
        }
        particles.push({ x: player.x, y: player.y, dx: 0, dy: 0, r: relicPulse.radius, color: "#59c8ff", life: 24, maxLife: 24, auraRing: true });
        playSound("pickup");
    }

    function updateEchoingSwarm(now) {
        const stage = getAwakenedRelicStage("relic_purple_01");
        if (!stage) { relicDrones.length = 0; return; }
        const desired = Math.min(3, stage);
        while (relicDrones.length < desired) {
            relicDrones.push({ id: nextRelicDroneId++, angle: Math.random() * TWO_PI, health: 35 + stage * 20, maxHealth: 35 + stage * 20, expiresAt: now + 15000 + stage * 3000, nextShotAt: now + 400, dead: false });
        }
        for (const drone of relicDrones) {
            drone.angle += 0.018 + stage * 0.003;
            const radius = 105 + (drone.id % 2) * 24;
            drone.x = player.x + Math.cos(drone.angle) * radius;
            drone.y = player.y + Math.sin(drone.angle) * radius;
            if (now >= drone.expiresAt || drone.health <= 0) drone.dead = true;
            if (drone.dead || now < drone.nextShotAt) continue;
            let target = null, best = 560;
            for (const enemy of enemies) {
                const d = distance(drone, enemy);
                if (d < best) { best = d; target = enemy; }
            }
            if (target) {
                const angle = Math.atan2(target.y - drone.y, target.x - drone.x);
                bullets.push({ x: drone.x, y: drone.y, r: 4, dx: Math.cos(angle) * 10, dy: Math.sin(angle) * 10, damage: 9 + stage * 7, color: "#d192ff", explosive: false, relicDroneShot: true });
                drone.nextShotAt = now + Math.max(360, 760 - stage * 120);
            }
        }
        for (let i = relicDrones.length - 1; i >= 0; i--) if (relicDrones[i].dead) relicDrones.splice(i, 1);
    }

    function drawRelicSystems(now = Date.now()) {
        const greenStage = getAwakenedRelicStage("relic_green_01");
        if (greenStage) for (const orb of relicOrbs) {
            const ready = now >= orb.cooldownUntil;
            drawCircle(ctx, orb.x - camera.x, orb.y - camera.y, ready ? 11 : 7, ready ? "#78ff9f" : "rgba(120,255,159,.35)");
        }
        if (now < relicLaser.activeUntil) {
            const sx = player.x - camera.x, sy = player.y - camera.y;
            const length = 1600;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = "rgba(255,120,90,.9)";
            ctx.lineWidth = 10 + getAwakenedRelicStage("relic_red_01") * 5;
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(relicLaser.angle) * length, sy + Math.sin(relicLaser.angle) * length); ctx.stroke();
            ctx.strokeStyle = "white"; ctx.lineWidth = 3; ctx.stroke();
            ctx.restore();
        }
        for (const drone of relicDrones) {
            const x = drone.x - camera.x, y = drone.y - camera.y;
            ctx.save(); ctx.translate(x,y); ctx.rotate(drone.angle + Math.PI/2);
            ctx.fillStyle = "#d192ff"; ctx.beginPath(); ctx.moveTo(0,-9); ctx.lineTo(7,7); ctx.lineTo(0,4); ctx.lineTo(-7,7); ctx.closePath(); ctx.fill();
            ctx.restore();
        }
    }

    // -------------------------------------------------------------------------
    // Enemies
    // -------------------------------------------------------------------------
    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    let nextBossCommandId = 1;

    function makeEnemy(type, position) {
        const stats = getEnemyStats(type);
        const enemy = {
            type,
            x: position.x,
            y: position.y,
            color: ENEMY_COLORS[type],
            lastHitAt: 0,
            lastShotAt: 0,
            ...stats,
        };

        if (type === "boss" || type === "gigaBoss") {
            enemy.commandId = nextBossCommandId++;
            enemy.commandNextAt = 0;
            enemy.commandPoints = 0;
            enemy.commandPhaseMask = 0;
        }

        return enemy;
    }

    /**
     * Builds final enemy stats from base archetype values plus difficulty and wave scaling. Return fresh data; do not mutate shared constants.
     */
    function getEnemyStats(type) {
        const wave = state.wave;
        const difficulty = getDifficulty();
        const scaledWave = 1 + Math.max(0, wave - 1) * difficulty.enemyGrowth;

        const statsByType = {
            normal: {
                r: 18,
                speed: 1.45 + scaledWave * 0.14,
                health: 30 + scaledWave * 10,
                damage: 12,
                reward: 12,
            },
            runner: {
                r: 13,
                speed: 2.7 + scaledWave * 0.18,
                health: 18 + scaledWave * 6,
                damage: 12,
                reward: 18,
            },
            brute: {
                r: 23,
                speed: 1.25 + scaledWave * 0.1,
                health: 65 + scaledWave * 16,
                damage: 22,
                reward: 30,
                shootCooldown: Math.max(1100, 2100 - scaledWave * 35),
            },
            tank: {
                r: 30,
                speed: 0.85 + scaledWave * 0.06,
                health: 110 + scaledWave * 24,
                damage: 30,
                reward: 45,
            },
            miniTank: {
                r: 42,
                speed: 0.72 + scaledWave * 0.045,
                health: 360 + scaledWave * 42,
                damage: 36,
                reward: 115 + scaledWave * 6,
                shootCooldown: Math.max(850, 1850 - scaledWave * 32),
            },
            fighter: {
                r: 16,
                speed: 2.65 + scaledWave * 0.11,
                health: 28 + scaledWave * 7,
                damage: 16,
                reward: 28,
                shootCooldown: Math.max(520, 1150 - scaledWave * 20),
                orbitRadius: 250 + Math.random() * 90,
                orbitDirection: Math.random() < 0.5 ? -1 : 1,
                orbitPhase: Math.random() * TWO_PI,
            },
            carrier: {
                r: 62,
                speed: 0.24 + scaledWave * 0.012,
                health: 1500 + scaledWave * 185,
                damage: 48,
                reward: 230 + scaledWave * 12,
                // The carrier cannon is intentionally independent from its missile factory.
                shootCooldown: Math.max(620, 1250 - scaledWave * 16),
                missileInitialVolleyPending: true,
                nextMissileVolleyAt: 0,
                carrierOrbitDirection: Math.random() < 0.5 ? -1 : 1,
                carrierOrbitPhase: Math.random() * TWO_PI,
            },
            dodger: {
                r: 15,
                speed: 2.15 + scaledWave * 0.13,
                health: 22 + scaledWave * 8,
                damage: 14,
                reward: 25,
                dashRange: 360,
                dashDuration: 260,
                dashCooldown: 950,
                dashUntil: 0,
                nextDashAt: 0,
                dashVectorX: 0,
                dashVectorY: 0,
                speedMultiplier: 1,
            },
            boss: {
                r: 54,
                speed: 0.72 + scaledWave * 0.035,
                health: 900 + scaledWave * 145,
                damage: 42,
                reward: 260 + scaledWave * 18,
                shootCooldown: Math.max(900, 1700 - scaledWave * 25),
                commandNextAt: 0,
                commandPoints: 0,
                commandPhaseMask: 0,
                commandId: 0,
            },
            gigaBoss: {
                r: 78,
                speed: 0.48 + scaledWave * 0.025,
                health: 2600 + scaledWave * 260,
                damage: 65,
                reward: 750 + scaledWave * 35,
                shootCooldown: Math.max(650, 1450 - scaledWave * 22),
                commandNextAt: 0,
                commandPoints: 0,
                commandPhaseMask: 0,
                commandId: 0,
            },
        };

        const stats = { ...statsByType[type] };

        stats.health = Math.max(1, Math.round(stats.health * difficulty.enemyHealth));
        stats.maxHealth = stats.health;
        const damageRamp = 1 + Math.max(0, wave - 1) * difficulty.damageGrowth;
        stats.damage = Math.max(1, Math.round(stats.damage * difficulty.enemyDamage * damageRamp));
        // Global playtester accessibility pass: all enemies retain their relative archetype/difficulty
        // differences, but move at 60% of the previous final speed. Tune this single multiplier
        // rather than editing every archetype independently.
        stats.speed *= difficulty.enemySpeed * 0.60;
        stats.reward = Math.max(1, Math.round(stats.reward * difficulty.enemyReward));

        return stats;
    }

    /**
     * Selects an archetype using wave gates and weighted chances. Preserve readable unlock rules so early-wave pacing stays tunable.
     */
    function chooseEnemyType() {
        const roll = Math.random();
        const spawnNumber = state.enemiesSpawned;
        const difficulty = getDifficulty();
        const unlock = baseWave => Math.max(1, baseWave + difficulty.typeUnlockOffset);

        if (isGigaBossWave() && spawnNumber === 0) return "gigaBoss";
        if (isGigaBossWave() && (spawnNumber === 1 || spawnNumber === 2)) return "boss";
        if (isBossWave() && spawnNumber === 0) return "boss";
        if (state.wave >= unlock(14) && spawnNumber > 5 && spawnNumber % 18 === 0) return "carrier";
        if (state.wave >= unlock(10) && spawnNumber > 2 && spawnNumber % 14 === 0) return "miniTank";
        if (state.wave >= unlock(11) && roll < difficulty.miniTankChance) return "miniTank";
        if (state.wave >= unlock(8) && roll < 0.20) return "fighter";
        if (state.wave >= unlock(6) && roll < 0.34) return "dodger";
        if (state.wave >= unlock(4) && roll < 0.32) return "tank";
        if (state.wave >= unlock(3) && roll < 0.55) return "runner";
        if (state.wave >= unlock(5) && roll < 0.70) return "brute";
        return "normal";
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnEnemy() {
        const position = getSpawnPosition();
        const enemyType = chooseEnemyType();
        const enemy = makeEnemy(enemyType, position);
        enemies.push(enemy);

        if (enemyType === "boss" || enemyType === "gigaBoss") {
            playSound("bossSpawn");
        } else if (enemyType === "miniTank" || enemyType === "carrier") {
            playSound("miniBossSpawn");
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getSpawnPosition() {
        const margin = 140;
        const side = Math.floor(Math.random() * 4);
        let x;
        let y;

        if (side === 0) {
            x = camera.x + Math.random() * getVisibleWorldWidth();
            y = camera.y - margin;
        } else if (side === 1) {
            x = camera.x + getVisibleWorldWidth() + margin;
            y = camera.y + Math.random() * getVisibleWorldHeight();
        } else if (side === 2) {
            x = camera.x + Math.random() * getVisibleWorldWidth();
            y = camera.y + getVisibleWorldHeight() + margin;
        } else {
            x = camera.x - margin;
            y = camera.y + Math.random() * getVisibleWorldHeight();
        }

        const position = pushSpawnAwayFromPlayer({
            x: clamp(x, 40, WORLD.width - 40),
            y: clamp(y, 40, WORLD.height - 40),
        });

        return position;
    }

    /**
     * Handles the pushSpawnAwayFromPlayer operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function pushSpawnAwayFromPlayer(position) {
        const minimumDistance = getDifficulty().minimumSpawnDistance || 480;
        if (distance(position, player) >= minimumDistance) return position;

        const angle = Math.atan2(position.y - player.y, position.x - player.x);
        return {
            x: clamp(player.x + Math.cos(angle) * minimumDistance, 40, WORLD.width - 40),
            y: clamp(player.y + Math.sin(angle) * minimumDistance, 40, WORLD.height - 40),
        };
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateEnemySpawning() {
        if (state.clearPhaseActive) return;
        state.spawnTimer++;
        const spawnDelay = Math.max(9, (42 - state.wave * 1.5) * getDifficulty().spawnDelay);

        const difficultyConcurrentCap = getDifficulty().maxConcurrent || PERFORMANCE_LIMITS.maxEnemies;
        const concurrentCap = Math.min(PERFORMANCE_LIMITS.maxEnemies, Math.round(difficultyConcurrentCap * (PLATFORM_PROFILE.spawnMultiplier || 1)));

        if (state.enemiesSpawned < state.enemiesToSpawn && state.spawnTimer > spawnDelay && enemies.length < concurrentCap) {
            spawnEnemy();
            state.enemiesSpawned++;
            state.spawnTimer = 0;
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateEnemies(now) {
        updateEnemySpawning();

        for (const enemy of enemies) {
            if (!enemy || enemy.dead) continue;

            const movement = getEnemyMovement(enemy, now);
            const speedMultiplier = (enemy.speedMultiplier || 1) * (now < (enemy.relicSlowUntil || 0) ? 0.55 : 1);

            enemy.x = clamp(enemy.x + movement.x * enemy.speed * speedMultiplier, enemy.r, WORLD.width - enemy.r);
            enemy.y = clamp(enemy.y + movement.y * enemy.speed * speedMultiplier, enemy.r, WORLD.height - enemy.r);
        }

        resolveEnemyCrowding();

        for (const enemy of enemies) {
            if (!enemy || enemy.dead) continue;
            if (enemy.type === "carrier") updateCarrierSystems(enemy, now);
            if (enemy.type === "boss" || enemy.type === "gigaBoss") updateBossCommandSystems(enemy, now);
            if (canEnemyShoot(enemy)) shootEnemy(enemy, now);
            damagePlayerOnTouch(enemy, now);
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getEnemyMovement(enemy, now) {
        let dx = player.x - enemy.x;
        let dy = player.y - enemy.y;
        const length = Math.hypot(dx, dy);

        if (length > 0) {
            dx /= length;
            dy /= length;
        }

        if (enemy.type === "dodger") {
            return getDodgerMovement(enemy, dx, dy, now);
        }
        if (enemy.type === "fighter") {
            return getFighterMovement(enemy, dx, dy, now);
        }
        if (enemy.type === "carrier") {
            return getCarrierMovement(enemy, dx, dy, now);
        }

        return addEnemySeparationSteering(enemy, dx, dy);
    }

    /**
     * Handles the addEnemySeparationSteering operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function addEnemySeparationSteering(enemy, baseX, baseY) {
        const separation = getEnemySeparationVector(enemy);
        if (!separation.active) return { x: baseX, y: baseY };

        return normalizeVector(
            baseX + separation.x * separation.weight,
            baseY + separation.y * separation.weight
        );
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getEnemySeparationVector(enemy) {
        let pushX = 0;
        let pushY = 0;
        let strongestPush = 0;

        for (const other of enemies) {
            if (!other || other.dead || other === enemy) continue;

            const dx = enemy.x - other.x;
            const dy = enemy.y - other.y;
            const dist = Math.hypot(dx, dy) || 0.001;
            const avoidDistance = enemy.r + other.r + 34;

            if (dist >= avoidDistance) continue;

            const pressure = 1 - dist / avoidDistance;
            const sizeBias = clamp(other.r / Math.max(1, enemy.r), 0.55, 2.4);

            pushX += (dx / dist) * pressure * sizeBias;
            pushY += (dy / dist) * pressure * sizeBias;
            strongestPush = Math.max(strongestPush, pressure);
        }

        const normalized = normalizeVector(pushX, pushY);
        return {
            x: normalized.x,
            y: normalized.y,
            weight: 1.25 + strongestPush * 2.4,
            active: strongestPush > 0,
        };
    }

    /**
     * Handles the resolveEnemyCrowding operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function resolveEnemyCrowding() {
        const aliveCount = enemies.reduce((count, enemy) => count + (enemy && !enemy.dead ? 1 : 0), 0);
        const passes = aliveCount > 70 ? 1 : 2;
        let testedPairs = 0;

        for (let pass = 0; pass < passes; pass++) {
            for (let i = 0; i < enemies.length; i++) {
                const a = enemies[i];
                if (!a || a.dead) continue;

                for (let j = i + 1; j < enemies.length; j++) {
                    if (++testedPairs > PERFORMANCE_LIMITS.maxCrowdingPairs) return;
                    const b = enemies[j];
                    if (!b || b.dead) continue;

                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const roughRange = a.r + b.r + 8;
                    if (Math.abs(dx) > roughRange || Math.abs(dy) > roughRange) continue;

                    const dist = Math.hypot(dx, dy) || 0.001;
                    const minDist = a.r + b.r + 3;

                    if (dist >= minDist) continue;

                    const nx = dx / dist;
                    const ny = dy / dist;
                    const overlap = (minDist - dist) * 0.54;

                    const aMass = a.r * a.r;
                    const bMass = b.r * b.r;
                    const totalMass = aMass + bMass;
                    const aMove = overlap * (bMass / totalMass);
                    const bMove = overlap * (aMass / totalMass);

                    a.x = clamp(a.x - nx * aMove, a.r, WORLD.width - a.r);
                    a.y = clamp(a.y - ny * aMove, a.r, WORLD.height - a.r);
                    b.x = clamp(b.x + nx * bMove, b.r, WORLD.width - b.r);
                    b.y = clamp(b.y + ny * bMove, b.r, WORLD.height - b.r);
                }
            }
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getFighterMovement(enemy, baseX, baseY, now) {
        const dist = distance(enemy, player);
        const tangentX = -baseY * enemy.orbitDirection;
        const tangentY = baseX * enemy.orbitDirection;
        const desiredRadius = enemy.orbitRadius;
        const radialError = clamp((dist - desiredRadius) / Math.max(1, desiredRadius), -1, 1);
        const radialWeight = dist < desiredRadius ? -0.9 : 0.9;
        const wobble = Math.sin(now / 260 + enemy.orbitPhase) * 0.22;

        return addEnemySeparationSteering(
            enemy,
            tangentX + baseX * radialError * radialWeight + tangentY * wobble,
            tangentY + baseY * radialError * radialWeight - tangentX * wobble
        );
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    /**
     * Keeps carriers at support range while they strafe around the player.
     * The missile screen provides defense; the carrier itself should not blindly ram.
     */
    function getCarrierMovement(enemy, baseX, baseY, now) {
        const dist = distance(enemy, player);
        const tangentX = -baseY * enemy.carrierOrbitDirection;
        const tangentY = baseX * enemy.carrierOrbitDirection;
        const wobble = Math.sin(now / 700 + enemy.carrierOrbitPhase) * 0.16;

        let radial = 0;
        if (dist < 500) radial = -1.35;
        else if (dist > 780) radial = 0.72;
        else radial = clamp((dist - 640) / 260, -0.28, 0.28);

        return addEnemySeparationSteering(
            enemy,
            tangentX * 0.88 + baseX * radial + tangentY * wobble,
            tangentY * 0.88 + baseY * radial - tangentX * wobble
        );
    }

    function getDodgerMovement(enemy, baseX, baseY, now) {
        enemy.speedMultiplier = 1;

        const evasion = getDodgerBulletEvasion(enemy);
        if (evasion.threatened) {
            enemy.dashUntil = 0;
            return normalizeVector(
                baseX * 0.25 + evasion.x * evasion.weight,
                baseY * 0.25 + evasion.y * evasion.weight
            );
        }

        const playerDistance = distance(enemy, player);
        if (playerDistance <= enemy.dashRange && now >= enemy.nextDashAt) {
            enemy.dashUntil = now + enemy.dashDuration;
            enemy.nextDashAt = now + enemy.dashCooldown + randomRange(0, 420);
            enemy.dashVectorX = baseX;
            enemy.dashVectorY = baseY;
        }

        if (now < enemy.dashUntil) {
            enemy.speedMultiplier = 2.45;
            return { x: enemy.dashVectorX, y: enemy.dashVectorY };
        }

        return addEnemySeparationSteering(enemy, baseX, baseY);
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getDodgerBulletEvasion(enemy) {
        let dodgeX = 0;
        let dodgeY = 0;
        let strongestThreat = 0;

        for (const bullet of bullets) {
            if (!bullet || bullet.dead) continue;

            const relativeX = enemy.x - bullet.x;
            const relativeY = enemy.y - bullet.y;
            const velocitySizeSq = bullet.dx * bullet.dx + bullet.dy * bullet.dy;
            if (velocitySizeSq <= 0.01) continue;

            const framesUntilClosest = clamp(
                (relativeX * bullet.dx + relativeY * bullet.dy) / velocitySizeSq,
                0,
                34
            );

            const predictedBulletX = bullet.x + bullet.dx * framesUntilClosest;
            const predictedBulletY = bullet.y + bullet.dy * framesUntilClosest;
            const predictedDistance = Math.hypot(enemy.x - predictedBulletX, enemy.y - predictedBulletY);
            const currentDistance = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
            const dangerRadius = enemy.r + bullet.r + 42;

            if (currentDistance > 280 || predictedDistance > dangerRadius) continue;

            const bulletSpeed = Math.sqrt(velocitySizeSq);
            const bulletDirX = bullet.dx / bulletSpeed;
            const bulletDirY = bullet.dy / bulletSpeed;
            const perpX = -bulletDirY;
            const perpY = bulletDirX;

            const sideChoice = ((enemy.x - bullet.x) * perpX + (enemy.y - bullet.y) * perpY) >= 0 ? 1 : -1;
            const urgency = 1 - clamp(predictedDistance / dangerRadius, 0, 1);
            const threatWeight = 1.3 + urgency * 3.2;

            dodgeX += perpX * sideChoice * threatWeight;
            dodgeY += perpY * sideChoice * threatWeight;
            strongestThreat = Math.max(strongestThreat, urgency);
        }

        const normalized = normalizeVector(dodgeX, dodgeY);
        return {
            x: normalized.x,
            y: normalized.y,
            weight: 1.5 + strongestThreat * 2.1,
            threatened: strongestThreat > 0,
        };
    }

    /**
     * Normalizes external or computed input into the safe format expected by downstream code.
     */
    function normalizeVector(x, y) {
        const length = Math.hypot(x, y);
        return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
    }

    /**
     * Returns the reinforcement doctrine for bosses. Summons are bounded by both
     * a per-boss cap and the platform enemy cap, so command behavior creates a
     * tactical battle instead of an infinite spawn leak.
     */
    function getBossCommandProfile(enemy) {
        const difficultyProfiles = {
            easy:       { interval: 10500, activeCap: 5,  pointsPerOrder: 34, phaseBurst: 18 },
            medium:     { interval: 8600,  activeCap: 7,  pointsPerOrder: 46, phaseBurst: 24 },
            hard:       { interval: 7000,  activeCap: 10, pointsPerOrder: 62, phaseBurst: 32 },
            impossible: { interval: 5600,  activeCap: 13, pointsPerOrder: 82, phaseBurst: 42 },
        };
        const base = difficultyProfiles[state.difficulty] || difficultyProfiles.medium;
        const lateWave = Math.max(0, state.wave - 10);
        const gigaMultiplier = enemy.type === "gigaBoss" ? 1.55 : 1;
        return {
            interval: Math.max(3800, base.interval - lateWave * 90),
            activeCap: Math.min(20, Math.round((base.activeCap + Math.floor(lateWave / 8)) * gigaMultiplier)),
            pointsPerOrder: Math.round((base.pointsPerOrder + lateWave * 1.6) * gigaMultiplier),
            phaseBurst: Math.round(base.phaseBurst * gigaMultiplier),
        };
    }

    function countBossSummons(enemy) {
        return enemies.reduce((count, candidate) => count + (
            candidate && !candidate.dead && candidate.commandOwnerId === enemy.commandId ? 1 : 0
        ), 0);
    }

    /**
     * Weights reinforcement types against the player's visible build. This is a
     * soft response, not a hard counter: every order still contains variety.
     */
    function chooseBossSummonType(enemy) {
        const redInvestment = getSystemInvestment("red");
        const greenInvestment = getSystemInvestment("green");
        const blueInvestment = getSystemInvestment("blue");
        const purpleInvestment = getSystemInvestment("purple");
        const options = [
            { type: "runner", cost: 8, weight: 1.4 + purpleInvestment * 0.12 },
            { type: "fighter", cost: 15, weight: 1.2 + greenInvestment * 0.10 },
            { type: "brute", cost: 22, weight: 0.9 + greenInvestment * 0.13 },
            { type: "dodger", cost: 18, weight: 0.9 + redInvestment * 0.11 },
            { type: "tank", cost: 27, weight: 0.65 + redInvestment * 0.08 },
        ];

        if (state.wave >= 18 || enemy.type === "gigaBoss") {
            options.push({ type: "carrier", cost: 48, weight: 0.22 + redInvestment * 0.045 + blueInvestment * 0.025 });
        }

        const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const option of options) {
            roll -= option.weight;
            if (roll <= 0) return option;
        }
        return options[0];
    }

    function getBossSummonPosition(enemy, index = 0) {
        const angle = Math.random() * TWO_PI + index * 1.7;
        const radius = enemy.r + 100 + Math.random() * 90;
        return {
            x: clamp(enemy.x + Math.cos(angle) * radius, 40, WORLD.width - 40),
            y: clamp(enemy.y + Math.sin(angle) * radius, 40, WORLD.height - 40),
        };
    }

    function spawnBossReinforcement(enemy, type, index = 0) {
        if (enemies.length >= PERFORMANCE_LIMITS.maxEnemies) return false;
        const summon = makeEnemy(type, getBossSummonPosition(enemy, index));
        summon.commandOwnerId = enemy.commandId;
        summon.isBossSummon = true;
        // Summons are worth less than natural wave enemies, preventing bosses
        // from becoming renewable point farms.
        summon.reward = Math.max(1, Math.round(summon.reward * 0.38));
        enemies.push(summon);
        return true;
    }

    function issueBossReinforcementOrder(enemy, pointBudget, activeRoom) {
        let remaining = pointBudget;
        let spawned = 0;
        let attempts = 0;
        while (activeRoom > 0 && attempts++ < 18) {
            const option = chooseBossSummonType(enemy);
            if (option.cost > remaining) {
                const affordable = [
                    { type: "runner", cost: 8 },
                    { type: "fighter", cost: 15 },
                    { type: "dodger", cost: 18 },
                    { type: "brute", cost: 22 },
                ].filter(item => item.cost <= remaining);
                if (!affordable.length) break;
                const fallback = affordable[Math.floor(Math.random() * affordable.length)];
                if (!spawnBossReinforcement(enemy, fallback.type, spawned)) break;
                remaining -= fallback.cost;
            } else {
                if (!spawnBossReinforcement(enemy, option.type, spawned)) break;
                remaining -= option.cost;
            }
            spawned++;
            activeRoom--;
        }
        return spawned;
    }

    /**
     * Bosses operate as battlefield commanders. Timed orders rebuild escorts,
     * while 75/50/25-percent health thresholds grant one-time distress bursts.
     */
    function updateBossCommandSystems(enemy, now) {
        const profile = getBossCommandProfile(enemy);
        const activeSummons = countBossSummons(enemy);
        const difficultyCap = getDifficulty().maxConcurrent || PERFORMANCE_LIMITS.maxEnemies;
        const platformCap = Math.min(PERFORMANCE_LIMITS.maxEnemies, Math.round(difficultyCap * (PLATFORM_PROFILE.spawnMultiplier || 1)));
        const room = Math.max(0, Math.min(profile.activeCap - activeSummons, platformCap - enemies.length));
        if (room <= 0) return;

        if (!enemy.commandNextAt) enemy.commandNextAt = now + profile.interval * 0.45;

        const healthRatio = enemy.health / Math.max(1, enemy.maxHealth);
        const thresholds = [0.75, 0.50, 0.25];
        for (let i = 0; i < thresholds.length; i++) {
            const mask = 1 << i;
            if (healthRatio <= thresholds[i] && !(enemy.commandPhaseMask & mask)) {
                enemy.commandPhaseMask |= mask;
                issueBossReinforcementOrder(enemy, profile.phaseBurst, room);
                playSound("miniBossSpawn");
                enemy.commandNextAt = Math.max(enemy.commandNextAt, now + 2600);
                return;
            }
        }

        if (now < enemy.commandNextAt) return;
        issueBossReinforcementOrder(enemy, profile.pointsPerOrder, room);
        enemy.commandNextAt = now + profile.interval * randomRange(0.88, 1.12);
    }

    /**
     * Handles the canEnemyShoot operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function canEnemyShoot(enemy) {
        return enemy.type === "brute" || enemy.type === "miniTank" || enemy.type === "fighter" || enemy.type === "carrier" || enemy.type === "boss" || enemy.type === "gigaBoss";
    }

    /**
     * Handles the shootEnemy operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function shootEnemy(enemy, now) {
        if (now - enemy.lastShotAt < enemy.shootCooldown) return;
        if (distance(enemy, player) > 760) return;

        enemy.lastShotAt = now;
        playSound("enemyShoot");

        if (enemy.type === "carrier") {
            shootCarrierCannon(enemy);
            return;
        }

        const baseAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        const shotCount = enemy.type === "gigaBoss" ? 9 : enemy.type === "boss" ? 5 : enemy.type === "miniTank" ? 3 : enemy.type === "fighter" ? 2 : 1;
        const spread = enemy.type === "gigaBoss" ? 0.22 : enemy.type === "boss" ? 0.18 : enemy.type === "miniTank" ? 0.14 : enemy.type === "fighter" ? 0.08 : 0;
        const centerOffset = (shotCount - 1) / 2;

        for (let i = 0; i < shotCount; i++) {
            createEnemyBullet(enemy, baseAngle + (i - centerOffset) * spread);
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function createEnemyBullet(enemy, angle) {
        const isGigaBoss = enemy.type === "gigaBoss";
        const isBoss = enemy.type === "boss";
        const isMiniTank = enemy.type === "miniTank";
        const isCarrier = enemy.type === "carrier";
        const speed = isGigaBoss ? 5.8 : isBoss ? 5.2 : isCarrier ? 5.35 : isMiniTank ? 4.9 : 4.6;

        enemyBullets.push({
            x: enemy.x + Math.cos(angle) * (enemy.r + 8),
            y: enemy.y + Math.sin(angle) * (enemy.r + 8),
            r: isGigaBoss ? 11 : isBoss ? 8 : isCarrier ? 7 : isMiniTank ? 7 : 6,
            dx: Math.cos(angle) * speed,
            dy: Math.sin(angle) * speed,
            damage: isGigaBoss ? 28 : isBoss ? 18 : isCarrier ? Math.round(13 * getDifficulty().enemyDamage) : isMiniTank ? 14 : 10,
            color: isGigaBoss ? "#ffffff" : isBoss ? "#ff3535" : isCarrier ? "#62d9ff" : isMiniTank ? "#d58bff" : "#ff79c6",
        });
    }

    /**
     * Returns carrier doctrine values. Missile counts rise sharply because carriers
     * enter after the player has had time to assemble a powerful build.
     */
    function getCarrierDoctrine() {
        const profiles = {
            easy:       { initial: 8,  volley: 6,  activeCap: 16, volleyCooldown: 2550, cannonShots: 1, cannonSpread: 0.00 },
            medium:     { initial: 10, volley: 8,  activeCap: 20, volleyCooldown: 2150, cannonShots: 2, cannonSpread: 0.08 },
            hard:       { initial: 12, volley: 10, activeCap: 26, volleyCooldown: 1750, cannonShots: 3, cannonSpread: 0.10 },
            impossible: { initial: 16, volley: 14, activeCap: 34, volleyCooldown: 1350, cannonShots: 4, cannonSpread: 0.11 },
        };
        const base = profiles[state.difficulty] || profiles.medium;
        const waveBonus = Math.min(8, Math.floor(Math.max(0, state.wave - 14) / 5));
        return {
            ...base,
            initial: base.initial + waveBonus,
            volley: base.volley + Math.floor(waveBonus * 0.75),
            activeCap: base.activeCap + waveBonus,
            volleyCooldown: Math.max(900, base.volleyCooldown - waveBonus * 55),
        };
    }

    /**
     * Runs the carrier's missile factory independently from its cannon.
     * The first salvo is intentionally immediate and large.
     */
    function updateCarrierSystems(enemy, now) {
        const doctrine = getCarrierDoctrine();
        const activeOwned = carrierMissiles.reduce(
            (count, missile) => count + (missile && !missile.dead && missile.owner === enemy ? 1 : 0),
            0
        );

        if (enemy.missileInitialVolleyPending) {
            launchCarrierVolley(enemy, Math.min(doctrine.initial, doctrine.activeCap));
            enemy.missileInitialVolleyPending = false;
            enemy.nextMissileVolleyAt = now + doctrine.volleyCooldown * 0.72;
            return;
        }

        if (now < enemy.nextMissileVolleyAt || activeOwned >= doctrine.activeCap) return;
        const roomForCarrier = doctrine.activeCap - activeOwned;
        const roomGlobal = Math.max(0, PERFORMANCE_LIMITS.maxCarrierMissiles - carrierMissiles.filter(m => m && !m.dead).length);
        const launchCount = Math.min(doctrine.volley, roomForCarrier, roomGlobal);
        if (launchCount > 0) launchCarrierVolley(enemy, launchCount);
        enemy.nextMissileVolleyAt = now + doctrine.volleyCooldown;
    }

    /**
     * Fires the carrier's own plasma cannon. Missile defense does not replace direct pressure.
     */
    function shootCarrierCannon(enemy) {
        const doctrine = getCarrierDoctrine();
        const baseAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        const center = (doctrine.cannonShots - 1) / 2;
        for (let i = 0; i < doctrine.cannonShots; i++) {
            createEnemyBullet(enemy, baseAngle + (i - center) * doctrine.cannonSpread);
        }
    }

    /**
     * Creates one coordinated volley. Exactly half the salvo receives interceptor duty;
     * the remainder orbit before periodically diving at the player.
     */
    function launchCarrierVolley(enemy, count) {
        if (count <= 0) return;
        const interceptorCount = Math.ceil(count * 0.5);
        for (let i = 0; i < count; i++) {
            const role = i < interceptorCount ? "interceptor" : (i % 3 === 0 ? "orbit" : "attacker");
            launchCarrierMissile(enemy, role, i, count);
        }
    }

    /**
     * Creates a missile that launches outward, forms a ring around the player, then performs
     * its assigned job. Interceptors consume bullets without sacrificing themselves.
     */
    function launchCarrierMissile(enemy, role = "attacker", index = 0, volleySize = 1) {
        if (carrierMissiles.filter(m => m && !m.dead).length >= PERFORMANCE_LIMITS.maxCarrierMissiles) return;
        const launchAngle = (TWO_PI * index / Math.max(1, volleySize)) + Math.random() * 0.14;
        const difficultySpeed = state.difficulty === "impossible" ? 0.75 : state.difficulty === "hard" ? 0.4 : 0;
        const orbitRing = index % 2;
        const now = performance.now();
        const health = 24 + state.wave * 2.5;
        carrierMissiles.push({
            owner: enemy,
            role,
            mode: "launch",
            x: enemy.x + Math.cos(launchAngle) * (enemy.r + 14),
            y: enemy.y + Math.sin(launchAngle) * (enemy.r + 14),
            dx: Math.cos(launchAngle) * 3.2,
            dy: Math.sin(launchAngle) * 3.2,
            speed: 3.35 + difficultySpeed,
            turnRate: 0.052 + difficultySpeed * 0.012,
            r: 11,
            health,
            maxHealth: health,
            damage: Math.round((20 + state.wave * 0.72) * getDifficulty().enemyDamage),
            life: 1500,
            launchedAt: now,
            modeUntil: now + 420 + Math.random() * 180,
            orbitAngle: launchAngle,
            orbitDirection: index % 2 === 0 ? 1 : -1,
            orbitRadius: 235 + orbitRing * 82 + Math.random() * 26,
            orbitSpeed: 0.012 + Math.random() * 0.004,
            diveAt: now + (role === "attacker" ? 1200 : role === "orbit" ? 2600 : 999999),
            diveEndsAt: 0,
            retargetAt: 0,
            targetBullet: null,
            interceptCooldownUntil: 0,
        });
    }

    /**
     * Finds a nearby player projectile worth intercepting. Prefer bullets approaching the
     * carrier or player, then fall back to nearest distance.
     */
    function findCarrierInterceptionTarget(missile) {
        let best = null;
        let bestScore = Infinity;
        const owner = missile.owner && !missile.owner.dead ? missile.owner : null;

        for (const bullet of bullets) {
            if (!bullet || bullet.dead) continue;
            const dx = bullet.x - missile.x;
            const dy = bullet.y - missile.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 720) continue;

            // Favor bullets travelling toward the carrier. A negative radial dot
            // means the projectile is closing on the protected ship; bullets
            // already escaping the carrier receive a large penalty so drones do
            // not turn around and appear to flee from the actual threat.
            let closingBonus = 0;
            let ownerDist = dist;
            if (owner) {
                const toOwnerX = owner.x - bullet.x;
                const toOwnerY = owner.y - bullet.y;
                ownerDist = Math.hypot(toOwnerX, toOwnerY);
                const ownerLen = Math.max(1, ownerDist);
                const towardOwner = (bullet.dx * toOwnerX + bullet.dy * toOwnerY) / ownerLen;
                closingBonus = towardOwner > 0 ? -Math.min(220, towardOwner * 42) : 260;
            }

            const score = dist * 0.72 + ownerDist * 0.38 + closingBonus;
            if (score < bestScore) {
                bestScore = score;
                best = bullet;
            }
        }
        return best;
    }

    /**
     * Steers a missile toward a point using bounded angular acceleration.
     */
    function steerCarrierMissile(missile, targetX, targetY, speedMultiplier = 1) {
        const desired = Math.atan2(targetY - missile.y, targetX - missile.x);
        const current = Math.atan2(missile.dy, missile.dx);
        const delta = ((desired - current + Math.PI * 3) % TWO_PI) - Math.PI;
        const next = current + clamp(delta, -missile.turnRate, missile.turnRate);
        missile.dx = Math.cos(next) * missile.speed * speedMultiplier;
        missile.dy = Math.sin(next) * missile.speed * speedMultiplier;
    }

    /**
     * Advances the carrier swarm. Attack missiles orbit before diving; interceptors leave
     * formation only when a player bullet is available, then return to the ring.
     */
    function updateCarrierMissiles(now = performance.now()) {
        for (const missile of carrierMissiles) {
            if (!missile || missile.dead) continue;
            missile.life--;
            if (missile.life <= 0) { missile.dead = true; continue; }

            if (missile.owner && missile.owner.dead) {
                missile.role = "attacker";
                missile.mode = "dive";
                missile.diveEndsAt = now + 1800;
            }

            if (missile.mode === "launch" && now >= missile.modeUntil) missile.mode = "orbit";

            if (missile.role === "interceptor" && now >= missile.interceptCooldownUntil) {
                if (!missile.targetBullet || missile.targetBullet.dead || now >= missile.retargetAt) {
                    missile.targetBullet = findCarrierInterceptionTarget(missile);
                    missile.retargetAt = now + 130;
                }
                if (missile.targetBullet && !missile.targetBullet.dead) missile.mode = "intercept";
                else if (missile.mode === "intercept") missile.mode = "orbit";
            }

            if ((missile.role === "attacker" || missile.role === "orbit") && missile.mode === "orbit" && now >= missile.diveAt) {
                missile.mode = "dive";
                missile.diveEndsAt = now + (missile.role === "attacker" ? 1150 : 850);
            }

            if (missile.mode === "intercept" && missile.targetBullet && !missile.targetBullet.dead) {
                const target = missile.targetBullet;
                const separation = Math.hypot(target.x - missile.x, target.y - missile.y);

                // Use only a short, distance-bounded lead. The old fixed seven-frame
                // prediction could put the aim point behind a fast projectile and make
                // the interceptor visibly peel away. Close threats are chased directly.
                const leadFrames = separation > 260 ? 3.2 : separation > 120 ? 1.6 : 0;
                const originalTurnRate = missile.turnRate;
                missile.turnRate = Math.max(originalTurnRate, separation < 150 ? 0.15 : 0.105);
                steerCarrierMissile(
                    missile,
                    target.x + target.dx * leadFrames,
                    target.y + target.dy * leadFrames,
                    separation < 160 ? 1.58 : 1.38
                );
                missile.turnRate = originalTurnRate;
            } else if (missile.mode === "dive") {
                steerCarrierMissile(missile, player.x, player.y, 1.24);
                if (now >= missile.diveEndsAt) {
                    missile.mode = "orbit";
                    missile.diveAt = now + 1500 + Math.random() * 1300;
                }
            } else if (missile.mode === "launch") {
                // Preserve the radial launch vector briefly for a readable opening burst.
            } else {
                missile.orbitAngle += missile.orbitDirection * missile.orbitSpeed;
                const wobble = Math.sin(now / 310 + missile.orbitAngle * 2.2) * 18;
                const targetRadius = missile.orbitRadius + wobble;
                steerCarrierMissile(
                    missile,
                    player.x + Math.cos(missile.orbitAngle) * targetRadius,
                    player.y + Math.sin(missile.orbitAngle) * targetRadius,
                    0.96
                );
            }

            missile.x += missile.dx;
            missile.y += missile.dy;

            // Interceptor capture is resolved here, immediately after movement, so
            // fast opposing projectiles cannot tunnel through one another between
            // the later broad collision passes. The missile survives and returns to
            // the carrier's defensive ring after physically meeting the bullet.
            if (missile.mode === "intercept" && missile.targetBullet && !missile.targetBullet.dead) {
                const target = missile.targetBullet;
                const captureRadius = missile.r + (target.r || 3) + 7;
                if (Math.hypot(target.x - missile.x, target.y - missile.y) <= captureRadius) {
                    target.dead = true;
                    missile.targetBullet = null;
                    missile.mode = "orbit";
                    missile.interceptCooldownUntil = now + 180;
                    missile.diveAt = 999999999;
                    explosions.push({ x: missile.x, y: missile.y, radius: 18, life: 7, maxLife: 7, harmless: true });
                }
            }

            if (distance(missile, player) < missile.r + player.r) {
                missile.dead = true;
                damagePlayer(missile.damage);
                explosions.push({ x: missile.x, y: missile.y, radius: 46, life: 14, maxLife: 14 });
            } else if (isOutsideWorld(missile, 160)) {
                missile.dead = true;
            }
        }
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkPlayerBulletsVsCarrierMissiles() {
        for (const bullet of bullets) {
            if (!bullet || bullet.dead) continue;
            for (const missile of carrierMissiles) {
                if (!missile || missile.dead) continue;
                if (distance(bullet, missile) >= bullet.r + missile.r) continue;
                bullet.dead = true;

                // Interceptors are defensive drones: they erase the projectile and return
                // to orbit instead of taking conventional collision damage.
                if (missile.role === "interceptor" && missile.mode === "intercept") {
                    missile.targetBullet = null;
                    missile.mode = "orbit";
                    missile.interceptCooldownUntil = performance.now() + 260;
                    missile.diveAt = 999999999;
                    explosions.push({ x: bullet.x, y: bullet.y, radius: 18, life: 7, maxLife: 7, harmless: true });
                    break;
                }

                missile.health -= bullet.damage;
                addDamageNumber(missile.x, missile.y, bullet.damage, "#b8f6ff");
                if (missile.health <= 0) {
                    missile.dead = true;
                    explosions.push({ x: missile.x, y: missile.y, radius: 42, life: 14, maxLife: 14 });
                    playSound("explosion");
                }
                break;
            }
        }
    }

    /**
     * Applies damage through the shared combat rules. Route new damage sources here to preserve effects and death handling.
     */
    function damagePlayerOnTouch(enemy, now) {
        if (distance(player, enemy) >= player.r + enemy.r) return;
        if (enemy.lastHitAt && now - enemy.lastHitAt <= 700) return;

        enemy.lastHitAt = now;
        damagePlayer(enemy.damage);

        if (enemy.type === "runner") {
            burstRunnerIntoBullets(enemy);
            enemy.dead = true;
        }
    }

    /**
     * Applies damage through the shared combat rules. Route new damage sources here to preserve effects and death handling.
     */
    function damageEnemy(index, amount, source = "bullet") {
        const enemy = enemies[index];
        if (!enemy) return false;

        enemy.health -= amount;
        addDamageNumber(enemy.x, enemy.y - enemy.r, amount);
        playSound("hit");

        if (enemy.health > 0) return false;

        spawnDeathParticles(enemy);
        explosions.push({
            x: enemy.x,
            y: enemy.y,
            radius: Math.max(28, enemy.r * 1.65),
            life: enemy.type === "gigaBoss" ? 20 : enemy.type === "boss" ? 17 : 13,
            maxLife: enemy.type === "gigaBoss" ? 20 : enemy.type === "boss" ? 17 : 13,
            harmless: true,
        });
        playSound("explosion");
        if (enemy.type === "boss" || enemy.type === "gigaBoss" || enemy.type === "miniTank") addScreenShake(enemy.type === "gigaBoss" ? 28 : enemy.type === "boss" ? 20 : 13);
        dropPointOrbs(enemy);
        spawnLifeStealOrbs(enemy, source);
        spawnPickupDrops(enemy.x, enemy.y, enemy.type);
        enemy.dead = true;
        return true;
    }

    /**
     * Handles the burstRunnerIntoBullets operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function burstRunnerIntoBullets(enemy) {
        const shotCount = 12;
        const speed = 5.2 + Math.min(3, state.wave * 0.08);

        explosions.push({ x: enemy.x, y: enemy.y, radius: 58, life: 12, maxLife: 12 });
        spawnDeathParticles(enemy, 14);
        addScreenShake(8);
        playSound("explosion");

        for (let i = 0; i < shotCount; i++) {
            const angle = (TWO_PI / shotCount) * i + randomRange(-0.08, 0.08);
            enemyBullets.push({
                x: enemy.x + Math.cos(angle) * (enemy.r + 8),
                y: enemy.y + Math.sin(angle) * (enemy.r + 8),
                r: 6,
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                damage: 8 + Math.floor(state.wave * 0.25),
                color: "#ff79c6",
            });
        }
    }

    /**
     * Applies damage through the shared combat rules. Route new damage sources here to preserve effects and death handling.
     */
    function damagePlayer(amount) {
        const reducedAmount = Math.max(1, amount * (1 - player.damageReduction));
        if (player.shield > 0) {
            const absorbed = Math.min(player.shield, reducedAmount);
            player.shield -= absorbed;
            amount = reducedAmount - absorbed;
        } else {
            amount = reducedAmount;
        }
        if (amount <= 0) return;
        player.health -= amount;
        player.lastDamageAt = performance.now();
        player.regenAccumulator = 0;
        state.damageFlash = 1;
        playSound("playerHit");

        if (player.health <= 0) {
            gameOver();
        }
    }

    // -------------------------------------------------------------------------
    // Bullets, collisions, and explosions
    // -------------------------------------------------------------------------
    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateBullets() {
        updateProjectileList(bullets, 40);
        updateMissiles();
        updateProjectileList(enemyBullets, 60);
        updateCarrierMissiles();
        checkEnemyBulletHits();
        checkPlayerBulletsVsCarrierMissiles();
        checkPlayerBulletHits();
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateProjectileList(projectiles, despawnMargin) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const projectile = projectiles[i];
            if (!projectile || projectile.dead) continue;

            projectile.x += projectile.dx;
            projectile.y += projectile.dy;

            if (isOutsideWorld(projectile, despawnMargin)) {
                projectile.dead = true;
            }
        }
    }

    /**
     * Returns a boolean predicate and should not mutate state.
     */
    function isOutsideWorld(pos, margin) {
        return pos.x < -margin ||
            pos.x > WORLD.width + margin ||
            pos.y < -margin ||
            pos.y > WORLD.height + margin;
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkEnemyBulletHits() {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const bullet = enemyBullets[i];
            if (!bullet || bullet.dead) continue;
            let interceptedByDrone = false;
            for (const drone of relicDrones) {
                if (drone.dead || distance(drone, bullet) >= 10 + bullet.r) continue;
                drone.health -= bullet.damage;
                bullet.dead = true;
                if (drone.health <= 0) drone.dead = true;
                interceptedByDrone = true;
                break;
            }
            if (interceptedByDrone) continue;
            if (distance(player, bullet) >= player.r + bullet.r) continue;

            bullet.dead = true;
            damagePlayer(bullet.damage);
        }
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkPlayerBulletHits() {
        for (let bulletIndex = bullets.length - 1; bulletIndex >= 0; bulletIndex--) {
            const bullet = bullets[bulletIndex];
            if (!bullet || bullet.dead) continue;

            for (let enemyIndex = enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
                const enemy = enemies[enemyIndex];
                if (!enemy || enemy.dead) continue;
                if (distance(bullet, enemy) >= bullet.r + enemy.r) continue;

                bullet.dead = true;
                damageEnemy(enemyIndex, bullet.damage, "bullet");

                if (bullet.explosive) {
                    explodeAt(bullet.x, bullet.y, bullet.explosionRadius, bullet.explosionDamage, enemy);
                }

                break;
            }
        }
    }

    /**
     * Handles the explodeAt operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function explodeAt(x, y, radius, damage, directlyHitEnemy) {
        if (radius <= 0) return;

        explosions.push({ x, y, radius, life: 14, maxLife: 14 });
        // Explosive rounds intentionally do not shake the screen and do not use
        // the full enemy-death explosion SFX. The compact plasma impact scales with
        // weapon level and remains stable when many splash hits occur at once.
        playSound("explosiveImpact");

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (!enemy || enemy.dead || enemy === directlyHitEnemy) continue;
            const dist = Math.hypot(enemy.x - x, enemy.y - y);
            if (dist >= radius + enemy.r) continue;

            const falloff = 1 - Math.min(1, dist / radius);
            const finalDamage = Math.max(1, Math.floor(damage * (0.45 + falloff * 0.55)));
            damageEnemy(i, finalDamage, "explosion");
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateExplosions() {
        for (let i = explosions.length - 1; i >= 0; i--) {
            explosions[i].life--;
            if (explosions[i].life <= 0) explosions.splice(i, 1);
        }
    }


    // -------------------------------------------------------------------------
    // Health regen and life steal
    // -------------------------------------------------------------------------
    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateHealthRegen(now) {
        if (player.regenLevel <= 0 || player.regenPerSecond <= 0) return;
        if (player.health <= 0 || player.health >= player.maxHealth) return;

        if (now - player.lastDamageAt < player.regenDelayAfterDamage) {
            player.lastRegenTickAt = now;
            return;
        }

        if (!player.lastRegenTickAt) {
            player.lastRegenTickAt = now;
            return;
        }

        const elapsed = now - player.lastRegenTickAt;
        if (elapsed < 250) return;

        player.lastRegenTickAt = now;
        player.regenAccumulator += player.regenPerSecond * (elapsed / 1000);

        const wholeHeal = Math.floor(player.regenAccumulator);
        if (wholeHeal <= 0) return;

        player.regenAccumulator -= wholeHeal;
        const previousHealth = player.health;
        player.health = Math.min(player.maxHealth, player.health + wholeHeal);
        const healed = Math.max(0, Math.floor(player.health - previousHealth));

        if (healed > 0) {
            player.regenGlowUntil = now + 420;
            addDamageNumber(player.x, player.y - 42, `+${healed}`, "#7cff9b");
            particles.push({
                x: player.x,
                y: player.y,
                dx: randomRange(-0.22, 0.22),
                dy: randomRange(-1.1, -0.45),
                r: randomRange(1.8, 3.7),
                color: "#7cff9b",
                life: 26,
                maxLife: 26,
            });
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnLifeStealOrbs(enemy, source = "bullet") {
        if (player.lifeStealLevel <= 0 || player.lifeStealAmount <= 0) return;

        const orbCount = clamp(
            Math.ceil(enemy.r / 18) + Math.floor(player.lifeStealLevel / 2),
            1,
            enemy.type === "gigaBoss" ? 12 : enemy.type === "boss" ? 8 : 5
        );
        const enemyMultiplier = enemy.type === "gigaBoss" ? 2.2 : enemy.type === "boss" ? 1.55 : enemy.type === "miniTank" ? 1.25 : 1;
        const sourceMultiplier = source === "aura" ? 0.35 : source === "missile" ? 0.5 : source === "explosion" ? 0.4 : 1;
        const totalHeal = Math.max(1, Math.floor(player.lifeStealAmount * enemyMultiplier * sourceMultiplier));

        for (let i = 0; i < orbCount; i++) {
            const angle = Math.random() * TWO_PI;
            const value = i === orbCount - 1
                ? Math.max(1, totalHeal - Math.floor(totalHeal / orbCount) * (orbCount - 1))
                : Math.max(1, Math.floor(totalHeal / orbCount));

            lifeStealOrbs.push({
                x: enemy.x + Math.cos(angle) * randomRange(0, enemy.r + 10),
                y: enemy.y + Math.sin(angle) * randomRange(0, enemy.r + 10),
                r: enemy.type === "boss" || enemy.type === "gigaBoss" ? 7 : 5,
                value,
                life: 150,
                dx: Math.cos(angle) * randomRange(0.8, 2.6),
                dy: Math.sin(angle) * randomRange(0.8, 2.6),
            });
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateLifeStealOrbs(now) {
        for (const orb of lifeStealOrbs) {
            if (!orb || orb.dead) continue;
            orb.life--;
            if (orb.life <= 0) {
                orb.dead = true;
                continue;
            }

            orb.x += orb.dx;
            orb.y += orb.dy;
            orb.dx *= 0.90;
            orb.dy *= 0.90;

            const distToPlayer = distance(player, orb);
            const pullRadius = 580 + player.lifeStealLevel * 28;
            if (distToPlayer < pullRadius) {
                const pull = 0.065 + (1 - distToPlayer / pullRadius) * 0.22;
                orb.x += (player.x - orb.x) * pull;
                orb.y += (player.y - orb.y) * pull;
                orb.magnetized = true;
            }

            if (distance(player, orb) < player.r + orb.r + 3) {
                const previousHealth = player.health;
                player.health = Math.min(player.maxHealth, player.health + orb.value);
                const healed = Math.max(0, Math.floor(player.health - previousHealth));
                if (healed > 0) {
                    addDamageNumber(player.x, player.y - 38, `+${healed}`, "#7cff9b");
                    player.regenGlowUntil = now + 420;
                }
                orb.dead = true;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Point orbs
    // -------------------------------------------------------------------------
    /**
     * Handles the dropPointOrbs operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function dropPointOrbs(enemy) {
        let remainingValue = enemy.reward;
        const orbCount = clamp(Math.ceil(enemy.reward / 35), 1, enemy.type === "gigaBoss" ? 28 : enemy.type === "boss" ? 16 : 6);

        for (let i = 0; i < orbCount; i++) {
            const orbsLeft = orbCount - i;
            const value = i === orbCount - 1 ? remainingValue : Math.max(1, Math.floor(remainingValue / orbsLeft));
            remainingValue -= value;

            const angle = Math.random() * TWO_PI;
            const distanceFromEnemy = randomRange(8, enemy.r + 34);

            pointOrbs.push({
                x: enemy.x + Math.cos(angle) * distanceFromEnemy,
                y: enemy.y + Math.sin(angle) * distanceFromEnemy,
                r: enemy.type === "boss" || enemy.type === "gigaBoss" ? 7 : 5,
                value,
                life: 1800,
                dx: Math.cos(angle) * randomRange(0.5, 2.1),
                dy: Math.sin(angle) * randomRange(0.5, 2.1),
            });
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePointOrbs(now) {
        for (const orb of pointOrbs) {
            if (!orb || orb.dead) continue;

            orb.life--;
            if (orb.life <= 0) {
                orb.dead = true;
                continue;
            }

            orb.x += orb.dx;
            orb.y += orb.dy;
            orb.dx *= 0.94;
            orb.dy *= 0.94;

            orb.x = clamp(orb.x, orb.r, WORLD.width - orb.r);
            orb.y = clamp(orb.y, orb.r, WORLD.height - orb.r);

            const distToPlayer = distance(player, orb);
            const clearBoost = state.clearPhaseActive ? 1.9 : 1;
            const magnetRadius = player.pointMagnetRadius * clearBoost;
            const magnetStrength = player.pointMagnetStrength * (state.clearPhaseActive ? 1.85 : 1);
            orb.magnetized = distToPlayer < magnetRadius;
            if (orb.magnetized) {
                const pull = (1 - distToPlayer / magnetRadius) * magnetStrength;
                orb.x += (player.x - orb.x) * pull;
                orb.y += (player.y - orb.y) * pull;
                orb.trailLife = 8;
            }

            if (distToPlayer < player.r + orb.r) {
                collectPointOrb(orb);
            }
        }
    }

    /**
     * Handles the collectPointOrb operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function collectPointOrb(orb) {
        state.score += orb.value;
        state.upgradePoints += orb.value;
        addDamageNumber(player.x, player.y - 28, `+${orb.value}`, "#ffe066");
        orb.dead = true;
        playSound("pickup");
    }

    // -------------------------------------------------------------------------
    // Pickups
    // -------------------------------------------------------------------------
    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnPickupDrops(x, y, enemyType) {
        const dropRates = getDropRates(enemyType);

        maybeDropPickup("health", x, y, dropRates.health, enemyType);
        maybeDropPickup("speed", x, y, dropRates.speed, enemyType, 34);
        maybeDropPickup("harm", x, y, dropRates.harm, enemyType, 46);
        maybeDropPickup("slow", x, y, dropRates.slow, enemyType, 46);
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getDropRates(enemyType) {
        const isWaveFiveOrLater = state.wave >= 5;
        const healthMultiplier = isWaveFiveOrLater ? 0.35 : 1;
        const rates = { health: 0.09 * healthMultiplier, speed: 0.055, harm: 0.045, slow: 0.035 };

        if (enemyType === "gigaBoss") return { health: 0.7, speed: 1, harm: 0.5, slow: 0.5 };
        if (enemyType === "boss") return { health: 0.65, speed: 1, harm: 0.25, slow: 0.25 };

        if (enemyType === "tank" || enemyType === "miniTank" || enemyType === "brute") {
            rates.health += 0.07 * healthMultiplier;
            rates.speed += 0.035;
            rates.harm += 0.03;
            rates.slow += 0.025;
        }

        if (enemyType === "dodger") {
            rates.speed += 0.06;
            rates.slow += 0.055;
        }

        return rates;
    }

    /**
     * Handles the maybeDropPickup operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function maybeDropPickup(type, x, y, probability, enemyType, spread = 0) {
        if (!chance(probability)) return;

        const offset = spread / 2;
        pickups.push({
            type,
            x: x + randomRange(-offset, offset),
            y: y + randomRange(-offset, offset),
            r: 12,
            life: type === "health" || type === "speed" ? 900 : 720,
            ...getPickupStats(type, enemyType),
        });
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getPickupStats(type, enemyType) {
        const isBoss = enemyType === "boss";
        const isGigaBoss = enemyType === "gigaBoss";

        const stats = {
            health: { amount: isGigaBoss ? 90 : isBoss ? 55 : 22 },
            speed: { duration: isGigaBoss ? 12000 : isBoss ? 9000 : 5500 },
            harm: { amount: isGigaBoss ? 45 : isBoss ? 30 : 14 },
            slow: {
                duration: isGigaBoss ? 9000 : isBoss ? 7000 : 4200,
                multiplier: 0.55,
            },
        };

        return stats[type];
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePickups(now) {
        for (let i = pickups.length - 1; i >= 0; i--) {
            const pickup = pickups[i];
            if (!pickup || pickup.dead) continue;

            pickup.life--;

            if (pickup.life <= 0) {
                pickup.dead = true;
                continue;
            }

            updatePickupMagnet(pickup);

            if (distance(player, pickup) >= player.r + pickup.r) continue;

            applyPickup(pickup, now);
            pickup.dead = true;
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePickupMagnet(pickup) {
        const canMagnetize = pickup.type === "health" || pickup.type === "speed";
        pickup.magnetized = false;
        if (!canMagnetize || player.pointMagnetRadius <= 0) return;

        const clearBoost = state.clearPhaseActive ? 1.9 : 1;
        const magnetRadius = player.pointMagnetRadius * 0.5 * clearBoost;
        const distToPlayer = distance(player, pickup);
        if (distToPlayer >= magnetRadius) return;

        const magnetStrength = player.pointMagnetStrength * (state.clearPhaseActive ? 1.65 : 1);
        const pull = (1 - distToPlayer / magnetRadius) * magnetStrength;
        pickup.x += (player.x - pickup.x) * pull;
        pickup.y += (player.y - pickup.y) * pull;
        pickup.magnetized = true;
    }

    /**
     * Handles the applyPickup operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function applyPickup(pickup, now) {
        const pickupActions = {
            health: () => {
                const previousHealth = player.health;
                player.health = Math.min(player.maxHealth, player.health + pickup.amount);
                const healed = Math.max(0, Math.floor(player.health - previousHealth));
                const excess = Math.max(0, previousHealth + pickup.amount - player.maxHealth);
                if (player.maxShield > 0 && excess > 0) player.shield = Math.min(player.maxShield, player.shield + excess);
                if (player.adaptiveHull) player.speedBoostUntil = Math.max(player.speedBoostUntil, now + 1800);
                player.healthFlashUntil = now + 850;
                addDamageNumber(player.x, player.y - 32, `+${healed || pickup.amount}`, "#36ff7a");
                spawnPickupBurst(pickup.x, pickup.y, "#36ff7a", 10, false);
                playSound("healthPickup");
            },
            speed: () => {
                player.speedBoostUntil = Math.max(player.speedBoostUntil, now + pickup.duration * player.boostDurationMultiplier);
                spawnPickupBurst(pickup.x, pickup.y, "#63d7ff", 8, false);
                playSound("speedPickup");
            },
            harm: () => {
                playSound("harmPickup");
                spawnPickupBurst(pickup.x, pickup.y, "#ff3030", 18, true);
                player.damageFlashUntil = now + 900;
                damagePlayer(pickup.amount);
                addDamageNumber(player.x, player.y - 32, `-${pickup.amount}`, "#ff3030");
            },
            slow: () => {
                player.slowUntil = Math.max(player.slowUntil, now + pickup.duration);
                player.slowMultiplier = 1 - (1 - pickup.multiplier) * player.slowResistance;
                spawnPickupBurst(pickup.x, pickup.y, "#b36bff", 10, false);
                playSound("slowPickup");
            },
        };

        pickupActions[pickup.type]?.();
    }


    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnPickupBurst(x, y, color, count = 10, explosive = false) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * TWO_PI;
            const speed = randomRange(explosive ? 1.8 : 0.8, explosive ? 5.2 : 2.8);
            particles.push({
                x, y,
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                r: randomRange(2, explosive ? 5.5 : 4),
                color,
                life: Math.floor(randomRange(18, explosive ? 34 : 26)),
                maxLife: explosive ? 34 : 26,
            });
        }
        if (explosive) {
            explosions.push({ x, y, radius: 42, life: 12, maxLife: 12, harmless: true });
        }
    }

    // -------------------------------------------------------------------------
    // Polish effects: particles, damage numbers, screen shake
    // -------------------------------------------------------------------------
    /**
     * Handles the addScreenShake operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function addScreenShake(amount) {
        state.screenShake = Math.max(state.screenShake, amount);
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePolishEffects() {
        state.screenShake *= state.screenShakeDecay;
        if (state.screenShake < 0.08) state.screenShake = 0;

        for (const particle of particles) {
            if (!particle || particle.dead) continue;
            particle.life--;
            if (particle.life <= 0) {
                particle.dead = true;
                continue;
            }
            particle.x += particle.dx;
            particle.y += particle.dy;
            particle.dx *= 0.94;
            particle.dy *= 0.94;
            particle.r *= 0.985;
        }

        for (const number of damageNumbers) {
            if (!number || number.dead) continue;
            number.life--;
            if (number.life <= 0) {
                number.dead = true;
                continue;
            }
            number.x += number.dx;
            number.y += number.dy;
            number.dy -= 0.006;
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnDeathParticles(enemy, forcedCount = null) {
        const count = forcedCount ?? (enemy.type === "gigaBoss" ? 34 : enemy.type === "boss" ? 24 : enemy.type === "miniTank" ? 18 : 8);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * TWO_PI;
            const speed = randomRange(0.8, enemy.type === "gigaBoss" || enemy.type === "boss" ? 4.8 : 3.1);
            particles.push({
                x: enemy.x + Math.cos(angle) * randomRange(0, enemy.r),
                y: enemy.y + Math.sin(angle) * randomRange(0, enemy.r),
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                r: randomRange(2.2, enemy.type === "gigaBoss" ? 7 : 4.8),
                color: enemy.color,
                life: Math.floor(randomRange(22, 46)),
                maxLife: 46,
            });
        }
    }

    /**
     * Handles the addDamageNumber operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function addDamageNumber(x, y, value, color = "#ffffff") {
        damageNumbers.push({
            x: x + randomRange(-8, 8),
            y: y + randomRange(-6, 4),
            dx: randomRange(-0.35, 0.35),
            dy: randomRange(-1.35, -0.75),
            text: String(value),
            color,
            life: 42,
            maxLife: 42,
        });
    }

    // -------------------------------------------------------------------------
    // Background generation
    // -------------------------------------------------------------------------
    /**
     * Handles the generateBackgroundDetails operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function generateBackgroundDetails() {
        backgroundPanels.length = 0;
        backgroundStars.length = 0;

        for (let i = 0; i < 95; i++) {
            backgroundPanels.push({
                x: Math.random() * WORLD.width,
                y: Math.random() * WORLD.height,
                w: randomRange(90, 320),
                h: randomRange(50, 200),
                glow: Math.random(),
            });
        }

        for (let i = 0; i < 360; i++) {
            backgroundStars.push({
                x: Math.random() * WORLD.width,
                y: Math.random() * WORLD.height,
                r: randomRange(0.6, 2.4),
                alpha: randomRange(0.15, 0.6),
            });
        }
    }

    // -------------------------------------------------------------------------
    // Drawing helpers
    // -------------------------------------------------------------------------
    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCircle(context, x, y, radius, fillStyle) {
        context.fillStyle = fillStyle;
        context.beginPath();
        context.arc(x, y, radius, 0, TWO_PI);
        context.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawSciFiBackground() {
        // drawGame() applies CAMERA_ZOOM before this function. Therefore every
        // screen-filling background primitive must use logical visible-world
        // dimensions, not raw canvas pixels. Using canvas.width here would fill
        // only CAMERA_ZOOM of the physical screen and produce a lighter block in
        // the top-left on mobile.
        const viewWidth = getVisibleWorldWidth();
        const viewHeight = getVisibleWorldHeight();
        const gradient = ctx.createRadialGradient(
            viewWidth / 2,
            viewHeight / 2,
            80,
            viewWidth / 2,
            viewHeight / 2,
            Math.max(viewWidth, viewHeight) * 0.75
        );

        gradient.addColorStop(0, "#151e34");
        gradient.addColorStop(0.55, "#0d1220");
        gradient.addColorStop(1, "#080a10");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, viewWidth, viewHeight);

        drawBackgroundStars();
        drawBackgroundGrid();
        drawBackgroundPanels();
        drawWorldBounds();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBackgroundStars() {
        for (const star of backgroundStars) {
            if (!isInView(star, 10)) continue;
            const screen = worldToScreen(star);
            drawCircle(ctx, screen.x, screen.y, star.r, `rgba(130, 210, 255, ${star.alpha})`);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBackgroundGrid() {
        const gridSize = 120;
        const startX = Math.floor(camera.x / gridSize) * gridSize;
        const startY = Math.floor(camera.y / gridSize) * gridSize;

        ctx.strokeStyle = "rgba(80, 170, 255, 0.12)";
        ctx.lineWidth = 1;

        for (let x = startX; x <= camera.x + getVisibleWorldWidth() + gridSize; x += gridSize) {
            const sx = x - camera.x;
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, getVisibleWorldHeight());
            ctx.stroke();
        }

        for (let y = startY; y <= camera.y + getVisibleWorldHeight() + gridSize; y += gridSize) {
            const sy = y - camera.y;
            ctx.beginPath();
            ctx.moveTo(0, sy);
            ctx.lineTo(getVisibleWorldWidth(), sy);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBackgroundPanels() {
        for (const panel of backgroundPanels) {
            const screen = worldToScreen(panel);
            if (screen.x + panel.w < -50 || screen.x > getVisibleWorldWidth() + 50 || screen.y + panel.h < -50 || screen.y > getVisibleWorldHeight() + 50) continue;

            ctx.fillStyle = `rgba(30, 70, 110, ${0.12 + panel.glow * 0.08})`;
            ctx.fillRect(screen.x, screen.y, panel.w, panel.h);

            ctx.strokeStyle = `rgba(90, 200, 255, ${0.14 + panel.glow * 0.16})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(screen.x, screen.y, panel.w, panel.h);

            ctx.strokeStyle = `rgba(120, 255, 230, ${0.1 + panel.glow * 0.1})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(screen.x + 12, screen.y + panel.h * 0.5);
            ctx.lineTo(screen.x + panel.w - 12, screen.y + panel.h * 0.5);
            ctx.moveTo(screen.x + panel.w * 0.5, screen.y + 12);
            ctx.lineTo(screen.x + panel.w * 0.5, screen.y + panel.h - 12);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawWorldBounds() {
        const screen = worldToScreen({ x: 0, y: 0 });

        ctx.strokeStyle = "rgba(255, 90, 90, 0.6)";
        ctx.lineWidth = 6;
        ctx.strokeRect(screen.x, screen.y, WORLD.width, WORLD.height);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(screen.x + 8, screen.y + 8, WORLD.width - 16, WORLD.height - 16);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawShipShadow(radius) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
        ctx.beginPath();
        ctx.ellipse(-2, 5, radius * 1.15, radius * 0.62, 0, 0, TWO_PI);
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEngineFlame(x, y, size, color = "rgba(99, 215, 255, 0.75)") {
        const flicker = 0.8 + Math.sin(Date.now() / 75 + x * 2) * 0.22;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - size * flicker, y - size * 0.36);
        ctx.lineTo(x - size * 1.45 * flicker, y);
        ctx.lineTo(x - size * flicker, y + size * 0.36);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawThrusterPair(radius, color) {
        drawEngineFlame(-radius * 0.82, -radius * 0.36, radius * 0.55, color);
        drawEngineFlame(-radius * 0.82, radius * 0.36, radius * 0.55, color);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    /**
     * Draws permanent visual hardware earned through Ship Reconstruction.
     *
     * IMPORTANT:
     * - These decorations are presentation-only and never change collision size.
     * - Investment is clamped for visual readability so extreme endless builds
     *   do not grow beyond the player sprite.
     * - Relic stages add a small extra flourish after awakening.
     */
    function drawShipResearchHardware(radius, now) {
        const green = Math.min(12, getSystemInvestment("green"));
        const red = Math.min(12, getSystemInvestment("red"));
        const blue = Math.min(12, getSystemInvestment("blue"));
        const purple = Math.min(12, getSystemInvestment("purple"));

        // Weapon AI: a forward cannon that gains length, width, rails, and a hot core.
        if (red > 0) {
            const length = radius * (0.5 + red * 0.075);
            const width = 2.6 + red * 0.24;
            ctx.save();
            ctx.strokeStyle = "rgba(255,122,102,0.96)";
            ctx.fillStyle = "rgba(76,24,28,0.95)";
            ctx.lineWidth = 1.2;
            ctx.fillRect(radius * 0.42, -width / 2, length, width);
            ctx.strokeRect(radius * 0.42, -width / 2, length, width);
            if (red >= 3) {
                ctx.fillStyle = "rgba(255,210,180,0.9)";
                ctx.fillRect(radius * 0.62, -width * 0.18, length * 0.72, width * 0.36);
            }
            if (red >= 6) {
                ctx.strokeStyle = "rgba(255,105,82,0.9)";
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(radius * 0.48, -width * 0.8);
                ctx.lineTo(radius * 0.48 + length * 0.92, -width * 0.8);
                ctx.moveTo(radius * 0.48, width * 0.8);
                ctx.lineTo(radius * 0.48 + length * 0.92, width * 0.8);
                ctx.stroke();
            }
            if (red >= 9) {
                const pulse = 0.55 + Math.sin(now / 90) * 0.25;
                ctx.fillStyle = `rgba(255,238,215,${pulse})`;
                ctx.beginPath();
                ctx.arc(radius * 0.48 + length, 0, 2.5 + red * 0.08, 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }

        // Nanobots: layered green armor plates and repair nodes around the hull.
        if (green > 0) {
            const plateScale = 0.72 + green * 0.022;
            ctx.save();
            ctx.strokeStyle = `rgba(92,255,148,${0.38 + green * 0.025})`;
            ctx.lineWidth = 1.5 + green * 0.08;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(-radius * 0.55, side * radius * 0.34);
                ctx.lineTo(-radius * 0.9 * plateScale, side * radius * 0.82);
                ctx.lineTo(radius * 0.02, side * radius * 0.58);
                ctx.stroke();
            }
            const nodeCount = Math.min(4, 1 + Math.floor(green / 3));
            ctx.fillStyle = "rgba(89,255,150,0.92)";
            for (let i = 0; i < nodeCount; i++) {
                const y = (i - (nodeCount - 1) / 2) * radius * 0.34;
                ctx.beginPath();
                ctx.arc(-radius * 0.28, y, 1.8 + green * 0.05, 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }

        // Anti-gravity: larger stabilizer fins and brighter secondary thrusters.
        if (blue > 0) {
            const fin = radius * (0.34 + blue * 0.025);
            ctx.save();
            ctx.fillStyle = "rgba(72,174,230,0.5)";
            ctx.strokeStyle = "rgba(104,222,255,0.9)";
            ctx.lineWidth = 1.2;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(-radius * 0.34, side * radius * 0.54);
                ctx.lineTo(-radius * 0.88, side * (radius * 0.54 + fin));
                ctx.lineTo(radius * 0.06, side * radius * 0.68);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            if (blue >= 3) {
                const glow = 0.45 + Math.sin(now / 110) * 0.18;
                ctx.fillStyle = `rgba(105,226,255,${glow})`;
                ctx.beginPath();
                ctx.arc(-radius * 0.9, -radius * 0.35, 2 + blue * 0.12, 0, TWO_PI);
                ctx.arc(-radius * 0.9, radius * 0.35, 2 + blue * 0.12, 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }

        // Quantum: floating processor nodes orbit just outside the hull.
        if (purple > 0) {
            const count = Math.min(4, 1 + Math.floor(purple / 3));
            const orbit = radius * (1.16 + purple * 0.012);
            ctx.save();
            for (let i = 0; i < count; i++) {
                const a = now / (720 - purple * 18) + i * TWO_PI / count;
                const x = Math.cos(a) * orbit;
                const y = Math.sin(a) * orbit * 0.68;
                ctx.fillStyle = "rgba(196,123,255,0.9)";
                ctx.strokeStyle = "rgba(244,220,255,0.95)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x, y, 2.5 + purple * 0.07, 0, TWO_PI);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function drawPlayerShip(angle, screen) {
        const radius = player.r;
        const moving = keysHeld.w || keysHeld.a || keysHeld.s || keysHeld.d || keysHeld.arrowup || keysHeld.arrowleft || keysHeld.arrowdown || keysHeld.arrowright || Math.hypot(analogInput.moveX, analogInput.moveY) > 0.08;
        const flameColor = moving ? "rgba(99, 215, 255, 0.96)" : "rgba(99, 215, 255, 0.58)";

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(angle);
        drawShipShadow(radius);
        drawThrusterPair(radius, flameColor);

        const now = Date.now();
        const speedActive = now < player.speedBoostUntil;
        const slowActive = now < player.slowUntil;
        const healthFlash = now < player.healthFlashUntil;
        const damageFlash = now < player.damageFlashUntil;
        const pulse = 0.5 + 0.5 * Math.sin(now / 85);

        let hullColor = "#6aa9ff";
        if (speedActive) hullColor = "#27bfff";
        if (healthFlash) hullColor = "#36ff7a";
        if (damageFlash) hullColor = "#ff3d3d";

        if (slowActive) {
            ctx.shadowColor = "#b36bff";
            ctx.shadowBlur = 18 + pulse * 12;
            ctx.strokeStyle = `rgba(179,107,255,${0.55 + pulse * 0.35})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.55, 0, TWO_PI);
            ctx.stroke();
        }

        if (speedActive) {
            ctx.shadowColor = "#63d7ff";
            ctx.shadowBlur = 20 + pulse * 16;
        } else if (healthFlash) {
            ctx.shadowColor = "#36ff7a";
            ctx.shadowBlur = 24 + pulse * 12;
        } else if (damageFlash) {
            ctx.shadowColor = "#ff3030";
            ctx.shadowBlur = 24 + pulse * 14;
        }

        ctx.fillStyle = hullColor;
        ctx.strokeStyle = "rgba(220, 245, 255, 0.88)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.55, 0);
        ctx.lineTo(radius * 0.22, -radius * 0.68);
        ctx.lineTo(-radius * 0.92, -radius * 1.02);
        ctx.lineTo(-radius * 0.52, -radius * 0.28);
        ctx.lineTo(-radius * 1.16, 0);
        ctx.lineTo(-radius * 0.52, radius * 0.28);
        ctx.lineTo(-radius * 0.92, radius * 1.02);
        ctx.lineTo(radius * 0.22, radius * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "rgba(215, 246, 255, 0.96)";
        ctx.beginPath();
        ctx.ellipse(radius * 0.42, 0, radius * 0.38, radius * 0.24, 0, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = "rgba(10, 32, 58, 0.42)";
        ctx.fillRect(-radius * 0.26, -radius * 0.12, radius * 0.85, radius * 0.24);

        // Draw progression hardware after the base hull so every branch remains
        // visible. This is intentionally cosmetic only.
        drawShipResearchHardware(radius, now);
        ctx.restore();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPlayerWorldHealthBar(screen) {
        if (!PLATFORM_PROFILE.isMobilePerformance) return;

        const width = player.r * 3.2;
        const height = 5;
        const x = screen.x - width / 2;
        const y = screen.y - player.r * 1.75;
        const ratio = clamp(player.health / Math.max(1, player.maxHealth), 0, 1);

        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
        ctx.fillStyle = ratio > 0.55 ? "#4cff83" : ratio > 0.25 ? "#ffd85c" : "#ff4f5e";
        ctx.fillRect(x, y, width * ratio, height);
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    }

    function drawPlayer() {
        const target = screenToWorld(mouse);
        const angle = Math.atan2(target.y - player.y, target.x - player.x);
        const screen = worldToScreen(player);
        drawPlayerShip(angle, screen);
        drawPlayerWorldHealthBar(screen);
    }


    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawRoundedRectPath(context, x, y, width, height, radius) {
        const safeRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.lineTo(x + width - safeRadius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
        context.lineTo(x + width, y + height - safeRadius);
        context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
        context.lineTo(x + safeRadius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
        context.lineTo(x, y + safeRadius);
        context.quadraticCurveTo(x, y, x + safeRadius, y);
        context.closePath();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPlayerBullets() {
        for (const bullet of bullets) {
            if (!isInView(bullet, 30)) continue;
            const screen = worldToScreen(bullet);

            const angle = Math.atan2(bullet.dy, bullet.dx);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            ctx.fillStyle = bullet.explosive ? "#ffb000" : "#ffe066";
            ctx.shadowColor = bullet.explosive ? "#ff9d00" : "#fff1a8";
            ctx.shadowBlur = bullet.explosive ? 12 : 8;
            drawRoundedRectPath(
                ctx,
                -bullet.r * 1.8,
                -bullet.r * 0.45,
                bullet.r * 3.6,
                bullet.r * 0.9,
                bullet.r * 0.45
            );
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();

            if (bullet.explosive) {
                ctx.strokeStyle = "rgba(255,180,0,0.35)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, bullet.r + 4, 0, TWO_PI);
                ctx.stroke();
            }
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawMissiles() {
        for (const missile of missiles) {
            if (!missile || missile.dead || !isInView(missile, 40)) continue;
            const screen = worldToScreen(missile);
            const angle = Math.atan2(missile.dy, missile.dx);

            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            ctx.fillStyle = "#ffef8a";
            ctx.beginPath();
            ctx.moveTo(11, 0);
            ctx.lineTo(-8, -6);
            ctx.lineTo(-5, 0);
            ctx.lineTo(-8, 6);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 130, 40, 0.72)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-8, 0);
            ctx.lineTo(-20, 0);
            ctx.stroke();
            ctx.restore();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDamageAura() {
        if (player.auraLevel <= 0 || player.auraRadius <= 0) return;

        const screen = worldToScreen(player);
        const now = Date.now();
        const pulse = 1 + Math.sin(now / 185) * 0.04;
        const radius = player.auraRadius * pulse;

        const gradient = ctx.createRadialGradient(screen.x, screen.y, player.r + 8, screen.x, screen.y, radius);
        gradient.addColorStop(0, "rgba(99, 215, 255, 0.13)");
        gradient.addColorStop(0.72, "rgba(99, 215, 255, 0.045)");
        gradient.addColorStop(1, "rgba(99, 215, 255, 0.0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
        ctx.fill();

        ctx.strokeStyle = "rgba(99, 215, 255, 0.74)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = "rgba(190, 245, 255, 0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius * 0.72, 0, TWO_PI);
        ctx.stroke();

        const particleCount = Math.min(18, 8 + player.auraLevel);
        for (let i = 0; i < particleCount; i++) {
            const angle = now / (560 + i * 19) + (TWO_PI / particleCount) * i;
            const orbitRadius = radius * (0.32 + (i % 4) * 0.16);
            const px = screen.x + Math.cos(angle) * orbitRadius;
            const py = screen.y + Math.sin(angle) * orbitRadius;
            const particlePulse = 1 + Math.sin(now / 130 + i) * 0.35;
            drawCircle(ctx, px, py, 2.2 * particlePulse, "rgba(155, 238, 255, 0.82)");
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCarrierMissiles() {
        for (const missile of carrierMissiles) {
            if (!missile || missile.dead || !isInView(missile, 50)) continue;
            const screen = worldToScreen(missile);
            const angle = Math.atan2(missile.dy, missile.dx);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            const roleColor = missile.role === "interceptor" ? "#55d7ff" : missile.mode === "orbit" ? "#b86bff" : "#ff8a4c";
            ctx.shadowColor = roleColor;
            ctx.shadowBlur = 12;
            ctx.fillStyle = missile.role === "interceptor" ? "#b8f6ff" : missile.mode === "orbit" ? "#e0b8ff" : "#ffcf66";
            ctx.beginPath();
            ctx.moveTo(16, 0);
            ctx.lineTo(-10, -8);
            ctx.lineTo(-5, 0);
            ctx.lineTo(-10, 8);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = roleColor;
            ctx.fillRect(-17, -3, 8, 6);
            ctx.restore();

            const ratio = clamp(missile.health / missile.maxHealth, 0, 1);
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(screen.x - 14, screen.y - 18, 28, 4);
            ctx.fillStyle = "#7cffd4";
            ctx.fillRect(screen.x - 14, screen.y - 18, 28 * ratio, 4);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemyBullets() {
        for (const bullet of enemyBullets) {
            if (!isInView(bullet, 30)) continue;
            const screen = worldToScreen(bullet);

            const angle = Math.atan2(bullet.dy, bullet.dx);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            ctx.fillStyle = bullet.color;
            ctx.shadowColor = bullet.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.ellipse(0, 0, bullet.r * 1.55, bullet.r * 0.82, 0, 0, TWO_PI);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();

            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, bullet.r + 3, 0, TWO_PI);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawParticles() {
        for (const particle of particles) {
            if (!particle || particle.dead || !isInView(particle, 50)) continue;
            const screen = worldToScreen(particle);
            const alpha = clamp(particle.life / particle.maxLife, 0, 1);
            if (particle.auraRing) {
                ctx.strokeStyle = hexToRgba(particle.color, 0.55 * alpha);
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, particle.r * (1 + (1 - alpha) * 0.08), 0, TWO_PI);
                ctx.stroke();
            } else {
                drawCircle(ctx, screen.x, screen.y, particle.r, hexToRgba(particle.color, 0.76 * alpha));
            }
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDamageNumbers() {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "bold 17px Arial, sans-serif";
        ctx.lineWidth = 4;
        for (const number of damageNumbers) {
            if (!number || number.dead || !isInView(number, 80)) continue;
            const screen = worldToScreen(number);
            const alpha = clamp(number.life / number.maxLife, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = "rgba(0,0,0,0.75)";
            ctx.fillStyle = number.color;
            ctx.strokeText(number.text, screen.x, screen.y);
            ctx.fillText(number.text, screen.x, screen.y);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    /**
     * Handles the hexToRgba operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function hexToRgba(hex, alpha) {
        const normalized = hex.replace("#", "");
        if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;
        const value = Number.parseInt(normalized, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawExplosions() {
        for (const explosion of explosions) {
            const screen = worldToScreen(explosion);
            const t = explosion.life / explosion.maxLife;
            const radius = explosion.radius * (1.15 - t * 0.15);

            drawCircle(ctx, screen.x, screen.y, radius, `rgba(255, 150, 40, ${0.22 * t})`);

            ctx.strokeStyle = `rgba(255, 230, 120, ${0.8 * t})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPointOrbs() {
        for (const orb of pointOrbs) {
            if (!orb || orb.dead || !isInView(orb, 40)) continue;

            const screen = worldToScreen(orb);
            const pulse = 1 + Math.sin(Date.now() / 120) * 0.16;

            if (orb.magnetized) {
                const playerScreen = worldToScreen(player);
                ctx.strokeStyle = "rgba(255, 244, 150, 0.34)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(screen.x, screen.y);
                ctx.lineTo(playerScreen.x, playerScreen.y);
                ctx.stroke();
            }

            drawCircle(ctx, screen.x, screen.y, orb.r * pulse, "#ffe066");

            ctx.strokeStyle = orb.magnetized ? "rgba(255, 255, 210, 0.85)" : "rgba(255, 224, 102, 0.45)";
            ctx.lineWidth = orb.magnetized ? 3 : 2;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, orb.r * pulse + (orb.magnetized ? 7 : 4), 0, TWO_PI);
            ctx.stroke();
        }
    }


    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawLifeStealOrbs() {
        const now = Date.now();
        for (const orb of lifeStealOrbs) {
            if (!orb || orb.dead || !isInView(orb, 50)) continue;
            const screen = worldToScreen(orb);
            const alpha = clamp(orb.life / 150, 0.25, 1);
            const pulse = 1 + Math.sin(now / 90 + orb.x) * 0.18;

            drawCircle(ctx, screen.x, screen.y, orb.r * pulse, `rgba(124,255,155,${0.85 * alpha})`);
            ctx.strokeStyle = `rgba(220,255,225,${0.58 * alpha})`;
            ctx.lineWidth = orb.magnetized ? 3 : 2;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, orb.r * pulse + (orb.magnetized ? 8 : 4), 0, TWO_PI);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPickups() {
        for (const pickup of pickups) {
            if (!isInView(pickup, 40)) continue;

            const screen = worldToScreen(pickup);
            const pulse = 1 + Math.sin(Date.now() / 140) * 0.12;

            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.scale(pulse, pulse);

            if (pickup.magnetized) {
                ctx.strokeStyle = pickup.type === "health" ? "rgba(54, 255, 122, 0.70)" : "rgba(99, 215, 255, 0.70)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, pickup.r + 6, 0, TWO_PI);
                ctx.stroke();
            }

            drawPickupIcon(pickup);
            ctx.restore();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPickupIcon(pickup) {
        const drawActions = {
            health: () => {
                drawCircle(ctx, 0, 0, pickup.r, "#36ff7a");
                ctx.fillStyle = "#063b18";
                ctx.fillRect(-3, -8, 6, 16);
                ctx.fillRect(-8, -3, 16, 6);
            },
            speed: () => {
                ctx.fillStyle = "#63d7ff";
                ctx.strokeStyle = "rgba(225,250,255,0.95)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(3, -15);
                ctx.lineTo(-6, -2);
                ctx.lineTo(0, -2);
                ctx.lineTo(-4, 15);
                ctx.lineTo(8, 1);
                ctx.lineTo(2, 1);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            },
            harm: () => {
                drawCircle(ctx, 0, 2, pickup.r, "#ff3030");
                ctx.fillStyle = "#2a0505";
                ctx.beginPath();
                ctx.arc(-4, 0, 2.6, 0, TWO_PI);
                ctx.arc(4, 0, 2.6, 0, TWO_PI);
                ctx.fill();
                ctx.strokeStyle = "#2a0505";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(-5, 7);
                ctx.lineTo(-2, 4);
                ctx.lineTo(0, 7);
                ctx.lineTo(2, 4);
                ctx.lineTo(5, 7);
                ctx.stroke();
                ctx.strokeStyle = "#ffd37a";
                ctx.beginPath();
                ctx.moveTo(4, -9);
                ctx.quadraticCurveTo(8, -14, 11, -10);
                ctx.stroke();
            },
            slow: () => {
                drawCircle(ctx, 0, 0, pickup.r, "#b36bff");
                ctx.fillStyle = "#21003f";
                ctx.beginPath();
                ctx.moveTo(0, 10);
                ctx.lineTo(-8, -1);
                ctx.lineTo(-3, -1);
                ctx.lineTo(-3, -9);
                ctx.lineTo(3, -9);
                ctx.lineTo(3, -1);
                ctx.lineTo(8, -1);
                ctx.closePath();
                ctx.fill();
            },
        };

        drawActions[pickup.type]?.();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemyShip(enemy, screen) {
        const radius = enemy.r;
        const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        const flashActive = enemy.auraFlashUntil && Date.now() < enemy.auraFlashUntil;

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(angle);
        drawShipShadow(radius);

        const engineColor = enemy.type === "runner"
            ? "rgba(255, 179, 71, 0.9)"
            : enemy.type === "fighter"
                ? "rgba(85, 215, 255, 0.95)"
                : enemy.type === "carrier"
                    ? "rgba(255, 170, 70, 0.75)"
                    : enemy.type === "dodger"
                        ? "rgba(124, 255, 212, 0.86)"
                        : "rgba(255, 95, 130, 0.72)";
        drawThrusterPair(radius, engineColor);

        const color = flashActive ? "#9beeff" : enemy.color;
        const stroke = flashActive ? "rgba(210, 250, 255, 0.95)" : "rgba(255, 255, 255, 0.42)";

        if (enemy.type === "runner") drawRunnerShip(radius, color, stroke);
        else if (enemy.type === "tank") drawTankShip(radius, color, stroke);
        else if (enemy.type === "miniTank") drawMiniTankShip(radius, color, stroke);
        else if (enemy.type === "fighter") drawFighterShip(radius, color, stroke);
        else if (enemy.type === "carrier") drawCarrierShip(radius, color, stroke);
        else if (enemy.type === "brute") drawBruteShip(radius, color, stroke);
        else if (enemy.type === "dodger") drawDodgerShip(radius, color, stroke);
        else if (enemy.type === "boss") drawBossShip(radius, color, stroke);
        else if (enemy.type === "gigaBoss") drawGigaBossShip(radius, color, stroke);
        else drawNormalShip(radius, color, stroke);

        ctx.restore();

        if (flashActive) {
            ctx.strokeStyle = "rgba(99, 215, 255, 0.95)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, enemy.r + 5, 0, TWO_PI);
            ctx.stroke();
            drawCircle(ctx, screen.x, screen.y, enemy.r + 2, "rgba(99, 215, 255, 0.18)");
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawNormalShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.15, 0);
        ctx.lineTo(radius * 0.12, -radius * 0.72);
        ctx.lineTo(-radius * 0.95, -radius * 0.52);
        ctx.lineTo(-radius * 0.62, 0);
        ctx.lineTo(-radius * 0.95, radius * 0.52);
        ctx.lineTo(radius * 0.12, radius * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawCockpit(radius, "rgba(45, 0, 12, 0.48)");
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawRunnerShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.75, 0);
        ctx.lineTo(-radius * 0.3, -radius * 0.46);
        ctx.lineTo(-radius * 1.15, -radius * 0.16);
        ctx.lineTo(-radius * 0.3, 0);
        ctx.lineTo(-radius * 1.15, radius * 0.16);
        ctx.lineTo(-radius * 0.3, radius * 0.46);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawCockpit(radius * 0.72, "rgba(60, 24, 0, 0.52)");
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawTankShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.08, 0);
        ctx.lineTo(radius * 0.45, -radius * 0.68);
        ctx.lineTo(-radius * 0.92, -radius * 0.78);
        ctx.lineTo(-radius * 1.12, 0);
        ctx.lineTo(-radius * 0.92, radius * 0.78);
        ctx.lineTo(radius * 0.45, radius * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 3);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawMiniTankShip(radius, color, stroke) {
        drawTankShip(radius, color, stroke);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(radius * 0.2, -radius * 0.88);
        ctx.lineTo(radius * 0.78, -radius * 0.88);
        ctx.moveTo(radius * 0.2, radius * 0.88);
        ctx.lineTo(radius * 0.78, radius * 0.88);
        ctx.stroke();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawFighterShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.55, 0);
        ctx.lineTo(radius * 0.1, -radius * 0.72);
        ctx.lineTo(-radius * 0.95, -radius * 0.26);
        ctx.lineTo(-radius * 0.35, 0);
        ctx.lineTo(-radius * 0.95, radius * 0.26);
        ctx.lineTo(radius * 0.1, radius * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawCockpit(radius * 0.8, "rgba(0, 32, 58, 0.62)");
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCarrierShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(radius * 1.18, 0);
        ctx.lineTo(radius * 0.55, -radius * 0.74);
        ctx.lineTo(-radius * 0.8, -radius * 0.95);
        ctx.lineTo(-radius * 1.18, -radius * 0.48);
        ctx.lineTo(-radius * 0.98, 0);
        ctx.lineTo(-radius * 1.18, radius * 0.48);
        ctx.lineTo(-radius * 0.8, radius * 0.95);
        ctx.lineTo(radius * 0.55, radius * 0.74);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 6);
        ctx.fillStyle = "rgba(255, 190, 75, 0.82)";
        ctx.fillRect(radius * 0.05, -radius * 0.13, radius * 0.88, radius * 0.26);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBruteShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.25, 0);
        ctx.lineTo(radius * 0.28, -radius * 0.72);
        ctx.lineTo(-radius * 1.02, -radius * 0.66);
        ctx.lineTo(-radius * 0.8, radius * 0.66);
        ctx.lineTo(radius * 0.28, radius * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(40,0,24,0.55)";
        ctx.fillRect(-radius * 0.38, -radius * 0.9, radius * 0.62, radius * 0.24);
        ctx.fillRect(-radius * 0.38, radius * 0.66, radius * 0.62, radius * 0.24);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDodgerShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.42, 0);
        ctx.lineTo(radius * 0.05, -radius * 0.86);
        ctx.lineTo(-radius * 0.52, -radius * 0.28);
        ctx.lineTo(-radius * 1.08, 0);
        ctx.lineTo(-radius * 0.52, radius * 0.28);
        ctx.lineTo(radius * 0.05, radius * 0.86);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.beginPath();
        ctx.moveTo(-radius * 0.24, 0);
        ctx.lineTo(radius * 0.72, 0);
        ctx.stroke();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBossShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(radius * 1.18, 0);
        ctx.lineTo(radius * 0.34, -radius * 0.82);
        ctx.lineTo(-radius * 1.04, -radius * 0.92);
        ctx.lineTo(-radius * 0.76, 0);
        ctx.lineTo(-radius * 1.04, radius * 0.92);
        ctx.lineTo(radius * 0.34, radius * 0.82);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 5);
        ctx.fillStyle = "rgba(255, 235, 59, 0.88)";
        ctx.fillRect(radius * 0.08, -radius * 0.1, radius * 0.9, radius * 0.2);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawGigaBossShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(radius * 1.15, 0);
        ctx.lineTo(radius * 0.65, -radius * 0.58);
        ctx.lineTo(-radius * 0.88, -radius * 0.92);
        ctx.lineTo(-radius * 1.22, -radius * 0.28);
        ctx.lineTo(-radius * 0.98, 0);
        ctx.lineTo(-radius * 1.22, radius * 0.28);
        ctx.lineTo(-radius * 0.88, radius * 0.92);
        ctx.lineTo(radius * 0.65, radius * 0.58);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 7);
        ctx.fillStyle = "rgba(255, 32, 32, 0.86)";
        ctx.beginPath();
        ctx.arc(radius * 0.28, 0, radius * 0.16, 0, TWO_PI);
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCockpit(radius, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(radius * 0.34, 0, radius * 0.28, radius * 0.2, 0, 0, TWO_PI);
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawHullWindows(radius, count) {
        ctx.fillStyle = "rgba(230, 245, 255, 0.72)";
        const start = -((count - 1) * radius * 0.18) / 2;
        for (let i = 0; i < count; i++) {
            ctx.fillRect(-radius * 0.18, start + i * radius * 0.18 - radius * 0.035, radius * 0.26, radius * 0.07);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemies() {
        for (const enemy of enemies) {
            if (!isInView(enemy, 100)) continue;

            const screen = worldToScreen(enemy);
            drawEnemyShip(enemy, screen);

            if (enemy.type === "boss" || enemy.type === "gigaBoss") drawBossDetails(enemy, screen);
            if (enemy.type === "miniTank") drawMiniTankDetails(enemy, screen);

            drawEnemyHealthBar(enemy, screen);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawMiniTankDetails(enemy, screen) {
        ctx.strokeStyle = "rgba(213, 139, 255, 0.86)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + 7, 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + 13, 0, TWO_PI);
        ctx.stroke();

        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(screen.x - 18, screen.y - 4, 36, 8);
        ctx.fillStyle = "#f0d4ff";
        ctx.fillRect(screen.x - 3, screen.y - 20, 6, 40);
        ctx.fillRect(screen.x - 20, screen.y - 3, 40, 6);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBossDetails(enemy, screen) {
        const isGigaBoss = enemy.type === "gigaBoss";

        ctx.strokeStyle = isGigaBoss ? "rgba(255,255,255,0.98)" : "rgba(255, 230, 80, 0.95)";
        ctx.lineWidth = isGigaBoss ? 6 : 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + (isGigaBoss ? 11 : 7), 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = isGigaBoss ? "rgba(255, 40, 40, 0.9)" : "rgba(255, 90, 90, 0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + (isGigaBoss ? 22 : 14), 0, TWO_PI);
        ctx.stroke();

        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(screen.x - 22, screen.y - 5, 44, 10);

        ctx.fillStyle = isGigaBoss ? "#ff2020" : "#ffeb3b";
        ctx.fillRect(screen.x - 4, screen.y - 24, 8, 48);
        ctx.fillRect(screen.x - 24, screen.y - 4, 48, 8);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDodgerDetails(screen) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(screen.x - 8, screen.y);
        ctx.lineTo(screen.x + 8, screen.y);
        ctx.moveTo(screen.x, screen.y - 8);
        ctx.lineTo(screen.x, screen.y + 8);
        ctx.stroke();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemyHealthBar(enemy, screen) {
        const healthPercent = Math.max(0, enemy.health / enemy.maxHealth);

        ctx.fillStyle = "#111";
        ctx.fillRect(screen.x - enemy.r, screen.y - enemy.r - 12, enemy.r * 2, 5);

        ctx.fillStyle = "#7cff7c";
        ctx.fillRect(screen.x - enemy.r, screen.y - enemy.r - 12, enemy.r * 2 * healthPercent, 5);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimap() {
        const width = minimap.width;
        const height = minimap.height;
        const scaleX = width / WORLD.width;
        const scaleY = height / WORLD.height;

        minimapCtx.clearRect(0, 0, width, height);
        minimapCtx.fillStyle = "rgba(8, 12, 22, 0.98)";
        minimapCtx.fillRect(0, 0, width, height);

        if (!PLATFORM_PROFILE.isMobilePerformance) drawMinimapGrid(width, height);
        drawMinimapCameraView(scaleX, scaleY);
        drawMinimapEntities(scaleX, scaleY);

        minimapCtx.strokeStyle = "rgba(255, 90, 90, 0.55)";
        minimapCtx.lineWidth = 2;
        minimapCtx.strokeRect(1, 1, width - 2, height - 2);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapGrid(width, height) {
        minimapCtx.strokeStyle = "rgba(90, 200, 255, 0.18)";
        minimapCtx.lineWidth = 1;

        for (let x = 0; x <= width; x += width / 6) {
            minimapCtx.beginPath();
            minimapCtx.moveTo(x, 0);
            minimapCtx.lineTo(x, height);
            minimapCtx.stroke();
        }

        for (let y = 0; y <= height; y += height / 4) {
            minimapCtx.beginPath();
            minimapCtx.moveTo(0, y);
            minimapCtx.lineTo(width, y);
            minimapCtx.stroke();
        }
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapCameraView(scaleX, scaleY) {
        minimapCtx.strokeStyle = "rgba(255,255,255,0.48)";
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(
            camera.x * scaleX,
            camera.y * scaleY,
            getVisibleWorldWidth() * scaleX,
            getVisibleWorldHeight() * scaleY
        );
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapEntities(scaleX, scaleY) {
        for (const orb of pointOrbs) drawMinimapPointOrb(orb, scaleX, scaleY);
        for (const orb of lifeStealOrbs) drawCircle(minimapCtx, orb.x * scaleX, orb.y * scaleY, 2.2, "#7cff9b");
        for (const pickup of pickups) drawMinimapPickup(pickup, scaleX, scaleY);
        for (const enemy of enemies) drawMinimapEnemy(enemy, scaleX, scaleY);
        if (!PLATFORM_PROFILE.isMobilePerformance) {
            for (const bullet of enemyBullets) drawMinimapEnemyBullet(bullet, scaleX, scaleY);
            for (const missile of carrierMissiles) if (missile && !missile.dead) drawCircle(minimapCtx, missile.x * scaleX, missile.y * scaleY, 2.5, "#ffcf66");
        }
        drawMinimapPlayer(scaleX, scaleY);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapPointOrb(orb, scaleX, scaleY) {
        if (!orb || orb.dead) return;
        drawCircle(minimapCtx, orb.x * scaleX, orb.y * scaleY, 2, "#ffe066");
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapPickup(pickup, scaleX, scaleY) {
        const colors = {
            health: "#36ff7a",
            speed: "#63d7ff",
            harm: "#ff3030",
            slow: "#b36bff",
        };

        drawCircle(minimapCtx, pickup.x * scaleX, pickup.y * scaleY, 2, colors[pickup.type]);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapEnemy(enemy, scaleX, scaleY) {
        const radius = enemy.type === "gigaBoss" ? 7 : enemy.type === "boss" ? 5 : enemy.type === "carrier" ? 5 : enemy.type === "miniTank" ? 4 : 3;
        const x = enemy.x * scaleX;
        const y = enemy.y * scaleY;

        drawCircle(minimapCtx, x, y, radius, enemy.color);

        if (enemy.type === "boss" || enemy.type === "gigaBoss" || enemy.type === "miniTank") {
            minimapCtx.strokeStyle = enemy.type === "gigaBoss" ? "#ffffff" : enemy.type === "miniTank" ? "#d58bff" : "#ffeb3b";
            minimapCtx.lineWidth = enemy.type === "gigaBoss" ? 2 : 1;
            minimapCtx.beginPath();
            minimapCtx.arc(x, y, enemy.type === "gigaBoss" ? 10 : enemy.type === "miniTank" ? 8 : 7, 0, TWO_PI);
            minimapCtx.stroke();
        }
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapEnemyBullet(bullet, scaleX, scaleY) {
        minimapCtx.fillStyle = "#ff79c6";
        minimapCtx.fillRect(bullet.x * scaleX - 1, bullet.y * scaleY - 1, 2, 2);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapPlayer(scaleX, scaleY) {
        const x = player.x * scaleX;
        const y = player.y * scaleY;

        drawCircle(minimapCtx, x, y, 4, "#6aa9ff");

        minimapCtx.strokeStyle = "white";
        minimapCtx.lineWidth = 1.5;
        minimapCtx.beginPath();
        minimapCtx.arc(x, y, 6, 0, TWO_PI);
        minimapCtx.stroke();
    }

    // -------------------------------------------------------------------------
    // UI
    // -------------------------------------------------------------------------
    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateDamageOverlay(now) {
        if (state.damageFlash > 0) {
            state.damageFlash = Math.max(0, state.damageFlash - 0.035);
        }

        const lowHealthPulse = player.health > 0 && player.health < player.maxHealth * 0.25
            ? 0.12 + Math.sin(now / 120) * 0.04
            : 0;

        ui.damageOverlay.style.opacity = Math.max(state.damageFlash, lowHealthPulse);
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateStatusOverlays(now) {
        ui.speedBoostOverlay.style.opacity = 0;
        ui.slowStatusOverlay.style.opacity = 0;
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateUi(now) {
        const healthText = `${Math.max(0, Math.floor(player.health))} / ${player.maxHealth}`;
        const healthPercent = clamp(player.health / player.maxHealth, 0, 1);
        const boostRemaining = Math.max(0, Math.ceil((player.speedBoostUntil - now) / 1000));
        const slowRemaining = Math.max(0, Math.ceil((player.slowUntil - now) / 1000));

        ui.wave.textContent = state.wave;
        ui.health.textContent = healthText;
        ui.score.textContent = state.score;
        ui.points.textContent = state.upgradePoints;
        ui.bulletSpeed.textContent = player.bulletSpeed.toFixed(1);
        ui.explosiveLevel.textContent = player.explosiveLevel;
        ui.speedBoostInfo.textContent = boostRemaining > 0 ? `${boostRemaining}s` : "None";
        ui.slowInfo.textContent = slowRemaining > 0 ? `${slowRemaining}s` : "None";
        ui.magnetInfo.textContent = `${Math.floor(player.pointMagnetRadius)} px`;
        ui.bossInfo.textContent = getBossInfoText();
        ui.playerHealthBar.style.width = `${healthPercent * 100}%`;
        ui.playerHealthText.textContent = healthText;
        ui.playerHealthBarWrap.classList.toggle("regen-active", now < player.regenGlowUntil);
        ui.regenHealthTick.style.left = `${healthPercent * 100}%`;
        ui.mapInfo.textContent = `${WORLD.width} x ${WORLD.height}`;

        if (ui.upgradeMenu.style.display === "flex") {
            updateUpgradeButtons();
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getBossInfoText() {
        if (isGigaBossWave()) return "GIGA ACTIVE";
        if (isBossWave()) return "ACTIVE";
        if (state.wave >= 10 && enemies.some(enemy => enemy.type === "miniTank")) return "Mini tank active";
        return `Wave ${Math.ceil(state.wave / 10) * 10}`;
    }

    /**
     * Performs bounded cleanup to prevent dead objects and visual effects from accumulating over long runs.
     */
    function cleanupDeadObjects() {
        removeDeadItems(bullets);
        removeDeadItems(missiles);
        removeDeadItems(enemyBullets);
        removeDeadItems(carrierMissiles);
        removeDeadItems(enemies);
        removeDeadItems(pickups);
        removeDeadItems(pointOrbs);
        removeDeadItems(lifeStealOrbs);
        removeDeadItems(particles);
        removeDeadItems(damageNumbers);
        trimOldest(pointOrbs, PERFORMANCE_LIMITS.maxPointOrbs);
        trimOldest(lifeStealOrbs, PERFORMANCE_LIMITS.maxLifeStealOrbs);
        trimOldest(particles, PERFORMANCE_LIMITS.maxParticles);
        trimOldest(damageNumbers, PERFORMANCE_LIMITS.maxDamageNumbers);
        trimOldest(bullets, PERFORMANCE_LIMITS.maxBullets);
        trimOldest(missiles, PERFORMANCE_LIMITS.maxMissiles);
        trimOldest(enemyBullets, PERFORMANCE_LIMITS.maxEnemyBullets);
        trimOldest(carrierMissiles, PERFORMANCE_LIMITS.maxCarrierMissiles);
        trimOldest(explosions, PERFORMANCE_LIMITS.maxExplosions);
    }

    /**
     * Performs bounded cleanup to prevent dead objects and visual effects from accumulating over long runs.
     */
    function trimOldest(list, maxItems) {
        while (list.length > maxItems) list.shift();
    }

    /**
     * Performs bounded cleanup to prevent dead objects and visual effects from accumulating over long runs.
     */
    function removeDeadItems(list) {
        for (let i = list.length - 1; i >= 0; i--) {
            if (!list[i] || list[i].dead) list.splice(i, 1);
        }
    }

    // -------------------------------------------------------------------------
    // Main loop
    // -------------------------------------------------------------------------
    /**
     * Advances simulation state only. New gameplay systems should usually update here before rendering.
     */
    function updateGame(now) {
        pollGamepadInput();
        applyAnalogAimToMouse();
        updateTouchControlVisibility();
        updatePlayer(now);
        updateHealthRegen(now);
        updateLifeStealOrbs(now);
        updateCamera();

        if (!state.clearPhaseActive) {
            shootPlayerWeapon(now);
            updateAutoMissiles(now);
            updateBullets();
            updateDamageAura(now);
            updateRelicSystems(now);
            updateEnemies(now);
        } else {
            updateProjectileList(enemyBullets, 60);
        }

        updatePointOrbs(now);
        updatePickups(now);
        updateExplosions();
        updatePolishEffects();
        cleanupDeadObjects();
        checkWaveComplete(now);
    }

    /**
     * Renders the current simulation without mutating gameplay state. Keep drawing side effects visual-only.
     */
    function drawGame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        updateCamera();

        ctx.save();
        if (state.screenShake > 0) {
            ctx.translate(randomRange(-state.screenShake, state.screenShake), randomRange(-state.screenShake, state.screenShake));
        }
        // Mobile zooms the entire world scene out without increasing the canvas
        // backing resolution. DOM HUD and touch controls remain full-size.
        ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);

        drawSciFiBackground();
        drawParticles();
        drawExplosions();
        drawPointOrbs();
        drawLifeStealOrbs();
        drawPickups();
        drawDamageAura();
        drawRelicSystems();
        drawPlayer();
        drawPlayerBullets();
        drawMissiles();
        drawCarrierMissiles();
        drawEnemyBullets();
        drawEnemies();
        drawDamageNumbers();
        ctx.restore();

        minimapFrameCounter = (minimapFrameCounter + 1) % PERFORMANCE_LIMITS.minimapFrameSkip;
        if (minimapFrameCounter === 0) drawMinimap();
    }

    /**
     * Top-level requestAnimationFrame callback. Keep allocations and DOM work minimal because it runs every frame.
     */
    function gameLoop() {
        const now = Date.now();

        try {
            if (state.started && !state.paused && !state.ended) {
                updateGame(now);
            }

            renderFrameCounter = (renderFrameCounter + 1) % Math.max(1, PLATFORM_PROFILE.renderEveryNFrames || 1);
            if (renderFrameCounter === 0 || !state.started || state.paused || state.ended) {
                drawGame();
            }
            updateMusicMode();
            updateDamageOverlay(now);
            updateStatusOverlays(now);
            updateUi(now);
            updateAudioDebugConsole();
        } catch (error) {
            console.error("Game loop error:", error);
            if (ui.audioStatus) {
                ui.audioStatus.textContent = "Game error: check console";
            }
        }

        requestAnimationFrame(gameLoop);
    }

    /**
     * Updates one authoritative setting and synchronizes dependent UI or runtime state.
     */
    function setHudVisible(isVisible) {
        ui.hudPanel.classList.toggle("collapsed", !isVisible);
        ui.hudToggleButton.textContent = isVisible ? "Hide HUD" : "Show HUD";
        ui.hudToggleButton.setAttribute("aria-expanded", String(isVisible));
    }

    /**
     * Switches a boolean UI or gameplay state while preserving a single source of truth.
     */
    function toggleHud() {
        setHudVisible(ui.hudPanel.classList.contains("collapsed"));
    }


    // -------------------------------------------------------------------------
    // Touch and gamepad input
    // -------------------------------------------------------------------------
    const touchControls = document.getElementById("touchControls");
    const inputStatus = document.getElementById("inputStatus");

    function setInputSource(source) {
        analogInput.source = source;
        if (inputStatus) {
            inputStatus.textContent = source === "touch" ? "Touch: dual sticks" :
                source === "gamepad" ? "Gamepad connected" : "Keyboard + Mouse";
        }
    }

    function applyAnalogAimToMouse() {
        if (!analogInput.aimActive) return;
        const playerScreen = worldToScreen(player);
        const aimDistance = Math.max(260, Math.min(canvas.width, canvas.height) * 0.38);
        mouse.x = playerScreen.x * CAMERA_ZOOM + analogInput.aimX * aimDistance;
        mouse.y = playerScreen.y * CAMERA_ZOOM + analogInput.aimY * aimDistance;
    }

    function applyDeadZone(value, deadZone = 0.18) {
        const magnitude = Math.abs(value);
        if (magnitude <= deadZone) return 0;
        return Math.sign(value) * Math.min(1, (magnitude - deadZone) / (1 - deadZone));
    }

    function pollGamepadInput() {
        if (!navigator.getGamepads) return;
        const pads = navigator.getGamepads();
        const pad = [...pads].find(Boolean);
        if (!pad) return;

        const lx = applyDeadZone(pad.axes[0] || 0);
        const ly = applyDeadZone(pad.axes[1] || 0);
        const rx = applyDeadZone(pad.axes[2] || 0);
        const ry = applyDeadZone(pad.axes[3] || 0);
        const dpadX = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
        const dpadY = (pad.buttons[13]?.pressed ? 1 : 0) - (pad.buttons[12]?.pressed ? 1 : 0);
        const active = Math.hypot(lx, ly) > 0.05 || Math.hypot(rx, ry) > 0.05 || dpadX || dpadY;

        // Touch retains control briefly after contact so an idle connected pad
        // cannot zero the mobile sticks.
        if (active && Date.now() - analogInput.lastTouchAt > 350) {
            analogInput.moveX = lx || dpadX;
            analogInput.moveY = ly || dpadY;
            if (Math.hypot(rx, ry) > 0.12) {
                const length = Math.hypot(rx, ry);
                analogInput.aimX = rx / length;
                analogInput.aimY = ry / length;
                analogInput.aimActive = true;
            }
            setInputSource("gamepad");
        } else if (analogInput.source === "gamepad" && !active) {
            analogInput.moveX = 0;
            analogInput.moveY = 0;
        }

        const pausePressed = !!(pad.buttons[9]?.pressed || pad.buttons[8]?.pressed);
        if (pausePressed && !analogInput.gamepadPauseHeld && state.started && !state.ended && ui.upgradeMenu.style.display !== "flex") {
            togglePause();
        }
        analogInput.gamepadPauseHeld = pausePressed;
    }

    function updateTouchControlVisibility() {
        if (!touchControls) return;
        const touchCapable = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
        // Keep controls active during the wave-clear collection window so the
        // player can sweep up point orbs and pickups. They hide only once the
        // Upgrade Protocol menu opens or gameplay is otherwise paused/ended.
        const visible = touchCapable && state.started && !state.ended && !state.paused && ui.upgradeMenu.style.display !== "flex";
        touchControls.classList.toggle("available", touchCapable);
        touchControls.classList.toggle("active", visible);
        touchControls.setAttribute("aria-hidden", String(!visible));

        // Mobile HUD visibility is controlled by one explicit body state. This
        // prevents the minimap, pause control, or desktop health bar from leaking
        // onto the splash screen, menus, pause screen, or Upgrade Protocol.
        document.body.classList.toggle("mobile-gameplay-hud", visible);
        // Shared gameplay HUD state for desktop and mobile. Desktop minimap visibility
        // must not depend on touch capability.
        const gameplayHudVisible = state.started && !state.ended && !state.paused && ui.upgradeMenu.style.display !== "flex";
        document.body.classList.toggle("gameplay-hud-active", gameplayHudVisible);

        // Runtime mobile HUD contract. The stylesheet contains legacy mobile rules
        // from earlier builds with competing specificity. Apply the final gameplay
        // layout directly so those historical rules cannot move the minimap or
        // resurrect the desktop health bar. Inline !important declarations are
        // deliberate here: this is the authoritative platform-state boundary.
        const mobileProfileActive = document.documentElement.classList.contains("mobile-performance");
        const topRightHud = document.getElementById("topRightHud");
        const pauseButton = document.getElementById("touchPauseButton");
        const minimapWrap = document.getElementById("minimapWrap");
        const desktopHealthBar = document.getElementById("playerHealthBarWrap");

        if (mobileProfileActive) {
            if (desktopHealthBar) {
                desktopHealthBar.hidden = true;
                desktopHealthBar.style.setProperty("display", "none", "important");
            }

            if (topRightHud) {
                topRightHud.style.setProperty("display", visible ? "flex" : "none", "important");
                topRightHud.style.setProperty("position", "fixed", "important");
                topRightHud.style.setProperty("top", "max(12px, env(safe-area-inset-top))", "important");
                topRightHud.style.setProperty("right", "max(12px, env(safe-area-inset-right))", "important");
                topRightHud.style.setProperty("left", "auto", "important");
                topRightHud.style.setProperty("bottom", "auto", "important");
                topRightHud.style.setProperty("transform", "none", "important");
                topRightHud.style.setProperty("flex-direction", "row", "important");
                topRightHud.style.setProperty("align-items", "flex-start", "important");
                topRightHud.style.setProperty("justify-content", "flex-end", "important");
                topRightHud.style.setProperty("gap", "10px", "important");
                topRightHud.style.setProperty("z-index", "80", "important");
                topRightHud.style.setProperty("pointer-events", "none", "important");
            }

            if (pauseButton) {
                pauseButton.style.setProperty("display", visible ? "grid" : "none", "important");
                pauseButton.style.setProperty("position", "static", "important");
                pauseButton.style.setProperty("inset", "auto", "important");
                pauseButton.style.setProperty("transform", "none", "important");
                pauseButton.style.setProperty("margin", "0", "important");
                pauseButton.style.setProperty("pointer-events", "auto", "important");
                pauseButton.style.setProperty("flex", "0 0 48px", "important");
            }

            if (minimapWrap) {
                minimapWrap.style.setProperty("display", visible ? "block" : "none", "important");
                minimapWrap.style.setProperty("position", "static", "important");
                minimapWrap.style.setProperty("inset", "auto", "important");
                minimapWrap.style.setProperty("top", "auto", "important");
                minimapWrap.style.setProperty("right", "auto", "important");
                minimapWrap.style.setProperty("bottom", "auto", "important");
                minimapWrap.style.setProperty("left", "auto", "important");
                minimapWrap.style.setProperty("transform", "none", "important");
                minimapWrap.style.setProperty("margin", "0", "important");
                minimapWrap.style.setProperty("width", "132px", "important");
                minimapWrap.style.setProperty("flex", "0 0 132px", "important");
                minimapWrap.style.setProperty("pointer-events", "none", "important");
            }
        } else {
            // Desktop owns a full-size minimap card. Remove every mobile inline
            // declaration so the desktop CSS contract can render the wrapper,
            // title, and canvas as one intact unit.
            if (desktopHealthBar) {
                desktopHealthBar.hidden = false;
                desktopHealthBar.style.removeProperty("display");
            }
            if (topRightHud) {
                for (const property of ["display", "position", "top", "right", "left", "bottom", "transform", "flex-direction", "align-items", "justify-content", "gap", "z-index", "pointer-events"]) {
                    topRightHud.style.removeProperty(property);
                }
            }
            if (pauseButton) {
                for (const property of ["display", "position", "inset", "transform", "margin", "pointer-events", "flex"]) {
                    pauseButton.style.removeProperty(property);
                }
            }
            if (minimapWrap) {
                for (const property of ["display", "position", "inset", "top", "right", "bottom", "left", "transform", "margin", "width", "height", "flex", "pointer-events"]) {
                    minimapWrap.style.removeProperty(property);
                }
            }
        }

        // CSS only displays `.available.active`; inactive overlays therefore cannot
        // intercept menu swipes or impose touch-action:none over the viewport.
    }

    function bindVirtualStick(zone, kind) {
        if (!zone) return;
        const base = zone.querySelector(".touch-stick-base");
        const knob = zone.querySelector(".touch-stick-knob");
        let pointerId = null;

        const reset = () => {
            if (knob) knob.style.transform = "translate(-50%, -50%)";
            if (kind === "move") {
                analogInput.moveX = 0;
                analogInput.moveY = 0;
            }
            pointerId = null;
        };

        const update = event => {
            const rect = base.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const radius = rect.width * 0.36;
            let dx = event.clientX - cx;
            let dy = event.clientY - cy;
            const distance = Math.hypot(dx, dy);
            if (distance > radius) {
                dx = dx / distance * radius;
                dy = dy / distance * radius;
            }
            const nx = dx / radius;
            const ny = dy / radius;
            if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            if (kind === "move") {
                const magnitude = Math.hypot(nx, ny);
                const deadZone = 0.10;
                if (magnitude <= deadZone) {
                    analogInput.moveX = 0;
                    analogInput.moveY = 0;
                } else {
                    const shapedMagnitude = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
                    analogInput.moveX = (nx / magnitude) * shapedMagnitude;
                    analogInput.moveY = (ny / magnitude) * shapedMagnitude;
                }
            } else if (Math.hypot(nx, ny) > 0.08) {
                const length = Math.hypot(nx, ny);
                analogInput.aimX = nx / length;
                analogInput.aimY = ny / length;
                analogInput.aimActive = true;
            }
            analogInput.lastTouchAt = Date.now();
            setInputSource("touch");
        };

        zone.addEventListener("pointerdown", event => {
            event.preventDefault();
            pointerId = event.pointerId;
            zone.setPointerCapture?.(pointerId);
            update(event);
            resumeAudio();
        }, { passive: false });
        zone.addEventListener("pointermove", event => {
            if (event.pointerId !== pointerId) return;
            event.preventDefault();
            update(event);
        }, { passive: false });
        zone.addEventListener("pointerup", event => { if (event.pointerId === pointerId) reset(); });
        zone.addEventListener("pointercancel", event => { if (event.pointerId === pointerId) reset(); });
        zone.addEventListener("lostpointercapture", reset);
    }

    /**
     * Centralized developer-mode visibility controller.
     * Keep player-facing builds clean by default while preserving diagnostics for testing.
     * Any future debug-only UI should be placed inside #debugPanel or
     * .audio-debug-console so this single switch remains authoritative.
     */
    function setDeveloperMode(enabled, { persist = true } = {}) {
        const isEnabled = Boolean(enabled);
        document.body.classList.toggle("developer-mode", isEnabled);
        if (ui.developerModeCheckbox) ui.developerModeCheckbox.checked = isEnabled;
        if (ui.developerModeStatus) ui.developerModeStatus.hidden = !isEnabled;

        // Closing the diagnostics panel prevents an already-open debug overlay from
        // remaining visible after Developer Mode is turned off.
        if (!isEnabled && ui.audioDebugConsole) ui.audioDebugConsole.hidden = true;
        if (persist) safeStorage.set("starwakeDeveloperMode", String(isEnabled));
    }

    function initializeTouchAndGamepadControls() {
        bindVirtualStick(document.querySelector('[data-stick="move"]'), "move");
        bindVirtualStick(document.querySelector('[data-stick="aim"]'), "aim");
        document.getElementById("touchPauseButton")?.addEventListener("pointerup", event => {
            event.preventDefault();
            if (state.started && !state.ended && ui.upgradeMenu.style.display !== "flex") togglePause();
        });
        window.addEventListener("gamepadconnected", event => {
            setInputSource("gamepad");
            if (inputStatus) inputStatus.textContent = `Gamepad: ${event.gamepad.id.split("(")[0].trim()}`;
        });
        window.addEventListener("gamepaddisconnected", () => {
            analogInput.moveX = 0;
            analogInput.moveY = 0;
            setInputSource("keyboard");
        });
        updateTouchControlVisibility();
    }

    // -------------------------------------------------------------------------
    // Events and startup
    // -------------------------------------------------------------------------
    /**
     * Registers all persistent input and UI listeners exactly once. Avoid rebinding this function during restart flows.
     */
    function bindEvents() {
        window.addEventListener("resize", updateCanvasSize);
    window.visualViewport?.addEventListener("resize", updateCanvasSize);
    window.visualViewport?.addEventListener("scroll", updateCanvasSize);

        window.addEventListener("keydown", event => {
            const key = event.key.toLowerCase();
            keysHeld[key] = true;

            const upgradeMenuOpen = ui.upgradeMenu.style.display === "flex";
            if (key === "p" && state.started && !state.ended && !upgradeMenuOpen) {
                togglePause();
            }

        });

        window.addEventListener("keyup", event => {
            keysHeld[event.key.toLowerCase()] = false;
        });


        document.addEventListener("pointerdown", () => { if (state.started && !state.ended) resumeAudio(); }, { passive: true });
        document.addEventListener("keydown", () => { if (state.started && !state.ended) resumeAudio(); });

        ui.continueFromSplashButton?.addEventListener("click", showStartMenu);
        for (const button of document.querySelectorAll("[data-fullscreen-button]")) {
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                toggleFullscreen();
            });
        }
        document.addEventListener("fullscreenchange", updateFullscreenButtons);
        document.addEventListener("webkitfullscreenchange", updateFullscreenButtons);
        const startButton = document.getElementById("startButton");
        startButton?.addEventListener("click", event => {
            event.preventDefault();
            window.StarwakeLaunchProtocol();
        });
        document.getElementById("restartButton")?.addEventListener("click", restartGame);
        ui.resumeButton.addEventListener("click", () => {
            if (state.manuallyPaused) togglePause();
        });
        document.getElementById("skipUpgradeButton").addEventListener("click", startNextWave);
        ui.undoUpgradeButton?.addEventListener("click", undoLastReconstructionAction);
        document.getElementById("debugAddPointsButton").addEventListener("click", debugAddPoints);
        document.getElementById("debugSkipWaveButton").addEventListener("click", debugSkipWave);
        document.getElementById("debugGoToWaveButton")?.addEventListener("click", debugGoToWave);
        ui.audioDebugToggleButton?.addEventListener("click", () => {
            ui.audioDebugConsole.hidden = !ui.audioDebugConsole.hidden;
            updateAudioDebugConsole();
        });
        ui.audioDebugCloseButton?.addEventListener("click", () => { ui.audioDebugConsole.hidden = true; });
        ui.audioDebugKillButton?.addEventListener("click", killAllAudioVoices);
        ui.audioDebugRestartButton?.addEventListener("click", () => restartAudioEngine().catch(error => {
            audio.diagnostics.lastError = error?.message || String(error);
            appendAudioDiagnostic(`Restart failed: ${audio.diagnostics.lastError}`);
        }));
        ui.audioDebugExportButton?.addEventListener("click", exportAudioDiagnostics);
        ui.developerModeCheckbox?.addEventListener("change", event => {
            setDeveloperMode(event.target.checked);
        });
        document.getElementById("debugWaveInput")?.addEventListener("keydown", event => {
            if (event.key === "Enter") debugGoToWave();
        });
        ui.hudToggleButton.addEventListener("click", toggleHud);
        ui.audioToggleButton?.addEventListener("click", () => setAudioEnabled(!audio.enabled));
        ui.menuAudioToggleButton?.addEventListener("click", () => setAudioEnabled(!audio.enabled));
        ui.pauseAudioToggleButton?.addEventListener("click", () => setAudioEnabled(!audio.enabled));
        ui.audioVolume?.addEventListener("input", event => setAudioVolume(event.target.value));
        ui.menuVolume?.addEventListener("input", event => setAudioVolume(event.target.value));
        ui.pauseVolume?.addEventListener("input", event => setAudioVolume(event.target.value));
        ui.menuMusicVolume?.addEventListener("input", event => setMusicVolume(event.target.value));
        ui.pauseMusicVolume?.addEventListener("input", event => setMusicVolume(event.target.value));
        ui.menuSfxVolume?.addEventListener("input", event => setSfxVolume(event.target.value));
        ui.pauseSfxVolume?.addEventListener("input", event => setSfxVolume(event.target.value));
        ui.menuCursorColor?.addEventListener("input", event => setCursorColor(event.target.value));
        ui.pauseCursorColor?.addEventListener("input", event => setCursorColor(event.target.value));

        for (const button of document.querySelectorAll("[data-cursor-color]")) {
            button.addEventListener("click", () => setCursorColor(button.dataset.cursorColor));
        }

        for (const button of difficultyButtons) {
            button.addEventListener("click", () => setDifficulty(button.dataset.difficulty));
        }

        for (const button of upgradeButtons) {
            button.addEventListener("click", () => buyUpgrade(button.dataset.upgrade));
        }
        document.getElementById("waveResearchChoices")?.addEventListener("click", event => {
            const relicButton = event.target.closest("[data-relic-research]");
            if (relicButton) {
                allocateRelicResearch(relicButton.dataset.relicResearch);
                return;
            }
            const button = event.target.closest("[data-wave-bonus]");
            if (button) claimEndWaveResearch(button.dataset.waveBonus);
        });
    }

    /**
     * Bootstraps the complete game after the DOM is ready. Keep this function lightweight, deterministic, and last in the startup chain.
     */
    function initialize() {
        initializeCustomCursorTracking();
        updateCanvasSize();
        generateBackgroundDetails();
        bindEvents();
        setHudVisible(true);
        setCursorColor(savedCursorColor);
        setDeveloperMode(savedDeveloperMode, { persist: false });
        initializeTouchAndGamepadControls();
        updateFullscreenButtons();
        updateCursorPosition(mouse.x, mouse.y);
        setDifficulty(state.difficulty);
        updateUndoUpgradeButton();
        setAudioVolume(savedAudioVolume);
        setAudioEnabled(savedAudioEnabled);
        gameLoop();
    }

    try {
        initialize();
        window.StarwakeGameReady = true;
    } catch (startupError) {
        window.StarwakeGameReady = false;
        window.StarwakeStartupError = startupError;
        console.error("Starwake startup error:", startupError);
        const status = document.getElementById("startupStatus");
        if (status) {
            status.hidden = false;
            status.textContent = `Startup warning: ${startupError.message || startupError}`;
        }
    }
})();
