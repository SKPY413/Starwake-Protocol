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


    // -------------------------------------------------------------------------
    // Defensive, versioned persistence
    // -------------------------------------------------------------------------
    const SAVE_SCHEMA_VERSION = 2;
    const SAVE_BUILD = "Pre-Beta Animated Seal";
    const SAVE_KEYS = Object.freeze({
        main: "starwake_save_main",
        temp: "starwake_save_temp",
        backups: ["starwake_save_backup_1", "starwake_save_backup_2", "starwake_save_backup_3"],
        activity: "starwake_save_activity_log",
    });
    // Hard cap for Starwake's protected save slots. 256 KiB keeps the browser
    // footprint predictable while leaving ample room for future schema growth.
    const SAVE_STORAGE_LIMIT_BYTES = 256 * 1024;
    const SAVE_ACTIVITY_MAX_ENTRIES = 40;
    const SAVE_ACTIVITY_MAX_BYTES = 24 * 1024;
    const SAVE_PLAYER_FIELDS = Object.freeze([
        "x","y","r","speed","health","maxHealth","damage","fireRate","bulletSpeed","bulletsPerShot","weaponBoostUntil",
        "cannonDamage","cannonFireRate","cannonVelocity","lastCannonShotAt",
        "explosiveLevel","explosiveRadius","explosiveDamageRatio","pointMagnetRadius","pointMagnetStrength",
        "missileLevel","missileCount","missileDamage","missileCooldown","auraLevel","auraDamage","auraRadius",
        "auraTickRate","regenLevel","regenAmount","regenPerSecond","regenTickRate","regenDelayAfterDamage",
        "lifeStealLevel","lifeStealAmount","damageReduction","shield","maxShield","boostDurationMultiplier",
        "slowResistance","autonomousDamageMultiplier","autonomousArsenal","volleyCounter","adaptiveHull","livingDrones"
    ]);

    function saveChecksum(text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function canonicalSavePayload(envelope) {
        return JSON.stringify({ schemaVersion: envelope.schemaVersion, build: envelope.build, savedAt: envelope.savedAt, data: envelope.data });
    }

    function makeSaveEnvelope(data) {
        const envelope = { schemaVersion: SAVE_SCHEMA_VERSION, build: SAVE_BUILD, savedAt: new Date().toISOString(), data };
        envelope.checksum = saveChecksum(canonicalSavePayload(envelope));
        return envelope;
    }

    function parseAndValidateSave(raw) {
        if (!raw || typeof raw !== "string") return { valid: false, reason: "Empty save slot" };
        let envelope;
        try { envelope = JSON.parse(raw); } catch { return { valid: false, reason: "Malformed JSON" }; }
        if (!envelope || typeof envelope !== "object") return { valid: false, reason: "Invalid save envelope" };
        if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) return { valid: false, reason: "Missing schema version" };
        if (envelope.schemaVersion > SAVE_SCHEMA_VERSION) return { valid: false, reason: "Save is from a newer build" };
        if (!envelope.data || typeof envelope.data !== "object") return { valid: false, reason: "Missing save payload" };
        if (envelope.checksum !== saveChecksum(canonicalSavePayload(envelope))) return { valid: false, reason: "Integrity check failed" };
        const run = envelope.data.run;
        if (!run || typeof run !== "object") return { valid: false, reason: "Missing run data" };
        if (!Number.isFinite(run.wave) || run.wave < 1 || run.wave > 100000) return { valid: false, reason: "Impossible wave value" };
        if (!Number.isFinite(run.score) || run.score < 0) return { valid: false, reason: "Impossible score value" };
        if (!DIFFICULTY_DATA[run.difficulty]) return { valid: false, reason: "Unknown difficulty" };
        if (run.phase != null && run.phase !== "combat" && run.phase !== "upgrade") return { valid: false, reason: "Unknown run phase" };
        return { valid: true, envelope: migrateSave(envelope) };
    }

    function migrateSave(envelope) {
        // Future migrations are applied sequentially here. Never mutate the original
        // object without first cloning it; imported files are untrusted input.
        const migrated = structuredClone(envelope);
        while (migrated.schemaVersion < SAVE_SCHEMA_VERSION) {
            if (migrated.schemaVersion === 1) {
                // Schema 2 records whether the player saved during combat or
                // during post-wave reconstruction. Legacy saves resume combat.
                migrated.data.run.phase = "combat";
            }
            migrated.schemaVersion++;
        }
        migrated.checksum = saveChecksum(canonicalSavePayload(migrated));
        return migrated;
    }

    function capturePersistentData() {
        const playerData = {};
        for (const field of SAVE_PLAYER_FIELDS) playerData[field] = player[field];
        return {
            profile: {
                sealStage: "pre-beta",
                lifetimeStats: { highestWave: Math.max(state.wave, Number(safeStorage.get("starwakeHighestWave", 1)) || 1) },
            },
            run: {
                active: Boolean(state.started && !state.ended),
                phase: ui.upgradeMenu?.style.display === "flex" ? "upgrade" : "combat",
                wave: state.wave, score: state.score,
                upgradePoints: state.upgradePoints, difficulty: state.difficulty,
                nextWaveSpeedBoostMs: state.nextWaveSpeedBoostMs || 0,
                player: playerData, upgradeLevels: { ...upgradeLevels },
                relicResearch: structuredClone(relicResearch), waveResearch: { ...waveResearch },
                weaponLabel: ui.weapon?.textContent || "Standard",
            },
            settings: {
                cursorColor: safeStorage.get("starwakeCursorColor", "#7cffd4"),
                masterVolume: Number(safeStorage.get("starwakeMasterVolume", 78)),
                musicVolume: Number(safeStorage.get("starwakeMusicVolume", 82)),
                sfxVolume: Number(safeStorage.get("starwakeSfxVolume", 92)),
                audioEnabled: safeStorage.get("starwakeAudioEnabled", "true") !== "false",
            },
        };
    }

    function rawStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
    function rawStorageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { console.warn("Save write failed", e); return false; } }
    function rawStorageRemove(key) { try { localStorage.removeItem(key); } catch {} }

    function readSaveActivity() {
        const raw = rawStorageGet(SAVE_KEYS.activity);
        if (!raw) return [];
        try {
            const entries = JSON.parse(raw);
            return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry === "object") : [];
        } catch {
            return [];
        }
    }

    function writeSaveActivity(entries) {
        let trimmed = entries.slice(0, SAVE_ACTIVITY_MAX_ENTRIES);
        let serialized = JSON.stringify(trimmed);
        while (trimmed.length > 1 && utf8Bytes(serialized) > SAVE_ACTIVITY_MAX_BYTES) {
            trimmed.pop();
            serialized = JSON.stringify(trimmed);
        }
        return rawStorageSet(SAVE_KEYS.activity, serialized);
    }

    function logSaveActivity(type, outcome, message, details = {}) {
        const entries = readSaveActivity();
        entries.unshift({
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            at: new Date().toISOString(),
            type, outcome, message,
            wave: Number.isFinite(details.wave) ? details.wave : (state?.wave || null),
            reason: details.reason || null,
            slot: details.slot || null,
        });
        writeSaveActivity(entries);
        if (!document.getElementById("saveInspectorPanel")?.hidden) renderSaveActivityLog();
    }

    function utf8Bytes(value) {
        return new TextEncoder().encode(value || "").byteLength;
    }

    function saveStorageUsageBytes() {
        return [SAVE_KEYS.main, SAVE_KEYS.temp, ...SAVE_KEYS.backups, SAVE_KEYS.activity]
            .reduce((total, key) => total + utf8Bytes(rawStorageGet(key)), 0);
    }

    function enforceSaveStorageBudget(incomingBytes = 0) {
        // The oldest backup is expendable first. Main and temporary slots are
        // never pruned silently; if they alone exceed the cap, the write fails.
        let pruned = 0;
        for (let i = SAVE_KEYS.backups.length - 1;
             i >= 0 && saveStorageUsageBytes() + incomingBytes > SAVE_STORAGE_LIMIT_BYTES;
             i--) {
            if (rawStorageGet(SAVE_KEYS.backups[i])) {
                rawStorageRemove(SAVE_KEYS.backups[i]);
                pruned++;
            }
        }
        if (pruned) logSaveActivity("Storage pruning", "warning", `${pruned} oldest backup cop${pruned === 1 ? "y was" : "ies were"} removed to stay within the 256 KiB limit.`, { reason: "storage-budget" });
        return saveStorageUsageBytes() + incomingBytes <= SAVE_STORAGE_LIMIT_BYTES;
    }

    function formatSaveBytes(bytes) {
        return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
    }

    function writeValidatedSave(reason = "autosave") {
        if (!state.started || state.ended) return false;
        const envelope = makeSaveEnvelope(capturePersistentData());
        const serialized = JSON.stringify(envelope);
        const incomingBytes = utf8Bytes(serialized);
        if (incomingBytes > SAVE_STORAGE_LIMIT_BYTES || !enforceSaveStorageBudget(incomingBytes)) {
            refreshSaveDataPanel(`Save refused: storage budget ${formatSaveBytes(SAVE_STORAGE_LIMIT_BYTES)} exceeded`);
            logSaveActivity(reason === "autosave" ? "Autosave" : "Save", "failed", "Save refused because the protected storage budget would be exceeded.", { reason: "storage-budget" });
            return false;
        }
        if (!rawStorageSet(SAVE_KEYS.temp, serialized)) { logSaveActivity(reason === "autosave" ? "Autosave" : "Save", "failed", "Temporary validation write failed. Existing progress was preserved.", { reason: "temp-write" }); return false; }
        const tempCheck = parseAndValidateSave(rawStorageGet(SAVE_KEYS.temp));
        if (!tempCheck.valid) { rawStorageRemove(SAVE_KEYS.temp); logSaveActivity(reason === "autosave" ? "Autosave" : "Save", "failed", `Temporary validation failed: ${tempCheck.reason}. Existing progress was preserved.`, { reason: tempCheck.reason }); return false; }
        const previousMain = rawStorageGet(SAVE_KEYS.main);
        if (previousMain) {
            const b1 = rawStorageGet(SAVE_KEYS.backups[0]);
            const b2 = rawStorageGet(SAVE_KEYS.backups[1]);
            if (b2) rawStorageSet(SAVE_KEYS.backups[2], b2);
            if (b1) rawStorageSet(SAVE_KEYS.backups[1], b1);
            rawStorageSet(SAVE_KEYS.backups[0], previousMain);
        }
        // Rotation can temporarily increase usage; prune oldest copies until the
        // protected set is back under budget before promoting the new main save.
        if (!enforceSaveStorageBudget()) {
            rawStorageRemove(SAVE_KEYS.temp);
            refreshSaveDataPanel("Save refused: protected slots exceed storage budget");
            logSaveActivity(reason === "autosave" ? "Autosave" : "Save", "failed", "Protected copies could not fit inside the storage budget. Existing progress was preserved.", { reason: "storage-budget" });
            return false;
        }
        if (!rawStorageSet(SAVE_KEYS.main, serialized)) { logSaveActivity(reason === "autosave" ? "Autosave" : "Save", "failed", "Main save write failed. Existing backup copies remain available.", { reason: "main-write" }); return false; }
        rawStorageRemove(SAVE_KEYS.temp);
        safeStorage.set("starwakeHighestWave", Math.max(state.wave, Number(safeStorage.get("starwakeHighestWave", 1)) || 1));
        refreshSaveDataPanel(`Saved (${reason})`);
        const activityType = reason === "autosave" ? "Autosave" : reason === "background" ? "Background save" : reason === "shutdown" ? "Shutdown save" : "Manual save";
        logSaveActivity(activityType, "success", `Wave ${state.wave} was saved and verified.`, { wave: state.wave, reason });
        return true;
    }

    function inspectSaveSlots() {
        const slots = [{ key: SAVE_KEYS.main, label: "Main" }, ...SAVE_KEYS.backups.map((key, i) => ({ key, label: `Backup ${i + 1}` }))];
        return slots.map(slot => ({ ...slot, result: parseAndValidateSave(rawStorageGet(slot.key)) }));
    }

    function newestValidSave() {
        return inspectSaveSlots().filter(s => s.result.valid).sort((a,b) => Date.parse(b.result.envelope.savedAt) - Date.parse(a.result.envelope.savedAt))[0] || null;
    }

    function restoreSaveEnvelope(envelope) {
        const run = envelope.data.run;
        state.wave = Math.max(1, Math.floor(run.wave));
        state.score = Math.max(0, Math.floor(run.score));
        state.upgradePoints = Math.max(0, Math.floor(run.upgradePoints || 0));
        state.difficulty = DIFFICULTY_DATA[run.difficulty] ? run.difficulty : "easy";
        state.nextWaveSpeedBoostMs = Math.max(0, Number(run.nextWaveSpeedBoostMs) || 0);
        for (const field of SAVE_PLAYER_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(run.player || {}, field) && typeof run.player[field] !== "object") player[field] = run.player[field];
        }
        for (const key of Object.keys(upgradeLevels)) upgradeLevels[key] = Math.max(0, Math.floor(run.upgradeLevels?.[key] || 0));
        // Compatibility: builds before the explicit unlock used Cannon Power itself to install the cannon.
        if (!upgradeLevels.cannonUnlock && (player.cannonDamage > 0 || upgradeLevels.cannonDamage > 0)) upgradeLevels.cannonUnlock = 1;
        // Convert legacy penetration investment into velocity so existing saves
        // retain the same number of purchased cannon utility levels.
        if (!upgradeLevels.cannonVelocity && upgradeLevels.cannonPenetration) {
            upgradeLevels.cannonVelocity = upgradeLevels.cannonPenetration;
            delete upgradeLevels.cannonPenetration;
        }
        if (!player.cannonVelocity && player.cannonPenetration) player.cannonVelocity = player.cannonPenetration;
        for (const [id, data] of Object.entries(run.relicResearch || {})) {
            if (relicResearch[id]) Object.assign(relicResearch[id], { progress: Math.max(0, Math.floor(data.progress || 0)), stage: Math.max(0, Math.floor(data.stage || 0)), awakened: Boolean(data.awakened) });
        }
        Object.assign(waveResearch, run.waveResearch || {});
        bullets.length = missiles.length = enemyBullets.length = carrierMissiles.length = enemies.length = explosions.length = pickups.length = pointOrbs.length = lifeStealOrbs.length = particles.length = damageNumbers.length = 0;
        state.enemiesSpawned = 0; state.spawnTimer = 0; state.clearPhaseActive = false; state.ended = false;
        applyDifficultyToWave();
        setDifficulty(state.difficulty);
        if (ui.weapon) ui.weapon.textContent = run.weaponLabel || "Restored";
        if (ui.wave) ui.wave.textContent = state.wave;
        if (ui.score) ui.score.textContent = state.score;
        if (ui.points) ui.points.textContent = state.upgradePoints;
        if (ui.health) ui.health.textContent = `${Math.ceil(player.health)} / ${Math.ceil(player.maxHealth)}`;
        restoreWaveResearchUI(); updateUpgradeButtons();
        state.started = true; state.ended = false; state.manuallyPaused = false;
        ui.splashScreen.style.display = "none"; ui.startMenu.style.display = "none"; ui.gameOverMenu.style.display = "none";

        if (run.phase === "upgrade") {
            // The completed wave stays completed. Reopen reconstruction exactly
            // where the save was made without resetting its offered/claimed state.
            state.musicScene = "upgrade";
            state.paused = true;
            state.clearPhaseActive = false;
            document.body.classList.add("upgrade-menu-open");
            ui.upgradeMenu.style.display = "flex";
            ui.upgradeMenu.scrollTop = 0;
            document.getElementById("upgradeCard")?.scrollTo?.(0, 0);
            clearReconstructionUndo();
            restoreWaveResearchUI();
            updateUpgradeButtons();
            refreshSaveDataPanel("Reconstruction save restored — cleared wave preserved");
        } else {
            state.musicScene = "combat";
            state.paused = false;
            ui.upgradeMenu.style.display = "none";
            document.body.classList.remove("upgrade-menu-open");
            try { resumeAudio(); } catch {}
            refreshSaveDataPanel("Combat save restored successfully");
        }
    }

    function exportSaveFile() {
        let slot = newestValidSave();
        if (!slot && state.started && !state.ended) { writeValidatedSave("manual export"); slot = newestValidSave(); }
        if (!slot) { setSaveStatus("No valid save exists to export.", "bad"); return; }
        const blob = new Blob([JSON.stringify(slot.result.envelope, null, 2)], { type: "application/json" });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
        link.download = `starwake-save-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        setSaveStatus("Save exported. Keep it somewhere outside the game folder.", "good");
        logSaveActivity("Export", "success", `A verified Wave ${slot.result.envelope.data.run.wave} save was exported.`, { wave: slot.result.envelope.data.run.wave });
    }

    function rotateSaveBackups(previousMain) {
        if (!previousMain) return;
        const b1 = rawStorageGet(SAVE_KEYS.backups[0]);
        const b2 = rawStorageGet(SAVE_KEYS.backups[1]);
        if (b2) rawStorageSet(SAVE_KEYS.backups[2], b2);
        if (b1) rawStorageSet(SAVE_KEYS.backups[1], b1);
        rawStorageSet(SAVE_KEYS.backups[0], previousMain);
    }

    async function importSaveFile(file) {
        if (!file) return;
        let text;
        try { text = await file.text(); }
        catch { setSaveStatus("Import failed: the selected file could not be read.", "bad"); logSaveActivity("Import", "failed", "The selected file could not be read. Existing saves were unchanged.", { reason: "file-read" }); return; }
        const result = parseAndValidateSave(text);
        if (!result.valid) { setSaveStatus(`Import rejected: ${result.reason}. Your existing saves were not changed.`, "bad"); logSaveActivity("Import", "failed", `Import rejected: ${result.reason}. Existing saves were unchanged.`, { reason: result.reason }); return; }
        const serialized = JSON.stringify(result.envelope);
        const importBytes = utf8Bytes(serialized);
        if (importBytes > SAVE_STORAGE_LIMIT_BYTES || !enforceSaveStorageBudget(importBytes)) {
            setSaveStatus(`Import rejected: save data exceeds the ${formatSaveBytes(SAVE_STORAGE_LIMIT_BYTES)} storage budget. Existing saves were not changed.`, "bad");
            return;
        }
        const current = rawStorageGet(SAVE_KEYS.main);
        rotateSaveBackups(current);
        enforceSaveStorageBudget();
        if (!rawStorageSet(SAVE_KEYS.main, serialized)) {
            setSaveStatus("Import failed while writing storage. Your previous main save remains in Backup 1.", "bad");
            return;
        }
        const installed = parseAndValidateSave(rawStorageGet(SAVE_KEYS.main));
        if (!installed.valid) {
            if (current) rawStorageSet(SAVE_KEYS.main, current);
            setSaveStatus("Import failed final verification. The previous main save was restored.", "bad");
            return;
        }
        const run = installed.envelope.data.run;
        refreshSaveDataPanel(`Imported save verified · Wave ${run.wave}.`);
        logSaveActivity("Import", "success", `Imported save verified and installed at Wave ${run.wave}.`, { wave: run.wave });
    }

    function setSaveStatus(message, level = "") {
        const status = document.getElementById("saveDataStatus"); if (status) { status.textContent = message; status.dataset.level = level; }
    }

    function calculateSaveIntegrity(slots) {
        const main = slots[0];
        const validCount = slots.filter(slot => slot.result.valid).length;
        let score = 0;
        if (main.result.valid) score += 65;
        else if (validCount > 0) score += 35;
        score += Math.min(30, Math.max(0, validCount - (main.result.valid ? 1 : 0)) * 10);
        const newest = slots.filter(slot => slot.result.valid)
            .sort((a,b) => Date.parse(b.result.envelope.savedAt) - Date.parse(a.result.envelope.savedAt))[0];
        if (newest?.result.envelope.schemaVersion === SAVE_SCHEMA_VERSION) score += 5;
        return Math.min(100, score);
    }

    function renderSaveInspector() {
        const panel = document.getElementById("saveInspectorPanel");
        if (!panel) return;
        const slots = inspectSaveSlots();
        const valid = slots.filter(slot => slot.result.valid);
        const main = slots[0];
        const newest = valid.slice().sort((a,b) => Date.parse(b.result.envelope.savedAt) - Date.parse(a.result.envelope.savedAt))[0] || null;
        const score = calculateSaveIntegrity(slots);
        if (main.result.valid) setSaveHealthSeal(valid.length >= 2 ? "healthy" : "warning");
        else if (newest) setSaveHealthSeal("recovery");
        else setSaveHealthSeal(main.result.reason === "Empty save slot" ? "checking" : "invalid");
        const meter = document.getElementById("saveIntegrityMeter");
        const percent = document.getElementById("saveIntegrityPercent");
        const reassurance = document.getElementById("saveInspectorReassurance");
        const details = document.getElementById("saveInspectorDetails");
        const list = document.getElementById("saveSlotList");
        const advice = document.getElementById("saveInspectorAdvice");

        if (meter) {
            meter.style.setProperty("--integrity", `${score}%`);
            meter.setAttribute("aria-valuenow", String(score));
        }
        if (percent) percent.textContent = `${score}%`;

        if (reassurance) {
            if (main.result.valid && valid.length >= 3) reassurance.textContent = "Your progress is healthy and protected by multiple verified copies.";
            else if (main.result.valid) reassurance.textContent = "Your main save is healthy. More backups will be created as you continue playing.";
            else if (newest) reassurance.textContent = "Your main save needs attention, but a healthy recovery copy is available.";
            else reassurance.textContent = "No healthy save was found. Starting a run or importing an export will create one.";
        }

        if (details) {
            const envelope = newest?.result.envelope;
            const run = envelope?.data.run;
            const rows = [
                ["Status", main.result.valid ? "Healthy" : newest ? "Recovery available" : "No valid save"],
                ["Saved", envelope ? new Date(envelope.savedAt).toLocaleString() : "—"],
                ["Wave", run ? String(run.wave) : "—"],
                ["Difficulty", run ? (DIFFICULTY_DATA[run.difficulty]?.label || run.difficulty) : "—"],
                ["Build", envelope?.build || "—"],
                ["Schema", envelope ? `${envelope.schemaVersion} / ${SAVE_SCHEMA_VERSION}` : `— / ${SAVE_SCHEMA_VERSION}`],
                ["Storage", `${formatSaveBytes(saveStorageUsageBytes())} / ${formatSaveBytes(SAVE_STORAGE_LIMIT_BYTES)}`],
                ["Protected copies", `${valid.length} of ${slots.length}`],
                ["Checksum", envelope?.checksum ? "Verified" : "—"],
            ];
            details.replaceChildren(...rows.map(([label,value]) => {
                const wrapper = document.createElement("div");
                const dt = document.createElement("dt");
                const dd = document.createElement("dd");
                dt.textContent = label; dd.textContent = value;
                wrapper.append(dt,dd); return wrapper;
            }));
        }

        if (list) {
            list.replaceChildren(...slots.map(slot => {
                const card = document.createElement("div");
                const validSlot = slot.result.valid;
                const empty = slot.result.reason === "Empty save slot";
                card.className = `save-slot-card ${validSlot ? "good" : empty ? "empty" : "bad"}`;
                const name = document.createElement("strong"); name.textContent = slot.label;
                const description = document.createElement("span");
                const stateLabel = document.createElement("em");
                if (validSlot) {
                    const run = slot.result.envelope.data.run;
                    description.textContent = `Wave ${run.wave} · ${new Date(slot.result.envelope.savedAt).toLocaleString()}`;
                    stateLabel.textContent = "Healthy";
                } else {
                    description.textContent = empty ? "No copy stored yet" : slot.result.reason;
                    stateLabel.textContent = empty ? "Empty" : "Invalid";
                }
                card.append(name, description, stateLabel); return card;
            }));
        }

        renderSaveActivityLog();

        if (advice) {
            if (score === 100) advice.textContent = "Everything looks good. Four validated copies are available, so no action is needed.";
            else if (main.result.valid && valid.length < 4) advice.textContent = "No progress is in danger. Continue playing or use Save Game to build additional recovery copies.";
            else if (newest) advice.textContent = "Your progress is still recoverable. Use Recovery to promote the newest healthy backup to the main slot.";
            else advice.textContent = "No existing progress will be deleted. You can begin a new run or import a previously exported save.";
        }
    }

    function renderSaveActivityLog() {
        const list = document.getElementById("saveActivityList");
        const empty = document.getElementById("saveActivityEmpty");
        if (!list) return;
        const entries = readSaveActivity().slice(0, 20);
        if (empty) empty.hidden = entries.length > 0;
        list.replaceChildren(...entries.map(entry => {
            const item = document.createElement("li");
            item.className = `save-activity-item ${entry.outcome || ""}`;
            const heading = document.createElement("div");
            const type = document.createElement("strong");
            const time = document.createElement("time");
            type.textContent = entry.type || "Save activity";
            time.dateTime = entry.at || "";
            time.textContent = entry.at ? new Date(entry.at).toLocaleString() : "Unknown time";
            heading.append(type, time);
            const message = document.createElement("p");
            message.textContent = entry.message || "Activity recorded.";
            item.append(heading, message);
            return item;
        }));
    }

    function refreshSaveDataPanel(message = "") {
        const slots = inspectSaveSlots(); const valid = slots.filter(s => s.result.valid); const main = slots[0]; const best = newestValidSave();
        const summary = document.getElementById("saveDataSummary"); const badge = document.getElementById("saveIntegrityBadge");
        const continueButton = document.getElementById("continueSavedRunButton"); const recoverButton = document.getElementById("recoverSaveButton");
        if (continueButton) continueButton.disabled = !best;
        if (recoverButton) recoverButton.disabled = valid.length < 1;
        if (best && summary) {
            const run = best.result.envelope.data.run; summary.textContent = `Wave ${run.wave} · ${DIFFICULTY_DATA[run.difficulty]?.label || run.difficulty} · saved ${new Date(best.result.envelope.savedAt).toLocaleString()}`;
        } else if (summary) summary.textContent = "No recoverable run detected.";
        if (badge) {
            badge.className = "save-integrity-badge";
            if (main.result.valid) { badge.textContent = valid.length > 1 ? `${valid.length} valid copies` : "Main valid"; badge.classList.add("good"); }
            else if (best) { badge.textContent = "Backup available"; badge.classList.add("warn"); }
            else { badge.textContent = "No valid save"; badge.classList.add(main.result.reason === "Empty save slot" ? "" : "bad"); }
        }
        if (message) setSaveStatus(message, "good");
        if (!document.getElementById("saveInspectorPanel")?.hidden) renderSaveInspector();
    }

    function initializePersistenceControls() {
        // Older builds had no explicit budget. Preserve main first, then discard
        // only the oldest backup copies if legacy data exceeds the current cap.
        enforceSaveStorageBudget();
        if (!readSaveActivity().length) logSaveActivity("Save manager", "success", "Save protection initialized. No player progress was changed.");
        document.getElementById("clearSaveActivityButton")?.addEventListener("click", () => {
            rawStorageRemove(SAVE_KEYS.activity);
            logSaveActivity("Save manager", "success", "Older activity history was cleared. Save files were not changed.");
            renderSaveActivityLog();
        });
        document.getElementById("continueSavedRunButton")?.addEventListener("click", () => { const slot = newestValidSave(); if (slot) restoreSaveEnvelope(slot.result.envelope); });
        document.getElementById("saveUpgradeMenuButton")?.addEventListener("click", () => {
            const button = document.getElementById("saveUpgradeMenuButton");
            const status = document.getElementById("upgradeSaveStatus");
            const saved = writeValidatedSave("upgrade menu");
            if (status) {
                status.textContent = saved ? `Saved · Wave ${state.wave}` : "Save unavailable";
                status.dataset.level = saved ? "good" : "bad";
            }
            if (button) {
                const original = "Save Game";
                button.textContent = saved ? "Saved ✓" : "Save Failed";
                window.setTimeout(() => { button.textContent = original; }, 1800);
            }
        });
        document.getElementById("inspectSaveButton")?.addEventListener("click", event => {
            const panel = document.getElementById("saveInspectorPanel");
            if (!panel) return;
            panel.hidden = !panel.hidden;
            event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
            event.currentTarget.textContent = panel.hidden ? "Inspect Saves" : "Hide Inspector";
            if (!panel.hidden) renderSaveInspector();
        });
        document.getElementById("exportSaveButton")?.addEventListener("click", exportSaveFile);
        document.getElementById("importSaveButton")?.addEventListener("click", () => document.getElementById("importSaveFile")?.click());
        document.getElementById("importSaveFile")?.addEventListener("change", event => { importSaveFile(event.target.files?.[0]); event.target.value = ""; });
        document.getElementById("recoverSaveButton")?.addEventListener("click", () => {
            const slots = inspectSaveSlots();
            const main = slots[0];
            const validBackups = slots.slice(1).filter(slot => slot.result.valid)
                .sort((a,b) => Date.parse(b.result.envelope.savedAt) - Date.parse(a.result.envelope.savedAt));
            if (!validBackups.length) {
                if (main.result.valid) setSaveStatus("Your main save is healthy. No valid backup is available or needed.", "good");
                else setSaveStatus("Recovery found no healthy backup. Import an exported save if one is available.", "bad");
                return;
            }
            const chosen = validBackups[0];
            const run = chosen.result.envelope.data.run;
            const savedAt = new Date(chosen.result.envelope.savedAt);
            const mainTime = main.result.valid ? Date.parse(main.result.envelope.savedAt) : NaN;
            const backupTime = savedAt.getTime();
            const minutesLost = Number.isFinite(mainTime) && mainTime > backupTime
                ? Math.max(0, Math.round((mainTime - backupTime) / 60000))
                : null;
            const lossText = minutesLost === null ? "" : minutesLost === 0 ? " No measurable progress lost." : ` Approximately ${minutesLost} minute${minutesLost === 1 ? "" : "s"} may be lost.`;
            const confirmed = window.confirm(
                `Recover ${chosen.label}?\n\nWave ${run.wave} · ${DIFFICULTY_DATA[run.difficulty]?.label || run.difficulty}\nSaved ${savedAt.toLocaleString()}\n\nThis replaces the current main save. The current main save will first be preserved as Backup 1.`
            );
            if (!confirmed) { setSaveStatus("Recovery cancelled. No save data was changed."); logSaveActivity("Recovery", "cancelled", "Recovery was cancelled. No save data was changed.", { slot: chosen.label }); return; }
            const currentMain = rawStorageGet(SAVE_KEYS.main);
            rotateSaveBackups(currentMain);
            const serialized = JSON.stringify(chosen.result.envelope);
            if (!rawStorageSet(SAVE_KEYS.main, serialized)) {
                setSaveStatus("Recovery could not write the restored save. Existing copies were preserved.", "bad");
                logSaveActivity("Recovery", "failed", "The recovery copy could not be written. Existing copies were preserved.", { slot: chosen.label, reason: "write-failed" });
                return;
            }
            const verification = parseAndValidateSave(rawStorageGet(SAVE_KEYS.main));
            if (!verification.valid) {
                if (currentMain) rawStorageSet(SAVE_KEYS.main, currentMain);
                setSaveStatus("Recovery failed final verification. The previous main save was restored.", "bad");
                logSaveActivity("Recovery", "failed", "Final verification failed; the previous main save was restored.", { slot: chosen.label, reason: verification.reason });
                return;
            }
            refreshSaveDataPanel(`Recovery successful · ${chosen.label} · Wave ${run.wave}.${lossText}`);
            logSaveActivity("Recovery", "success", `${chosen.label} was verified and promoted to Main at Wave ${run.wave}.${lossText}`, { wave: run.wave, slot: chosen.label });
        });
        // Browser lifecycle events are not equally reliable. pagehide is the
        // primary exit checkpoint, visibilitychange covers tab/background
        // transitions, and freeze covers browsers that suspend a page without
        // unloading it. A short dedupe window prevents one transition from
        // rotating several backups in rapid succession.
        let lastLifecycleCheckpointAt = 0;
        let lastLifecycleCheckpointReason = "";
        const requestLifecycleCheckpoint = (reason) => {
            if (!state.started || state.ended) return false;
            const now = Date.now();
            if (now - lastLifecycleCheckpointAt < 1200 && reason !== "autosave") return false;
            lastLifecycleCheckpointAt = now;
            lastLifecycleCheckpointReason = reason;
            return writeValidatedSave(reason);
        };

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) requestLifecycleCheckpoint("background");
            else refreshSaveDataPanel("Save monitoring active");
        });
        window.addEventListener("pagehide", () => requestLifecycleCheckpoint("shutdown"));
        window.addEventListener("beforeunload", () => requestLifecycleCheckpoint("shutdown"));
        document.addEventListener("freeze", () => requestLifecycleCheckpoint("background"));
        window.addEventListener("pageshow", () => refreshSaveDataPanel());
        window.addEventListener("focus", () => refreshSaveDataPanel());

        const autosaveIntervalMs = 15000;
        window.setInterval(() => requestLifecycleCheckpoint("autosave"), autosaveIntervalMs);
        if (!readSaveActivity().some(entry => entry.type === "Autosave system")) {
            logSaveActivity("Autosave system", "success", "Autosave monitoring is active every 15 seconds while a run is in progress. Background and exit checkpoints are also armed.");
        }
        refreshSaveDataPanel();
        window.StarwakeSaveSystem = Object.freeze({
            saveNow: () => writeValidatedSave("manual"),
            inspect: inspectSaveSlots,
            schemaVersion: SAVE_SCHEMA_VERSION,
            storageUsageBytes: saveStorageUsageBytes,
            storageLimitBytes: SAVE_STORAGE_LIMIT_BYTES,
            activity: readSaveActivity,
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
        // Persistence is non-critical. A blocked or damaged storage backend must
        // never prevent the splash screen, menu, or game loop from booting.
        try {
            initializePersistenceControls();
        } catch (persistenceError) {
            console.warn("Starwake persistence disabled for this session:", persistenceError);
            const status = document.getElementById("saveDataStatus");
            const badge = document.getElementById("saveIntegrityBadge");
            if (status) {
                status.textContent = "Save storage is unavailable, but gameplay remains available.";
                status.dataset.level = "bad";
            }
            if (badge) {
                badge.textContent = "Storage unavailable";
                badge.className = "save-integrity-badge bad";
            }
        }
        updateFullscreenButtons();
        updateCursorPosition(mouse.x, mouse.y);
        setDifficulty(state.difficulty);
        updateUndoUpgradeButton();
        setAudioVolume(savedAudioVolume);
        setAudioEnabled(savedAudioEnabled);

        // Boot-state guard: never expose an inert arena merely because another
        // subsystem changed overlay styles during initialization.
        if (!state.started) {
            if (ui.splashScreen) ui.splashScreen.style.display = "flex";
            if (ui.startMenu) ui.startMenu.style.display = "none";
            if (ui.gameOverMenu) ui.gameOverMenu.style.display = "none";
        }
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
