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
    // Reconstruction undo history is scoped to the current upgrade-menu visit.
    // Every committed choice pushes a snapshot, allowing the player to walk all
    // the way back to the state in which the menu opened without rewinding combat.
    const reconstructionUndoStack = [];

    function captureReconstructionSnapshot(label) {
        reconstructionUndoStack.push({
            label,
            player: { ...player },
            upgradeLevels: { ...upgradeLevels },
            upgradePoints: state.upgradePoints,
            waveResearch: { ...waveResearch },
            relicResearch: structuredClone(relicResearch),
            nextWaveSpeedBoostMs: state.nextWaveSpeedBoostMs,
            weaponLabel: ui.weapon?.textContent ?? "",
        });
        updateUndoUpgradeButton();
    }

    function clearReconstructionUndo() {
        reconstructionUndoStack.length = 0;
        updateUndoUpgradeButton();
    }

    function updateUndoUpgradeButton() {
        if (!ui.undoUpgradeButton) return;
        const latest = reconstructionUndoStack.at(-1);
        ui.undoUpgradeButton.disabled = !latest;
        ui.undoUpgradeButton.textContent = latest
            ? `Undo: ${latest.label} (${reconstructionUndoStack.length} left)`
            : "Undo Choices";
    }

    function restoreWaveResearchUI() {
        const panel = document.querySelector(".wave-research-panel");
        panel?.classList.toggle("claimed", waveResearch.claimed);
        renderRelicResearchChoices();
    }

    function undoLastReconstructionAction() {
        const snapshot = reconstructionUndoStack.pop();
        if (!snapshot) return;

        // Refresh immediately after popping so the button always describes the
        // new top of the stack, even if a later UI renderer encounters an error.
        updateUndoUpgradeButton();

        try {
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
            playSound("pickup");
        } finally {
            // Some reconstruction renderers rebuild portions of the menu. Run
            // once more after rendering, then once on the next microtask, so the
            // visible label cannot remain stuck on the action just reversed.
            updateUndoUpgradeButton();
            queueMicrotask(updateUndoUpgradeButton);
        }
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
        updateRelicRequirementUI();
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
    function beginBossWarning(nextWave) {
        const giga = nextWave % 20 === 0;
        state.paused = true;
        ui.waveClearOverlay.style.opacity = 0.9;
        ui.waveClearTitle.textContent = giga ? "ANCHOR CONVERGENCE" : "UNKNOWN SIGNAL DETECTED";
        ui.waveClearSubtext.textContent = giga ? "FINAL ASSEMBLY IN PROGRESS" : `MILESTONE GUARDIAN ${Math.floor(nextWave / 10)} APPROACHING`;
        ui.waveClearMessage.classList.add("active");
        addScreenShake(giga ? 22 : 12);
        playSound("bossSpawn");
        setTimeout(() => {
            if (state.ended) return;
            ui.waveClearOverlay.style.opacity = 0;
            ui.waveClearMessage.classList.remove("active");
            state.paused = false;
            resumeAudio();
        }, giga ? 4200 : 3200);
    }

    function startNextWave() {
        if (!waveResearch.claimed) {
            updateRelicRequirementUI();
            document.querySelector(".wave-research-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
            playSound("harmPickup");
            return;
        }
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
        playerDamageTotals.weapon = 0;
        playerDamageTotals.quantum = 0;
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
        if (isBossWave()) beginBossWarning(state.wave);
        else resumeAudio();
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
        enemyBullets.length = 0;
        carrierMissiles.length = 0;
        particles.length = 0;
        explosions.length = 0;
        damageNumbers.length = 0;
        lifeStealOrbs.length = 0;
        relicRifts.length = 0;
        relicDrones.length = 0;
        playerDamageTotals.weapon = 0;
        playerDamageTotals.quantum = 0;
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
        playerDamageTotals.weapon = 0;
        playerDamageTotals.quantum = 0;

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
