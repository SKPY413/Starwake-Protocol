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
        const shieldEnabled = player.maxShield > 0;
        const shieldPercent = shieldEnabled ? clamp(player.shield / player.maxShield, 0, 1) : 0;
        if (ui.playerShieldBarWrap) ui.playerShieldBarWrap.hidden = !shieldEnabled;
        if (ui.playerShieldBar) ui.playerShieldBar.style.width = `${shieldPercent * 100}%`;
        if (ui.playerShieldText) ui.playerShieldText.textContent = shieldEnabled ? `${Math.max(0, Math.floor(player.shield))} / ${Math.floor(player.maxShield)}` : "";
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
            updateBullets(now);
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
