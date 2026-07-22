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
        cannonDamage: 0,
        cannonFireRate: 1200,
        cannonVelocity: 0,
        lastCannonShotAt: 0,
        speedBoostUntil: 0,
        weaponBoostUntil: 0,
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
            name: "VERDANT AEGIS",
            hint: "The hull remembers how to remain whole.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "VERDANT AEGIS ONLINE", description: "The relic reinforces maximum hull, creates a rechargeable shield, and performs periodic emergency repairs.", next: "Resonant research strengthens shield capacity, healing, and recharge frequency." },
                { title: "VERDANT AEGIS — RESONANT", description: "Hull reinforcement and shield recovery become substantially stronger.", next: "Ascendant research completes the defensive lattice." },
                { title: "VERDANT AEGIS — ASCENDANT", description: "The ship reaches the relic's highest known health, shield, and self-repair configuration.", next: "Further fragments refine defensive efficiency." },
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
            name: "MOMENTUM VEIL",
            hint: "Defeated signals leave motion behind.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "HIDDEN OVERDRIVE DROPS ONLINE", description: "Enemies can release concealed overdrive fragments that boost both movement speed and weapon cycle speed.", next: "Resonant research improves drop rate, duration, and end-of-wave pickup reach." },
                { title: "MOMENTUM VEIL — RESONANT", description: "Overdrive fragments appear more often, last longer, and are drawn from farther away after a wave ends.", next: "Ascendant research completes the momentum recovery system." },
                { title: "MOMENTUM VEIL — ASCENDANT", description: "Hidden boost drops and end-of-wave collection reach reach their highest known efficiency.", next: "Further fragments refine overdrive frequency and duration." },
            ],
        },
        relic_purple_01: {
            system: "purple",
            name: "RIFT TEARER",
            hint: "The system opens where reality is weakest.",
            thresholds: [5, 10, 15],
            reveals: [
                { title: "RIFT TEARER ONLINE", description: "Unstable rifts open around the ship and repeatedly damage enemies that cross their event horizons.", next: "Resonant research adds rifts, increases their size, and intensifies their damage." },
                { title: "RIFT TEARER — RESONANT", description: "More persistent tears surround the ship with wider and more destructive event horizons.", next: "Ascendant research pushes local space toward controlled collapse." },
                { title: "RIFT TEARER — ASCENDANT", description: "The rift array reaches its highest known count, radius, duration, and damage output.", next: "Further fragments refine spatial instability." },
            ],
        },
    });

    const relicResearch = Object.fromEntries(Object.keys(RELIC_DEFINITIONS).map(id => [id, {
        stage: 0,
        progress: 0,
        awakened: false,
    }]));

    const relicOrbs = []; // retained for save compatibility; no longer used by Verdant Aegis
    const relicDrones = []; // retained for save compatibility; replaced by Rift Tearer
    const relicLaser = { nextAt: 0, activeUntil: 0, angle: 0, hitIds: new Set() };
    const relicPulse = { nextAt: 0, visualUntil: 0, radius: 0 }; // retained for compatibility
    const relicGreen = { nextRepairAt: 0, appliedStage: 0 };
    const relicRifts = [];
    let nextRelicRiftAt = 0;
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
        updateRelicRequirementUI();
        updateUI();
        writeValidatedSave("relic research");
    }

    function updateRelicRequirementUI() {
        const nextButton = document.getElementById("skipUpgradeButton");
        const status = document.getElementById("upgradeSaveStatus");
        if (nextButton) {
            nextButton.disabled = !waveResearch.claimed;
            nextButton.textContent = waveResearch.claimed ? "Begin Next Wave" : "Select a Relic First";
            nextButton.setAttribute("aria-disabled", String(!waveResearch.claimed));
        }
        if (status && !waveResearch.claimed) status.textContent = "A relic fragment must be assigned before reconstruction can continue.";
        else if (status && status.textContent.includes("relic fragment")) status.textContent = "Relic fragment assigned. Next wave unlocked.";
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
    let carrierGlobalNextLaunchAt = 0;
    const enemies = [];
    const explosions = [];
    const pickups = [];
    const pointOrbs = [];
    const lifeStealOrbs = [];
    const particles = [];
    const damageNumbers = [];

    // Player damage uses exactly two gameplay types: Weapon and Quantum.
    // All damaging Quantum upgrades and the Rift relic share Quantum damage.
    const PLAYER_DAMAGE_STYLE = Object.freeze({
        weapon: Object.freeze({
            color: "#fff0c2",
            outline: "rgba(92,35,8,0.92)",
            startScale: 1.78,
            settleScale: 0.94,
            drift: "punch",
        }),
        quantum: Object.freeze({
            color: "#72e8ff",
            outline: "rgba(8,45,74,0.96)",
            startScale: 1.82,
            settleScale: 0.92,
            drift: "quantum",
        }),
    });

    const playerDamageTotals = {
        weapon: 0,
        quantum: 0,
    };
    const backgroundPanels = [];
    const backgroundStars = [];
    const backgroundBossFragments = [];

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
