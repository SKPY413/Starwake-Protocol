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

