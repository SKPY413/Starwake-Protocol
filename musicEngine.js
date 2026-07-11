(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const SCALE = [0, 2, 3, 5, 7, 8, 10]; // F natural minor
  const PROGRESSIONS = {
    normal: [0, 5, 3, 6],
    boss: [0, 6, 5, 6],
    gigaBoss: [0, 1, 6, 0],
  };
  const BPM = { normal: 150, boss: 156, gigaBoss: 162, upgrade: 92 };
  const ROOT_MIDI = 41; // F2

  const engine = {
    initialized: false,
    ctx: null,
    output: null,
    noise: null,
    delay: null,
    delayFeedback: null,
    delayWet: null,
    musicBus: null,
    melodyBus: null,
    melodyFilter: null,
    melodyPulseGain: null,
    barLfo: null,
    barLfoDepth: null,
    fastLfo: null,
    fastLfoDepth: null,
    sidechainGain: null,
    step: 0,
    nextTime: 0,
    phrase: 0,
    lastMode: "normal",
    lastWave: -1,
    lastScene: "combat",
    intensity: 0.55,
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

  function distortionCurve(amount = 50) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = i * 2 / n - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function init(ctx, destination) {
    if (engine.initialized && engine.ctx === ctx) return;
    engine.ctx = ctx;
    engine.output = destination;
    engine.noise = makeNoise(ctx);

    engine.musicBus = ctx.createGain();
    engine.melodyBus = ctx.createGain();
    engine.melodyFilter = ctx.createBiquadFilter();
    engine.melodyPulseGain = ctx.createGain();
    engine.barLfo = ctx.createOscillator();
    engine.barLfoDepth = ctx.createGain();
    engine.fastLfo = ctx.createOscillator();
    engine.fastLfoDepth = ctx.createGain();
    engine.sidechainGain = ctx.createGain();
    engine.delay = ctx.createDelay(1.2);
    engine.delayFeedback = ctx.createGain();
    engine.delayWet = ctx.createGain();

    engine.musicBus.gain.value = 0.92;
    engine.melodyBus.gain.value = 1;
    engine.melodyFilter.type = "lowpass";
    engine.melodyFilter.frequency.value = 3300;
    engine.melodyFilter.Q.value = 1.4;
    engine.melodyPulseGain.gain.value = 0.84;

    // Tempo-locked modulation: 1 cycle per bar + 16 cycles per bar.
    const initialBarHz = BPM.normal / 240;
    engine.barLfo.type = "sine";
    engine.barLfo.frequency.value = initialBarHz;
    engine.barLfoDepth.gain.value = 1450;
    engine.barLfo.connect(engine.barLfoDepth);
    engine.barLfoDepth.connect(engine.melodyFilter.frequency);

    engine.fastLfo.type = "sine";
    engine.fastLfo.frequency.value = initialBarHz * 16;
    engine.fastLfoDepth.gain.value = 0.16;
    engine.fastLfo.connect(engine.fastLfoDepth);
    engine.fastLfoDepth.connect(engine.melodyPulseGain.gain);

    engine.melodyBus.connect(engine.melodyFilter);
    engine.melodyFilter.connect(engine.melodyPulseGain);
    engine.melodyPulseGain.connect(engine.musicBus);
    engine.barLfo.start();
    engine.fastLfo.start();

    engine.sidechainGain.gain.value = 1;
    engine.delay.delayTime.value = 0.225;
    engine.delayFeedback.gain.value = 0.32;
    engine.delayWet.gain.value = 0.20;

    engine.musicBus.connect(engine.sidechainGain);
    engine.sidechainGain.connect(destination);
    engine.musicBus.connect(engine.delay);
    engine.delay.connect(engine.delayFeedback);
    engine.delayFeedback.connect(engine.delay);
    engine.delay.connect(engine.delayWet);
    engine.delayWet.connect(destination);

    engine.initialized = true;
    engine.nextTime = ctx.currentTime + 0.05;
  }

  function duck(time, depth = 0.18) {
    const g = engine.sidechainGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(Math.max(0.0001, g.value), time);
    g.linearRampToValueAtTime(depth, time + 0.012);
    g.exponentialRampToValueAtTime(1, time + 0.24);
  }

  function kick(time, power = 1) {
    const ctx = engine.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const drive = ctx.createWaveShaper();
    const filter = ctx.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.setValueAtTime(170, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.105);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.95 * power, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    drive.curve = distortionCurve(90);
    drive.oversample = "4x";
    filter.type = "lowpass";
    filter.frequency.value = 1250;

    osc.connect(drive); drive.connect(filter); filter.connect(gain); gain.connect(engine.output);
    osc.start(time); osc.stop(time + 0.45);

    const click = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const cg = ctx.createGain();
    click.buffer = engine.noise;
    hp.type = "highpass"; hp.frequency.value = 4200;
    cg.gain.setValueAtTime(0.12 * power, time);
    cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
    click.connect(hp); hp.connect(cg); cg.connect(engine.output);
    click.start(time); click.stop(time + 0.03);
    duck(time, 0.14);
  }

  function hat(time, open = false, amount = 1) {
    const ctx = engine.ctx;
    const source = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = engine.noise;
    hp.type = "highpass"; hp.frequency.value = open ? 6500 : 8200;
    gain.gain.setValueAtTime((open ? 0.095 : 0.052) * amount, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.22 : 0.045));
    source.connect(hp); hp.connect(gain); gain.connect(engine.musicBus);
    source.start(time); source.stop(time + (open ? 0.24 : 0.05));
  }

  function snare(time, amount = 1) {
    const ctx = engine.ctx;
    const source = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = engine.noise;
    bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.7;
    gain.gain.setValueAtTime(0.19 * amount, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    source.connect(bp); bp.connect(gain); gain.connect(engine.musicBus);
    source.start(time); source.stop(time + 0.2);
  }

  function bass(time, midi, duration, amount = 1, reese = false) {
    const ctx = engine.ctx;
    const filter = ctx.createBiquadFilter();
    const drive = ctx.createWaveShaper();
    const gain = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(reese ? 720 : 520, time);
    filter.frequency.exponentialRampToValueAtTime(reese ? 2100 : 1100, time + duration * 0.55);
    filter.Q.value = reese ? 3.8 : 1.8;
    drive.curve = distortionCurve(reese ? 62 : 35);
    drive.oversample = "4x";
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.20 * amount, time + 0.008);
    gain.gain.setTargetAtTime(0.13 * amount, time + 0.04, 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    filter.connect(drive); drive.connect(gain); gain.connect(engine.musicBus);

    const detunes = reese ? [-19, -7, 7, 19] : [-5, 5];
    detunes.forEach((detune, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? "sawtooth" : "square";
      osc.frequency.setValueAtTime(midiToHz(midi), time);
      osc.detune.value = detune;
      osc.connect(filter); osc.start(time); osc.stop(time + duration + 0.03);
    });

    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine"; sub.frequency.setValueAtTime(midiToHz(midi - 12), time);
    sg.gain.setValueAtTime(0.0001, time);
    sg.gain.exponentialRampToValueAtTime(0.18 * amount, time + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    sub.connect(sg); sg.connect(engine.musicBus); sub.start(time); sub.stop(time + duration + 0.03);
  }

  function supersaw(time, midi, duration, amount = 1, bright = 1) {
    const ctx = engine.ctx;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800 * bright, time);
    filter.frequency.exponentialRampToValueAtTime(6200 * bright, time + duration * 0.75);
    filter.Q.value = 2.4;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.08 * amount, time + 0.02);
    gain.gain.setTargetAtTime(0.055 * amount, time + 0.05, 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    filter.connect(gain); gain.connect(engine.melodyBus);
    [-24, -14, -6, 0, 6, 14, 24].forEach(detune => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(midiToHz(midi), time);
      osc.detune.value = detune;
      osc.connect(filter); osc.start(time); osc.stop(time + duration + 0.04);
    });
  }

  function pad(time, chord, duration, amount = 1) {
    chord.forEach((semi, i) => supersaw(time, ROOT_MIDI + 12 + semi, duration, 0.34 * amount, 0.58 + i * 0.08));
  }

  function arp(time, midi, duration, amount = 1) {
    const ctx = engine.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(midiToHz(midi), time);
    filter.type = "bandpass"; filter.frequency.value = 3200; filter.Q.value = 5;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.065 * amount, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter); filter.connect(gain); gain.connect(engine.melodyBus);
    osc.start(time); osc.stop(time + duration + 0.02);
  }

  function riser(time, duration, amount = 1) {
    const ctx = engine.ctx;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = engine.noise;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(350, time);
    filter.frequency.exponentialRampToValueAtTime(9000, time + duration);
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.12 * amount, time + duration * 0.88);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter); filter.connect(gain); gain.connect(engine.musicBus);
    source.start(time); source.stop(time + duration);
  }

  function chordFor(root) {
    const minor = [0, 3, 7];
    return minor.map(x => (x + root) % 12);
  }

  function updateTempoLfos(mode, time) {
    if (!engine.barLfo || !engine.fastLfo) return;
    const barHz = BPM[mode] / 240;
    engine.barLfo.frequency.setTargetAtTime(barHz, time, 0.04);
    engine.fastLfo.frequency.setTargetAtTime(barHz * 16, time, 0.02);

    // Boss states open the slow sweep and deepen the fast pulse.
    const slowDepth = mode === "gigaBoss" ? 2350 : mode === "boss" ? 1900 : 1450;
    const fastDepth = mode === "gigaBoss" ? 0.24 : mode === "boss" ? 0.20 : 0.16;
    engine.barLfoDepth.gain.setTargetAtTime(slowDepth, time, 0.08);
    engine.fastLfoDepth.gain.setTargetAtTime(fastDepth, time, 0.05);
  }


  function softKick(time, amount = 1) {
    const ctx = engine.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(92, time);
    osc.frequency.exponentialRampToValueAtTime(43, time + 0.14);
    filter.type = "lowpass";
    filter.frequency.value = 520;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.34 * amount, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.36);
    osc.connect(filter); filter.connect(gain); gain.connect(engine.musicBus);
    osc.start(time); osc.stop(time + 0.4);
  }

  function mellowKey(time, midi, duration, amount = 1) {
    const ctx = engine.ctx;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2100;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.055 * amount, time + 0.02);
    gain.gain.setTargetAtTime(0.028 * amount, time + 0.08, 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    filter.connect(gain); gain.connect(engine.melodyBus);
    [0, 12].forEach((oct, i) => {
      const osc = ctx.createOscillator();
      osc.type = i ? "triangle" : "sine";
      osc.frequency.setValueAtTime(midiToHz(midi + oct), time);
      osc.detune.value = i ? 5 : -3;
      osc.connect(filter); osc.start(time); osc.stop(time + duration + 0.04);
    });
  }

  function upgradePad(time, chord, duration, amount = 1) {
    const ctx = engine.ctx;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 1450;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.045 * amount, time + 0.55);
    gain.gain.setTargetAtTime(0.034 * amount, time + 0.8, 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    filter.connect(gain); gain.connect(engine.musicBus);
    chord.forEach((semi, i) => {
      [-9, 9].forEach(detune => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToHz(ROOT_MIDI + 12 + semi), time);
        osc.detune.value = detune + i * 2;
        osc.connect(filter); osc.start(time); osc.stop(time + duration + 0.08);
      });
    });
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
    if (sixteenth === 4 || sixteenth === 12) snare(time, 0.33);
    if (sixteenth % 2 === 1) hat(time, false, 0.34);
    if (sixteenth === 14) hat(time, true, 0.28);

    if (sixteenth === 0) {
      upgradePad(time, chord, 5.0, 1);
      bass(time, ROOT_MIDI - 12 + root, 0.62, 0.44, false);
    } else if (sixteenth === 8) {
      bass(time, ROOT_MIDI - 5 + root, 0.48, 0.32, false);
    }

    const phraseA = [7, 10, 12, 10, 7, 5, 3, 5];
    const phraseB = [7, 8, 10, 12, 10, 8, 7, 5];
    const phrase = bar % 4 < 2 ? phraseA : phraseB;
    if (sixteenth % 4 === 0) {
      const note = ROOT_MIDI + 24 + root + phrase[(bar * 4 + beat) % phrase.length];
      mellowKey(time + 0.015, note, 0.62, bar % 4 === 3 ? 1.08 : 0.9);
    }
  }

  function playStep(step, time, mode, state) {
    const local = step % 64;
    const sixteenth = local % 16;
    const bar = Math.floor(local / 16);
    const progression = PROGRESSIONS[mode];
    const chordRoot = progression[bar % progression.length];
    const chord = chordFor(chordRoot);
    const intensity = Math.min(1.25, 0.62 + Math.max(0, (state.wave || 1) - 1) * 0.025 + (mode === "boss" ? 0.22 : mode === "gigaBoss" ? 0.38 : 0));

    // Drop structure: bars 0-1 full drop, bar 2 build, bar 3 maximum-energy return.
    const buildBar = bar === 2;
    const finalBar = bar === 3;

    if (sixteenth % 4 === 0 && !buildBar) kick(time, finalBar ? 1.08 : 1);
    if (buildBar && sixteenth >= 8 && sixteenth % 2 === 0) kick(time, 0.72 + (sixteenth - 8) * 0.04);
    if (sixteenth === 4 || sixteenth === 12) snare(time, intensity);
    hat(time, false, intensity * (sixteenth % 2 ? 1.12 : 0.78));
    if ([2, 6, 10, 14].includes(sixteenth)) hat(time, true, intensity);

    const bassPattern = [0, 0, 7, 0, 0, 10, 7, 3, 0, 0, 7, 10, 0, 3, 7, 10];
    if (!buildBar || sixteenth >= 8) {
      const note = ROOT_MIDI - 12 + chordRoot + bassPattern[sixteenth];
      bass(time, note, 0.16, intensity, sixteenth % 4 === 0 || mode !== "normal");
    }

    const order = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];
    const octaveJump = finalBar && sixteenth >= 8 ? 12 : 0;
    arp(time + 0.004, ROOT_MIDI + 24 + chord[order[sixteenth]] + octaveJump, 0.08, intensity * (buildBar ? 1.25 : 1));

    if (sixteenth === 0) {
      pad(time, chord, 1.48, intensity * (buildBar ? 0.72 : 1));
      if (bar === 2) riser(time, 1.45, intensity);
    }

    // Anthemic lead hook in bars 1 and 3.
    const hook = [7, 10, 12, 15, 12, 10, 7, 5, 7, 10, 12, 17, 15, 12, 10, 7];
    if ((bar === 1 || finalBar) && sixteenth % 2 === 0) {
      supersaw(time + 0.01, ROOT_MIDI + 24 + hook[sixteenth], 0.19, intensity * (finalBar ? 1.45 : 0.95), finalBar ? 1.2 : 1);
    }

    // Extra rolling kick/reese pressure for bosses.
    if (mode !== "normal" && [6, 14].includes(sixteenth)) kick(time, mode === "gigaBoss" ? 0.62 : 0.48);
  }

  function schedule({ audio, state }) {
    if (!audio?.context || !audio?.musicGain) return;
    init(audio.context, audio.musicGain);

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
      bus.setValueAtTime(Math.max(0.0001, bus.value), now);
      bus.linearRampToValueAtTime(0.08, now + 0.10);
      bus.linearRampToValueAtTime(scene === "upgrade" ? 0.72 : 0.92, now + 0.55);
    }

    if (scene === "upgrade") {
      engine.barLfo.frequency.setTargetAtTime(BPM.upgrade / 240, now, 0.08);
      engine.fastLfo.frequency.setTargetAtTime((BPM.upgrade / 240) * 4, now, 0.08);
      engine.barLfoDepth.gain.setTargetAtTime(520, now, 0.15);
      engine.fastLfoDepth.gain.setTargetAtTime(0.035, now, 0.15);
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
    engine.nextTime = audio.context.currentTime + 0.05;
  }

  window.StarwakeMusicEngine = { schedule, reset };
})();
