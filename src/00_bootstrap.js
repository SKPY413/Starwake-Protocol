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
        playerVitalBars: document.getElementById("playerVitalBars"),
        playerShieldBarWrap: document.getElementById("playerShieldBarWrap"),
        playerShieldBar: document.getElementById("playerShieldBar"),
        playerShieldText: document.getElementById("playerShieldText"),
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

    // -------------------------------------------------------------------------
    // Central gameplay constants
    // -------------------------------------------------------------------------
    // Phase 4 moves high-value balance numbers out of subsystem logic. Keep
    // tunable values here so future balancing does not require hunting through
    // AI, projectile, rendering, and upgrade code.
    const GAMEPLAY_CONSTANTS = Object.freeze({
        evolution: Object.freeze({
            wavesPerGeneration: 10,
            maxGeneration: 5,
            multiMutationGeneration: 4,
            hullScaleByGeneration: Object.freeze([1, 1, 1.10, 1.20, 1.35, 1.50]),
            quantumNullStartWave: 32,
            quantumNullBaseChance: 0.10,
            quantumNullChancePerWave: 0.008,
            quantumNullMaxChance: 0.34,
        }),
        healer: Object.freeze({
            radius: 285,
        }),
        aegis: Object.freeze({
            shieldRadius: 430,
        }),
        carrier: Object.freeze({
            scalingStartWave: 20,
            manufactureBaseMs: 2000,
            manufactureMinimumMs: 1500,
            manufactureTimeScalePerWave: 0.99,
            stockpileBase: 30,
            stockpileMinimum: 30,
            stockpileMaximum: 72,
            stockpileScalePerWave: 1.03,
            manufactureBatchBase: 7,
            manufactureBatchMaximum: 12,
            manufactureBatchStepWaves: 10,
            initialStockpileBase: 20,
            initialStockpilePerWave: 0.6,
            aggressionRadius: 540,
            disengageRadius: 680,
            launchBatch: 12,
            launchBatchCooldownMs: 460,
            protectionRatio: 0.30,
            attackRatio: 0.60,
            orbitRatio: 0.10,
        }),
        defensePlatforms: Object.freeze({
            shieldBaseCapacity: 45,
            shieldCapacityPerLevel: 22,
            shieldBaseRechargePerSecond: 5,
            shieldRechargePerLevel: 2.5,
            shieldBaseRechargeDelayMs: 3200,
            shieldDelayReductionPerLevelMs: 350,
            shieldMinimumRechargeDelayMs: 1100,
            shieldHardeningPerLevel: 0.04,
            shieldHardeningMaximum: 0.24,
        }),
        mobilityPlatforms: Object.freeze({
            thrusterBaseBonus: 0.35,
            thrusterSpeedPerLevel: 0.22,
            tractorBaseRadius: 190,
            tractorRadiusPerLevel: 95,
            tractorStrengthPerLevel: 0.055,
            boostBaseDurationMultiplier: 1.35,
            boostDurationPerLevel: 0.18,
            boostSpeedPerLevel: 0.08,
        }),
        quantumPlatforms: Object.freeze({
            missileBaseCount: 2,
            missileBaseDamage: 24,
            missileBaseCooldownMs: 1050,
            missileMinimumCooldownMs: 380,
            missileCooldownPerLevelMs: 85,
            missileBaseSpeed: 6.4,
            missileSpeedPerGuidanceLevel: 0.38,
            missileBaseTurnRate: 0.10,
            missileTurnPerGuidanceLevel: 0.018,
            missileBaseBlastRadius: 58,
            missileWarheadBonusRadius: 34,
            missileBaseBlastDamageRatio: 0.45,
            missileWarheadDamageRatio: 0.68,
            auraBaseDamage: 18,
            auraBaseRadius: 135,
            auraBaseTickMs: 500,
            auraMinimumTickMs: 220,
            auraTickReductionPerLevelMs: 45,
            auraDamagePerLevel: 12,
            auraRadiusPerLevel: 24,
            auraSlowMultiplier: 0.68,
            auraSlowDurationMs: 420,
            auraPulseEveryTicks: 4,
            auraPulseDamageMultiplier: 1.8,
        }),
        cannon: Object.freeze({
            baseShellSpeed: 10.5,
            velocityBonusPerLevel: 0.12,
            baseDamage: 34,
            shellRadius: 7,
            warheadRadius: 96,
            warheadDamageRatio: 0.62,
            clusterCount: 4,
            clusterSpeed: 7.2,
            clusterRadius: 5,
            clusterDamageRatio: 0.28,
            clusterExplosionRadius: 54,
            clusterExplosionDamageRatio: 0.24,
        }),
        explosiveRounds: Object.freeze({
            minimumRadius: 72,
            baseRadius: 42,
            radiusPerLevel: 10,
        }),
    });

    const ENEMY_COLORS = Object.freeze({
        normal: "#ff5c5c",
        runner: "#ffb347",
        brute: "#ff3f8f",
        tank: "#b86bff",
        miniTank: "#d58bff",
        fighter: "#55d7ff",
        carrier: "#7b6cff",
        aegis: "#59b8ff",
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
        explosive:      { label: "PLASMA DETONATION", icon: "●", system: "red", tier: "core", category: "offense", accent: "#ff4e42", description: "Primary rounds gain a consistent fixed-width splash package that does not shrink against small targets.", baseCost: 130, growth: 1.70 },
        cannonUnlock:   { label: "HEAVY CANNON", icon: "◉", system: "red", tier: "core", category: "offense", accent: "#ffc45f", description: "Installs the independent heavy cannon platform and unlocks its dedicated research.", baseCost: 260, growth: 1, maxLevel: 1 },
        cannonDamage:   { label: "CANNON POWER", icon: "▰", system: "red", tier: "core", category: "offense", accent: "#ffd27a", description: "Strengthens the cannon without changing primary or spread weapon damage.", baseCost: 150, growth: 1.58 },
        cannonRate:     { label: "CANNON CYCLE", icon: "⌁", system: "red", tier: "core", category: "offense", accent: "#ffe19a", description: "Reduces the cannon's independent reload delay without changing primary or spread fire.", baseCost: 175, growth: 1.52 },
        cannonVelocity: { label: "CANNON VELOCITY", icon: "➤", system: "red", tier: "core", category: "offense", accent: "#fff0bc", description: "Accelerates heavy shells so impacts arrive faster without changing other weapons.", baseCost: 225, growth: 1.72, maxLevel: 6 },

        shieldGenerator: { label: "SHIELD GENERATOR", icon: "⬡", system: "green", tier: "core", category: "defense", accent: "#62eaff", description: "Installs a rechargeable defensive barrier.", baseCost: 220, growth: 1, maxLevel: 1 },
        shieldCapacity:  { label: "SHIELD CAPACITY", icon: "▰", system: "green", tier: "core", category: "defense", accent: "#70f2ff", description: "Adds more barrier strength.", baseCost: 145, growth: 1.48, maxLevel: 10, requires: { upgrade: "shieldGenerator" } },
        shieldRecharge:  { label: "SHIELD RECHARGE", icon: "↻", system: "green", tier: "core", category: "defense", accent: "#55e8d3", description: "Restores shields faster.", baseCost: 165, growth: 1.52, maxLevel: 8, requires: { upgrade: "shieldGenerator" } },
        shieldDelay:     { label: "RECHARGE DELAY", icon: "⌁", system: "green", tier: "core", category: "defense", accent: "#7affc0", description: "Recharge begins sooner after impact.", baseCost: 175, growth: 1.55, maxLevel: 6, requires: { upgrade: "shieldGenerator" } },
        shieldHardening: { label: "SHIELD HARDENING", icon: "◆", system: "green", tier: "advanced", category: "defense", accent: "#a5ffe0", description: "Shields absorb damage more efficiently.", baseCost: 430, growth: 1.62, maxLevel: 6, requires: { upgrade: "shieldGenerator" } },
        maxHealth:      { label: "REINFORCED HULL", icon: "♥", system: "green", tier: "core", category: "defense", accent: "#55e889", description: "Adds hull integrity and repairs damage.", baseCost: 140, growth: 1.25 },
        healthRegen:    { label: "REPAIR SWARM", icon: "+", system: "green", tier: "core", category: "defense", accent: "#6dff9c", description: "Repairs hull after avoiding damage.", baseCost: 155, growth: 1.38 },
        lifeSteal:      { label: "SALVAGE NANITES", icon: "♦", system: "green", tier: "core", category: "defense", accent: "#4fe584", description: "Weapon hits recover hull fragments.", baseCost: 250, growth: 1.55 },

        thrusterPackage: { label: "THRUSTER PACKAGE", icon: "⚡", system: "blue", tier: "core", category: "utility", accent: "#5cb8ff", description: "Installs enhanced anti-gravity thrusters.", baseCost: 190, growth: 1, maxLevel: 1 },
        speed:          { label: "THRUSTER OUTPUT", icon: "»", system: "blue", tier: "core", category: "utility", accent: "#72c8ff", description: "Raises movement speed and handling.", baseCost: 95, growth: 1.38, maxLevel: 10, requires: { upgrade: "thrusterPackage" } },
        tractorBeam:    { label: "TRACTOR BEAM", icon: "∩", system: "blue", tier: "core", category: "utility", accent: "#69d4ff", description: "Installs a pickup attraction field.", baseCost: 180, growth: 1, maxLevel: 1 },
        magnet:         { label: "TRACTOR RANGE", icon: "◎", system: "blue", tier: "core", category: "utility", accent: "#84e2ff", description: "Pulls pickups from farther away.", baseCost: 105, growth: 1.45, maxLevel: 10, requires: { upgrade: "tractorBeam" } },
        boostSystem:    { label: "BOOSTER SYSTEM", icon: "↟", system: "blue", tier: "core", category: "utility", accent: "#4fb8ff", description: "Improves temporary speed pickups.", baseCost: 210, growth: 1, maxLevel: 1, requires: { upgrade: "thrusterPackage" } },
        boostDuration:  { label: "BOOST DURATION", icon: "⌛", system: "blue", tier: "core", category: "utility", accent: "#63d7ff", description: "Keeps speed boosts active longer.", baseCost: 135, growth: 1.48, maxLevel: 8, requires: { upgrade: "boostSystem" } },
        boostPower:     { label: "BOOST POWER", icon: "➤", system: "blue", tier: "core", category: "utility", accent: "#8de9ff", description: "Raises boosted movement speed.", baseCost: 155, growth: 1.52, maxLevel: 8, requires: { upgrade: "boostSystem" } },

        autoMissile:       { label: "QUANTUM MISSILE BAY", icon: "➹", system: "purple", tier: "core", category: "special", accent: "#c675ff", description: "Installs an autonomous two-missile launch platform and unlocks dedicated missile research.", baseCost: 240, growth: 1, maxLevel: 1 },
        missilePayload:    { label: "MISSILE PAYLOAD", icon: "◆", system: "purple", tier: "core", category: "special", accent: "#d18cff", description: "Increases direct and explosive damage for the independent missile platform.", baseCost: 155, growth: 1.52, requires: { upgrade: "autoMissile" } },
        missileMagazine:   { label: "EXPANDED MAGAZINE", icon: "✦", system: "purple", tier: "core", category: "special", accent: "#ca7dff", description: "Adds another autonomous missile to every launch cycle.", baseCost: 190, growth: 1.62, maxLevel: 8, requires: { upgrade: "autoMissile" } },
        missileFabricator: { label: "FASTER FABRICATORS", icon: "⌁", system: "purple", tier: "core", category: "special", accent: "#b96fff", description: "Reduces the missile bay's independent manufacturing and launch delay.", baseCost: 175, growth: 1.55, maxLevel: 8, requires: { upgrade: "autoMissile" } },
        missileGuidance:   { label: "QUANTUM GUIDANCE", icon: "⌖", system: "purple", tier: "core", category: "special", accent: "#e0b0ff", description: "Improves missile speed, turn authority, and target reacquisition.", baseCost: 205, growth: 1.58, maxLevel: 6, requires: { upgrade: "autoMissile" } },

        damageAura:        { label: "ORBITAL FIELD GENERATOR", icon: "◎", system: "purple", tier: "core", category: "special", accent: "#aa78ff", description: "Installs a persistent close-range Quantum field and unlocks dedicated field research.", baseCost: 225, growth: 1, maxLevel: 1 },
        auraPower:         { label: "FIELD DENSITY", icon: "◉", system: "purple", tier: "core", category: "special", accent: "#b88cff", description: "Raises the damage applied by each orbital-field pulse.", baseCost: 150, growth: 1.48, requires: { upgrade: "damageAura" } },
        auraRadius:        { label: "FIELD RESONANCE", icon: "◌", system: "purple", tier: "core", category: "special", accent: "#a978ff", description: "Expands the orbital field's effective radius.", baseCost: 170, growth: 1.52, maxLevel: 8, requires: { upgrade: "damageAura" } },
        auraCycle:         { label: "FIELD CYCLING", icon: "≋", system: "purple", tier: "core", category: "special", accent: "#c69cff", description: "Shortens the interval between independent field pulses.", baseCost: 185, growth: 1.56, maxLevel: 7, requires: { upgrade: "damageAura" } },

        riftPower:      { label: "RIFT INTENSITY", icon: "◌", system: "purple", tier: "core", category: "special", accent: "#7ee7ff", description: "Raises the damage of Quantum Rift event horizons.", baseCost: 210, growth: 1.52 },
        riftFrequency:  { label: "RIFT CASCADE", icon: "⌁", system: "purple", tier: "core", category: "special", accent: "#9bcfff", description: "Rifts open faster and remain active longer.", baseCost: 245, growth: 1.58 },

        adaptivePlating: { label: "ADAPTIVE PLATING", icon: "⬢", system: "green", tier: "advanced", category: "defense", accent: "#52f18b", description: "Advanced nanobots reduce all incoming damage by 10%.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "green", investment: 3 } },
        combatNanobots: { label: "COMBAT NANOBOTS", icon: "✚", system: "green", tier: "experimental", category: "defense", accent: "#33ff77", description: "Repair delay shortens and regeneration becomes stronger.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "green", investment: 6, upgrade: "adaptivePlating" } },
        livingColony: { label: "LIVING COLONY", icon: "♧", system: "green", tier: "capstone", category: "defense", accent: "#9dffbd", description: "Overhealing becomes a renewable nanobot shield.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "green", investment: 9, upgrade: "combatNanobots" } },

        predictiveTargeting: { label: "PREDICTIVE TARGETING", icon: "⌖", system: "red", tier: "advanced", category: "offense", accent: "#ff705f", description: "Weapon AI increases damage and projectile velocity.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "red", investment: 3 } },
        heatManagement: { label: "HEAT MANAGEMENT", icon: "≋", system: "red", tier: "experimental", category: "offense", accent: "#ff9c54", description: "Reduces the minimum delay between automatic volleys.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "red", investment: 6, upgrade: "predictiveTargeting" } },
        autonomousArsenal: { label: "AUTONOMOUS ARSENAL", icon: "✺", system: "red", tier: "capstone", category: "offense", accent: "#ffd0c7", description: "Every fifth volley automatically deploys two bonus rounds.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "red", investment: 9, upgrade: "heatManagement" } },

        cannonWarhead: { label: "EXPLOSIVE WARHEAD", icon: "✹", system: "red", tier: "advanced", category: "offense", accent: "#ffb45f", description: "Cannon impacts detonate with a consistent 96px blast width, independent of enemy size.", baseCost: 520, growth: 1, maxLevel: 1, requires: { system: "red", investment: 4, upgrade: "cannonUnlock" } },
        cannonCluster: { label: "FOUR-ROUND DISPERSAL", icon: "✣", system: "red", tier: "experimental", category: "offense", accent: "#ff8f5f", description: "Each cannon impact ejects four explosive sub-rounds in a cross-pattern around the hit.", baseCost: 920, growth: 1, maxLevel: 1, requires: { system: "red", investment: 7, upgrade: "cannonWarhead" } },
        cannonQuantum: { label: "QUANTUM-INFUSED ROUNDS", icon: "◈", system: "red", tier: "capstone", category: "offense", accent: "#bca7ff", description: "Cannon shells, warheads, and dispersal rounds convert to Quantum damage.", baseCost: 1580, growth: 1, maxLevel: 1, requires: { system: "red", investment: 10, upgrade: "cannonCluster" } },

        boostCapacitor: { label: "BOOST CAPACITOR", icon: "↟", system: "blue", tier: "advanced", category: "utility", accent: "#59c8ff", description: "Speed pickups last 50% longer and permanent speed rises.", baseCost: 420, growth: 1, maxLevel: 1, requires: { system: "blue", investment: 3 } },
        inertialDampeners: { label: "INERTIAL DAMPENERS", icon: "◈", system: "blue", tier: "experimental", category: "utility", accent: "#76ddff", description: "Improves handling and weakens hostile slowing effects.", baseCost: 760, growth: 1, maxLevel: 1, requires: { system: "blue", investment: 6, upgrade: "boostCapacitor" } },
        zeroPointReactor: { label: "ZERO-POINT REACTOR", icon: "◉", system: "blue", tier: "capstone", category: "utility", accent: "#c4f4ff", description: "Massively improves speed and gravity-lens reach.", baseCost: 1350, growth: 1, maxLevel: 1, requires: { system: "blue", investment: 9, upgrade: "inertialDampeners" } },

        combatHeuristics: { label: "HEAVY QUANTUM WARHEADS", icon: "◇", system: "purple", tier: "advanced", category: "special", accent: "#bd78ff", description: "Missile impacts gain a larger blast and convert more payload energy into splash damage.", baseCost: 520, growth: 1, maxLevel: 1, requires: { system: "purple", investment: 4, upgrade: "autoMissile" } },
        swarmMatrix: { label: "ENTROPIC FIELD", icon: "✧", system: "purple", tier: "experimental", category: "special", accent: "#d192ff", description: "Enemies inside the orbital field are slowed while repeated pulses destabilize them.", baseCost: 900, growth: 1, maxLevel: 1, requires: { system: "purple", investment: 7, upgrade: "damageAura" } },
        distributedConsciousness: { label: "DISTRIBUTED CONSCIOUSNESS", icon: "✣", system: "purple", tier: "capstone", category: "special", accent: "#efd6ff", description: "Missile targeting coordinates across the swarm and every fourth orbital pulse erupts with amplified Quantum damage.", baseCost: 1550, growth: 1, maxLevel: 1, requires: { system: "purple", investment: 11, upgrades: ["combatHeuristics", "swarmMatrix"] } },

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
