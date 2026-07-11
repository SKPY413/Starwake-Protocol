/*
 * STARWAKE PROTOCOL — PERSISTENT ADAPTIVE MUSIC ENGINE
 *
 * PURPOSE
 * -------
 * This file owns the procedural soundtrack, transport, scene changes, and all
 * music-only synthesis. Unlike the original sequencer, musical notes do NOT
 * create new OscillatorNodes or AudioBufferSourceNodes during playback.
 *
 * ARCHITECTURAL CONTRACT
 * ----------------------
 * 1. Every source node in this file is created once during init().
 * 2. Sources run continuously and remain silent until gain envelopes trigger.
 * 3. Polyphony uses small fixed round-robin pools. No pool may grow at runtime.
 * 4. The game may call schedule() frequently; schedule() only automates params.
 * 5. reset() resets transport. destroy() is reserved for AudioContext teardown.
 * 6. A music failure must never prevent gameplay from starting.
 */
(() => {
  "use strict";

  const SCALE = [0, 2, 3, 5, 7, 8, 10];
  const PROGRESSIONS = {
    normal: [0, 5, 3, 6],
    boss: [0, 6, 5, 6],
    gigaBoss: [0, 1, 6, 0],
  };
  const BPM = { normal: 150, boss: 156, gigaBoss: 162, upgrade: 92 };
  const ROOT_MIDI = 41; // F2
  const SILENCE = 0.0001;

  const engine = {
    initialized: false,
    ctx: null,
    output: null,
    audioRef: null,
    musicBus: null,
    melodyBus: null,
    melodyFilter: null,
    melodyPulseGain: null,
    sidechainGain: null,
    delay: null,
    delayFeedback: null,
    delayWet: null,
    barLfo: null,
    barLfoDepth: null,
    fastLfo: null,
    fastLfoDepth: null,
    noiseSource: null,
    rack: null,
    step: 0,
    nextTime: 0,
    phrase: 0,
    lastMode: "normal",
    lastWave: -1,
    lastScene: "combat",
  };

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function makeNoise(ctx, seconds = 2) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function distortionCurve(amount = 35) {
    const count = 2048;
    const curve = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = i * 2 / (count - 1) - 1;
      curve[i] = Math.tanh(x * (1 + amount / 18));
    }
    return curve;
  }

  /**
   * Marks sources created during callback as persistent for the diagnostics and
   * voice guard installed by game.js. Always restore the previous flags.
   */
  function withPersistentSourceMetadata(audio, category, callback) {
    const previousPersistent = audio?.currentSourcePersistent;
    const previousCategory = audio?.currentSfxCategory;
    const previousPriority = audio?.currentSfxPriority;
    if (audio) {
      audio.currentSourcePersistent = true;
      audio.currentSfxCategory = category;
      audio.currentSfxPriority = 10;
    }
    try {
      return callback();
    } finally {
      if (audio) {
        audio.currentSourcePersistent = previousPersistent;
        audio.currentSfxCategory = previousCategory;
        audio.currentSfxPriority = previousPriority;
      }
    }
  }

  function createOscillator(ctx, audio, type, destination, detune = 0) {
    return withPersistentSourceMetadata(audio, "music-rack", () => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = detune;
      osc.connect(destination);
      osc.start();
      return osc;
    });
  }

  function createLoopingNoise(ctx, audio, destination) {
    return withPersistentSourceMetadata(audio, "music-rack-noise", () => {
      const source = ctx.createBufferSource();
      source.buffer = makeNoise(ctx, 2);
      source.loop = true;
      source.connect(destination);
      source.start();
      return source;
    });
  }

  function makeVoicePool(size, factory) {
    const voices = Array.from({ length: size }, (_, index) => factory(index));
    return { voices, cursor: 0 };
  }

  function nextVoice(pool) {
    const voice = pool.voices[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.voices.length;
    return voice;
  }

  function scheduleGain(gainParam, time, peak, sustain, duration, attack = 0.006, releaseStart = 0.55) {
    const end = time + Math.max(0.025, duration);
    gainParam.cancelScheduledValues(time);
    gainParam.setValueAtTime(SILENCE, time);
    gainParam.exponentialRampToValueAtTime(Math.max(SILENCE, peak), time + Math.min(attack, duration * 0.35));
    if (sustain > SILENCE && duration > attack * 2) {
      gainParam.setTargetAtTime(Math.max(SILENCE, sustain), time + attack, Math.max(0.015, duration * 0.12));
    }
    gainParam.exponentialRampToValueAtTime(SILENCE, time + Math.max(attack + 0.01, duration * releaseStart));
    gainParam.setValueAtTime(SILENCE, end);
  }

  function buildRack(ctx, audio) {
    const rack = {};

    // One looping noise source feeds fixed gain/filter paths for hats, snare,
    // kick click, and risers. This replaces thousands of one-shot buffer sources.
    const noiseBus = ctx.createGain();
    noiseBus.gain.value = 0.75;
    engine.noiseSource = createLoopingNoise(ctx, audio, noiseBus);

    rack.kicks = makeVoicePool(2, () => {
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const drive = ctx.createWaveShaper();
      filter.type = "lowpass";
      filter.frequency.value = 1250;
      drive.curve = distortionCurve(46);
      drive.oversample = "2x";
      gain.gain.value = SILENCE;
      drive.connect(filter);
      filter.connect(gain);
      gain.connect(engine.output);
      const osc = createOscillator(ctx, audio, "sine", drive);
      return { osc, gain };
    });

    rack.kickClicks = makeVoicePool(2, () => {
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = "highpass";
      filter.frequency.value = 4200;
      gain.gain.value = SILENCE;
      noiseBus.connect(filter);
      filter.connect(gain);
      gain.connect(engine.output);
      return { filter, gain };
    });

    rack.hats = makeVoicePool(4, () => {
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = "highpass";
      filter.frequency.value = 7800;
      gain.gain.value = SILENCE;
      noiseBus.connect(filter);
      filter.connect(gain);
      gain.connect(engine.musicBus);
      return { filter, gain };
    });

    rack.snares = makeVoicePool(2, () => {
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = "bandpass";
      filter.frequency.value = 1900;
      filter.Q.value = 0.8;
      gain.gain.value = SILENCE;
      noiseBus.connect(filter);
      filter.connect(gain);
      gain.connect(engine.musicBus);
      return { filter, gain };
    });

    // Two bass voices are sufficient at sixteenth-note timing because each note
    // is short. Each voice uses one tonal oscillator and one sub oscillator.
    rack.bass = makeVoicePool(2, () => {
      const filter = ctx.createBiquadFilter();
      const drive = ctx.createWaveShaper();
      const gain = ctx.createGain();
      const subGain = ctx.createGain();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.Q.value = 2;
      drive.curve = distortionCurve(38);
      drive.oversample = "2x";
      gain.gain.value = SILENCE;
      subGain.gain.value = SILENCE;
      filter.connect(drive);
      drive.connect(gain);
      gain.connect(engine.musicBus);
      subGain.connect(engine.musicBus);
      const main = createOscillator(ctx, audio, "sawtooth", filter);
      const sub = createOscillator(ctx, audio, "sine", subGain);
      return { main, sub, filter, drive, gain, subGain };
    });

    // Pads use two alternating chord voices. Each chord voice has one oscillator
    // per triad note. This preserves harmony with only six persistent sources.
    rack.pads = makeVoicePool(2, () => {
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = "lowpass";
      filter.frequency.value = 2300;
      filter.Q.value = 1.2;
      gain.gain.value = SILENCE;
      filter.connect(gain);
      gain.connect(engine.melodyBus);
      const oscs = [
        createOscillator(ctx, audio, "sawtooth", filter, -8),
        createOscillator(ctx, audio, "sawtooth", filter, 0),
        createOscillator(ctx, audio, "sawtooth", filter, 8),
      ];
      return { oscs, filter, gain };
    });

    rack.arp = makeVoicePool(2, () => {
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = "bandpass";
      filter.frequency.value = 3200;
      filter.Q.value = 5;
      gain.gain.value = SILENCE;
      filter.connect(gain);
      gain.connect(engine.melodyBus);
      const osc = createOscillator(ctx, audio, "sawtooth", filter);
      return { osc, filter, gain };
    });

    // Three lead voices allow the melody tail and final-bar harmony to overlap.
    // Each voice uses two oscillators instead of the previous three-source stack.
    rack.lead = makeVoicePool(3, () => {
      const filter = ctx.createBiquadFilter();
      const drive = ctx.createWaveShaper();
      const gain = ctx.createGain();
      filter.type = "lowpass";
      filter.frequency.value = 4800;
      filter.Q.value = 2.3;
      drive.curve = distortionCurve(16);
      drive.oversample = "2x";
      gain.gain.value = SILENCE;
      filter.connect(drive);
      drive.connect(gain);
      gain.connect(engine.melodyBus);
      const oscs = [
        createOscillator(ctx, audio, "sawtooth", filter, -7),
        createOscillator(ctx, audio, "square", filter, 7),
      ];
      return { oscs, filter, drive, gain };
    });

    rack.risers = makeVoicePool(2, () => {
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = "bandpass";
      filter.frequency.value = 350;
      filter.Q.value = 1.2;
      gain.gain.value = SILENCE;
      noiseBus.connect(filter);
      filter.connect(gain);
      gain.connect(engine.musicBus);
      return { filter, gain };
    });

    rack.noiseBus = noiseBus;
    return rack;
  }

  function init(audio) {
    const ctx = audio?.context;
    const destination = audio?.musicGain;
    if (!ctx || !destination) return false;
    if (engine.initialized && engine.ctx === ctx) return true;

    // A new AudioContext means every old node belongs to a closed graph.
    engine.ctx = ctx;
    engine.output = destination;
    engine.audioRef = audio;

    engine.musicBus = ctx.createGain();
    engine.melodyBus = ctx.createGain();
    engine.melodyFilter = ctx.createBiquadFilter();
    engine.melodyPulseGain = ctx.createGain();
    engine.sidechainGain = ctx.createGain();
    engine.delay = ctx.createDelay(1.2);
    engine.delayFeedback = ctx.createGain();
    engine.delayWet = ctx.createGain();

    engine.musicBus.gain.value = 0.82;
    engine.melodyBus.gain.value = 1;
    engine.melodyFilter.type = "lowpass";
    engine.melodyFilter.frequency.value = 3300;
    engine.melodyFilter.Q.value = 1.4;
    engine.melodyPulseGain.gain.value = 0.92;
    engine.sidechainGain.gain.value = 1;
    engine.delay.delayTime.value = 0.225;
    engine.delayFeedback.gain.value = 0.25;
    engine.delayWet.gain.value = 0.14;

    engine.melodyBus.connect(engine.melodyFilter);
    engine.melodyFilter.connect(engine.melodyPulseGain);
    engine.melodyPulseGain.connect(engine.musicBus);
    engine.musicBus.connect(engine.sidechainGain);
    engine.sidechainGain.connect(destination);
    engine.musicBus.connect(engine.delay);
    engine.delay.connect(engine.delayFeedback);
    engine.delayFeedback.connect(engine.delay);
    engine.delay.connect(engine.delayWet);
    engine.delayWet.connect(destination);

    engine.barLfo = withPersistentSourceMetadata(audio, "music-lfo", () => ctx.createOscillator());
    engine.fastLfo = withPersistentSourceMetadata(audio, "music-lfo", () => ctx.createOscillator());
    engine.barLfoDepth = ctx.createGain();
    engine.fastLfoDepth = ctx.createGain();
    const initialBarHz = BPM.normal / 240;
    engine.barLfo.type = "sine";
    engine.barLfo.frequency.value = initialBarHz;
    engine.barLfoDepth.gain.value = 1100;
    engine.fastLfo.type = "sine";
    engine.fastLfo.frequency.value = initialBarHz * 16;
    engine.fastLfoDepth.gain.value = 0.07;
    engine.barLfo.connect(engine.barLfoDepth);
    engine.barLfoDepth.connect(engine.melodyFilter.frequency);
    engine.fastLfo.connect(engine.fastLfoDepth);
    engine.fastLfoDepth.connect(engine.melodyPulseGain.gain);
    engine.barLfo.start();
    engine.fastLfo.start();

    engine.rack = buildRack(ctx, audio);
    engine.initialized = true;
    engine.step = 0;
    engine.nextTime = ctx.currentTime + 0.06;
    return true;
  }

  function duck(time, depth = 0.28) {
    const param = engine.sidechainGain.gain;
    param.cancelScheduledValues(time);
    param.setValueAtTime(Math.max(SILENCE, param.value), time);
    param.linearRampToValueAtTime(depth, time + 0.01);
    param.exponentialRampToValueAtTime(1, time + 0.20);
  }

  function kick(time, power = 1) {
    const voice = nextVoice(engine.rack.kicks);
    voice.osc.frequency.cancelScheduledValues(time);
    voice.osc.frequency.setValueAtTime(165, time);
    voice.osc.frequency.exponentialRampToValueAtTime(46, time + 0.105);
    scheduleGain(voice.gain.gain, time, 0.72 * power, 0.18 * power, 0.38, 0.003, 0.42);

    const click = nextVoice(engine.rack.kickClicks);
    scheduleGain(click.gain.gain, time, 0.095 * power, SILENCE, 0.03, 0.001, 0.7);
    duck(time, 0.24);
  }

  function softKick(time, amount = 1) {
    const voice = nextVoice(engine.rack.kicks);
    voice.osc.frequency.cancelScheduledValues(time);
    voice.osc.frequency.setValueAtTime(92, time);
    voice.osc.frequency.exponentialRampToValueAtTime(43, time + 0.14);
    scheduleGain(voice.gain.gain, time, 0.26 * amount, 0.08 * amount, 0.32, 0.007, 0.5);
  }

  function hat(time, open = false, amount = 1) {
    const voice = nextVoice(engine.rack.hats);
    voice.filter.frequency.setValueAtTime(open ? 6500 : 8200, time);
    scheduleGain(voice.gain.gain, time, (open ? 0.075 : 0.038) * amount, SILENCE, open ? 0.20 : 0.045, 0.001, 0.45);
  }

  function snare(time, amount = 1) {
    const voice = nextVoice(engine.rack.snares);
    voice.filter.frequency.setValueAtTime(1900, time);
    scheduleGain(voice.gain.gain, time, 0.14 * amount, 0.035 * amount, 0.16, 0.002, 0.45);
  }

  function bass(time, midi, duration, amount = 1, reese = false) {
    const voice = nextVoice(engine.rack.bass);
    const hz = midiToHz(midi);
    voice.main.frequency.cancelScheduledValues(time);
    voice.sub.frequency.cancelScheduledValues(time);
    voice.main.frequency.setValueAtTime(hz, time);
    voice.sub.frequency.setValueAtTime(hz * 0.5, time);
    voice.main.detune.setValueAtTime(reese ? -7 : 0, time);
    voice.filter.frequency.cancelScheduledValues(time);
    voice.filter.frequency.setValueAtTime(reese ? 680 : 480, time);
    voice.filter.frequency.exponentialRampToValueAtTime(reese ? 1750 : 980, time + duration * 0.6);
    voice.filter.Q.setValueAtTime(reese ? 3.2 : 1.7, time);
    scheduleGain(voice.gain.gain, time, 0.15 * amount, 0.095 * amount, duration, 0.006, 0.72);
    scheduleGain(voice.subGain.gain, time, 0.12 * amount, 0.075 * amount, duration, 0.008, 0.75);
  }

  function pad(time, chord, duration, amount = 1, upgrade = false) {
    const voice = nextVoice(engine.rack.pads);
    const base = upgrade ? ROOT_MIDI + 12 : ROOT_MIDI + 12;
    voice.oscs.forEach((osc, index) => {
      osc.frequency.cancelScheduledValues(time);
      osc.frequency.setTargetAtTime(midiToHz(base + chord[index]), time, 0.02);
    });
    voice.filter.frequency.cancelScheduledValues(time);
    voice.filter.frequency.setValueAtTime(upgrade ? 1200 : 1750, time);
    voice.filter.frequency.exponentialRampToValueAtTime(upgrade ? 2100 : 4700, time + duration * 0.7);
    scheduleGain(
      voice.gain.gain,
      time,
      (upgrade ? 0.042 : 0.055) * amount,
      (upgrade ? 0.032 : 0.038) * amount,
      duration,
      upgrade ? 0.42 : 0.025,
      upgrade ? 0.82 : 0.75
    );
  }

  function arp(time, midi, duration, amount = 1) {
    const voice = nextVoice(engine.rack.arp);
    voice.osc.frequency.cancelScheduledValues(time);
    voice.osc.frequency.setValueAtTime(midiToHz(midi), time);
    scheduleGain(voice.gain.gain, time, 0.052 * amount, SILENCE, duration, 0.004, 0.48);
  }

  function leadVoice(time, midi, duration, amount = 1, accent = false, mellow = false) {
    const voice = nextVoice(engine.rack.lead);
    const hz = midiToHz(midi);
    voice.oscs.forEach((osc, index) => {
      osc.frequency.cancelScheduledValues(time);
      osc.frequency.setTargetAtTime(hz * (mellow && index === 1 ? 2 : 1), time, 0.006);
      osc.type = mellow ? (index === 0 ? "sine" : "triangle") : (index === 0 ? "sawtooth" : "square");
    });
    voice.filter.frequency.cancelScheduledValues(time);
    voice.filter.frequency.setValueAtTime(mellow ? 2100 : (accent ? 6800 : 5200), time);
    voice.filter.frequency.exponentialRampToValueAtTime(mellow ? 1300 : (accent ? 3400 : 2450), time + duration);
    voice.filter.Q.setValueAtTime(mellow ? 0.8 : (accent ? 3.0 : 2.1), time);
    scheduleGain(
      voice.gain.gain,
      time,
      (mellow ? 0.047 : 0.076) * amount,
      (mellow ? 0.026 : 0.042) * amount,
      duration,
      mellow ? 0.018 : 0.006,
      mellow ? 0.8 : 0.7
    );
  }

  function riser(time, duration, amount = 1) {
    const voice = nextVoice(engine.rack.risers);
    voice.filter.frequency.cancelScheduledValues(time);
    voice.filter.frequency.setValueAtTime(350, time);
    voice.filter.frequency.exponentialRampToValueAtTime(8500, time + duration);
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(SILENCE, time);
    gain.exponentialRampToValueAtTime(0.085 * amount, time + duration * 0.86);
    gain.exponentialRampToValueAtTime(SILENCE, time + duration);
  }

  function chordFor(root) {
    return [0, 3, 7].map(interval => (interval + root) % 12);
  }

  function updateTempoLfos(mode, time) {
    const barHz = BPM[mode] / 240;
    engine.barLfo.frequency.setTargetAtTime(barHz, time, 0.05);
    engine.fastLfo.frequency.setTargetAtTime(barHz * 16, time, 0.03);
    const slowDepth = mode === "gigaBoss" ? 1750 : mode === "boss" ? 1450 : 1100;
    const fastDepth = mode === "gigaBoss" ? 0.11 : mode === "boss" ? 0.09 : 0.07;
    engine.barLfoDepth.gain.setTargetAtTime(slowDepth, time, 0.1);
    engine.fastLfoDepth.gain.setTargetAtTime(fastDepth, time, 0.08);
  }

  function playUpgradeStep(step, time) {
    const local = step % 128;
    const sixteenth = local % 16;
    const bar = Math.floor(local / 16);
    const roots = [0, 5, 3, 6, 0, 5, 1, 6];
    const root = roots[bar % roots.length];
    const chord = chordFor(root);
    const beat = sixteenth % 4;

    if (sixteenth === 0 || sixteenth === 8) softKick(time, sixteenth === 0 ? 0.9 : 0.58);
    if (sixteenth === 4 || sixteenth === 12) snare(time, 0.30);
    if (sixteenth % 2 === 1) hat(time, false, 0.30);
    if (sixteenth === 14) hat(time, true, 0.24);

    if (sixteenth === 0) {
      pad(time, chord, 4.8, 1, true);
      bass(time, ROOT_MIDI - 12 + root, 0.62, 0.40, false);
    } else if (sixteenth === 8) {
      bass(time, ROOT_MIDI - 5 + root, 0.48, 0.29, false);
    }

    const phraseA = [7, 10, 12, 10, 7, 5, 3, 5];
    const phraseB = [7, 8, 10, 12, 10, 8, 7, 5];
    const phrase = bar % 4 < 2 ? phraseA : phraseB;
    if (sixteenth % 4 === 0) {
      const note = ROOT_MIDI + 24 + root + phrase[(bar * 4 + beat) % phrase.length];
      leadVoice(time + 0.015, note, 0.62, bar % 4 === 3 ? 1.05 : 0.88, false, true);
    }
  }

  function playStep(step, time, mode, state) {
    const local = step % 64;
    const sixteenth = local % 16;
    const bar = Math.floor(local / 16);
    const progression = PROGRESSIONS[mode];
    const chordRoot = progression[bar % progression.length];
    const chord = chordFor(chordRoot);
    const intensity = Math.min(1.2, 0.60 + Math.max(0, (state.wave || 1) - 1) * 0.022 + (mode === "boss" ? 0.20 : mode === "gigaBoss" ? 0.34 : 0));
    const buildBar = bar === 2;
    const finalBar = bar === 3;

    if (sixteenth % 4 === 0 && !buildBar) kick(time, finalBar ? 1.05 : 1);
    if (buildBar && sixteenth >= 8 && sixteenth % 2 === 0) kick(time, 0.68 + (sixteenth - 8) * 0.035);
    if (sixteenth === 4 || sixteenth === 12) snare(time, intensity);
    hat(time, false, intensity * (sixteenth % 2 ? 1.05 : 0.70));
    if ([2, 6, 10, 14].includes(sixteenth)) hat(time, true, intensity * 0.85);

    const bassPattern = [0, 0, 7, 0, 0, 10, 7, 3, 0, 0, 7, 10, 0, 3, 7, 10];
    if (!buildBar || sixteenth >= 8) {
      const note = ROOT_MIDI - 12 + chordRoot + bassPattern[sixteenth];
      bass(time, note, 0.15, intensity, sixteenth % 4 === 0 || mode !== "normal");
    }

    const order = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];
    const octaveJump = finalBar && sixteenth >= 8 ? 12 : 0;
    arp(time + 0.004, ROOT_MIDI + 24 + chord[order[sixteenth]] + octaveJump, 0.075, intensity * (buildBar ? 0.82 : 0.62));

    if (sixteenth === 0) {
      pad(time, chord, 1.42, intensity * (buildBar ? 0.66 : 0.9));
      if (bar === 2) riser(time, 1.40, intensity);
    }

    const melodyBars = [
      [0, null, 3, 5, 7, null, 5, 3, 0, null, 3, 5, 8, 7, 5, null],
      [7, null, 10, 12, 15, null, 12, 10, 7, null, 5, 7, 10, 8, 7, null],
      [0, 3, 5, 7, 8, 7, 5, 3, 5, 7, 8, 10, 12, 10, 8, 7],
      [7, null, 10, 12, 15, 12, 17, 15, 12, 10, 8, 7, 5, 7, 3, 0],
    ];
    const melodyOffset = melodyBars[bar][sixteenth];
    if (melodyOffset !== null) {
      const accent = sixteenth % 4 === 0 || finalBar;
      const duration = sixteenth % 2 === 0 ? 0.19 : 0.10;
      leadVoice(time + 0.008, ROOT_MIDI + 24 + melodyOffset, duration, intensity * (buildBar ? 0.88 : finalBar ? 1.18 : 0.96), accent, false);
      if (finalBar && sixteenth % 4 === 0) {
        leadVoice(time + 0.012, ROOT_MIDI + 36 + melodyOffset + 7, 0.15, intensity * 0.27, true, false);
      }
    }

    if (mode !== "normal" && [6, 14].includes(sixteenth)) kick(time, mode === "gigaBoss" ? 0.56 : 0.43);
  }

  function schedule({ audio, state }) {
    if (!audio?.context || !audio?.musicGain) return;
    if (!init(audio)) return;

    const scene = state.musicScene === "upgrade" ? "upgrade" : "combat";
    if ((state.paused && scene !== "upgrade") || state.ended || !audio.enabled) {
      engine.nextTime = audio.context.currentTime + 0.05;
      return;
    }

    const mode = scene === "upgrade" ? "upgrade" : (audio.mode || "normal");
    const now = audio.context.currentTime;

    if (engine.lastScene !== scene) {
      engine.lastScene = scene;
      engine.step = 0;
      engine.nextTime = now + 0.12;
      const bus = engine.musicBus.gain;
      bus.cancelScheduledValues(now);
      bus.setValueAtTime(Math.max(SILENCE, bus.value), now);
      bus.linearRampToValueAtTime(0.07, now + 0.10);
      bus.linearRampToValueAtTime(scene === "upgrade" ? 0.66 : 0.82, now + 0.52);
    }

    if (scene === "upgrade") {
      engine.barLfo.frequency.setTargetAtTime(BPM.upgrade / 240, now, 0.08);
      engine.fastLfo.frequency.setTargetAtTime((BPM.upgrade / 240) * 4, now, 0.08);
      engine.barLfoDepth.gain.setTargetAtTime(420, now, 0.15);
      engine.fastLfoDepth.gain.setTargetAtTime(0.025, now, 0.15);
    } else {
      updateTempoLfos(mode, now);
    }

    if (engine.lastMode !== mode || engine.lastWave !== state.wave) {
      engine.lastMode = mode;
      engine.lastWave = state.wave;
      engine.phrase++;
    }

    const stepDuration = 60 / BPM[mode] / 4;
    const loopLength = scene === "upgrade" ? 128 : 64;
    while (engine.nextTime < now + 0.12) {
      if (scene === "upgrade") playUpgradeStep(engine.step, engine.nextTime);
      else playStep(engine.step, engine.nextTime, mode, state);
      engine.nextTime += stepDuration;
      engine.step = (engine.step + 1) % loopLength;
      audio.stepIndex = engine.step;
      audio.nextStepTime = engine.nextTime;
    }
  }

  function reset(audio) {
    if (!audio?.context) return;
    engine.step = 0;
    engine.nextTime = audio.context.currentTime + 0.06;
  }

  function destroy() {
    const sources = [];
    if (engine.rack) {
      for (const key of ["kicks", "bass", "pads", "arp", "lead"]) {
        const pool = engine.rack[key];
        if (!pool) continue;
        for (const voice of pool.voices) {
          if (voice.osc) sources.push(voice.osc);
          if (voice.main) sources.push(voice.main);
          if (voice.sub) sources.push(voice.sub);
          if (voice.oscs) sources.push(...voice.oscs);
        }
      }
    }
    sources.push(engine.noiseSource, engine.barLfo, engine.fastLfo);
    for (const source of sources.filter(Boolean)) {
      try { source.stop(); } catch (_) {}
      try { source.disconnect(); } catch (_) {}
    }
    Object.assign(engine, {
      initialized: false,
      ctx: null,
      output: null,
      audioRef: null,
      musicBus: null,
      melodyBus: null,
      melodyFilter: null,
      melodyPulseGain: null,
      sidechainGain: null,
      delay: null,
      delayFeedback: null,
      delayWet: null,
      barLfo: null,
      barLfoDepth: null,
      fastLfo: null,
      fastLfoDepth: null,
      noiseSource: null,
      rack: null,
      step: 0,
      nextTime: 0,
      phrase: 0,
      lastMode: "normal",
      lastWave: -1,
      lastScene: "combat",
    });
  }

  function getDiagnostics() {
    return {
      initialized: engine.initialized,
      architecture: "persistent-fixed-rack",
      sourceBudget: 24,
      step: engine.step,
      scene: engine.lastScene,
      mode: engine.lastMode,
    };
  }

  window.StarwakeMusicEngine = { schedule, reset, destroy, getDiagnostics };
})();
