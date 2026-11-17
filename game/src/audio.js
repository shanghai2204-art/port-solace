// audio.js — the sound of Port Solace, synthesised live with WebAudio.
//
// No samples, no assets: an engine hum whose pitch follows the player
// car's speed, a two-tone siren that swells as the nearest police unit
// closes in, and one-shot noises for the loud moments the world reports
// as events — gunshots, crashes, a job done, a bust, a wasting. The
// context is created lazily on the first user gesture (browsers refuse
// one sooner), M toggles mute, and every entry point is defensive: with
// no AudioContext at all (a headless harness, an old browser) the whole
// module quietly does nothing.

let actx = null;
let master = null;
let noiseBuf = null;
let engineOsc = null;
let engineFilter = null;
let engineGain = null;
let sirenOsc = null;
let sirenGain = null;
let muted = false;
let seenEvents = new WeakSet();

function audioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

// Create the context and the two standing voices (engine, siren), and
// arm the mute key. Safe to call on every gesture; only the first one
// builds anything. Called by main.js on the first pointer/key press.
export function unlockAudio() {
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    if (!actx) {
      actx = new Ctor();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(actx.destination);

      // A second of white noise, shared by every burst and thud.
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      // Engine: a detuned saw through a lowpass, gain parked at zero
      // until the player is actually driving.
      engineOsc = actx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      engineFilter = actx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineFilter.Q.value = 2;
      engineGain = actx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();

      // Siren: a square wave whose pitch stepAudio flips between two
      // tones; its gain follows the nearest unit's distance.
      sirenOsc = actx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 700;
      sirenGain = actx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();

      window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyM') toggleMute();
      });
    }
    if (actx.state === 'suspended') {
      const p = actx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch {
    actx = null; // audio is a garnish; never let it break the game
  }
}

export function toggleMute() {
  muted = !muted;
  if (master && actx) {
    master.gain.setTargetAtTime(muted ? 0 : 0.5, actx.currentTime, 0.03);
  }
  return muted;
}

export function isMuted() {
  return muted;
}

// One noise burst through a bandpass: a gunshot's crack.
function noiseBurst(when, freq, q, gain, dur) {
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(when);
  src.stop(when + dur + 0.02);
}

// One oscillator note with a soft envelope: chimes and stings.
function tone(when, type, from, to, gain, dur) {
  const osc = actx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), when + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

function playEvent(ev) {
  const now = actx.currentTime;
  switch (ev.type) {
    case 'shot':
      noiseBurst(now, 1900, 0.8, 0.20, 0.09);
      break;
    case 'crash': {
      const sev = Math.min(5, Math.max(1, ev.severity ?? 1));
      tone(now, 'sine', 130, 38, 0.10 + sev * 0.05, 0.28);
      noiseBurst(now, 300, 0.6, 0.05 + sev * 0.03, 0.16);
      break;
    }
    case 'missionDone':
      tone(now, 'sine', 660, 660, 0.16, 0.14);
      tone(now + 0.13, 'sine', 990, 990, 0.16, 0.22);
      break;
    case 'busted':
      tone(now, 'triangle', 392, 392, 0.2, 0.16);
      tone(now + 0.17, 'triangle', 311, 311, 0.2, 0.16);
      tone(now + 0.34, 'triangle', 233, 220, 0.22, 0.3);
      break;
    case 'wasted':
      tone(now, 'sawtooth', 196, 49, 0.16, 0.7);
      break;
    default:
      break;
  }
}

// Per-step audio: keep the two standing voices honest about the world,
// then fire one-shots for any event not yet heard.
export function stepAudio(world) {
  if (!actx || !master) return;
  try {
    const t = actx.currentTime;
    const player = world.player;

    // Engine hum: only while the player is driving, pitched and
    // brightened by speed.
    let engGain = 0;
    let engFreq = 52;
    let engCut = 320;
    if (player && player.car) {
      const spd = Math.abs(player.car.speed ?? 0);
      const top = 545; // the fastest class in config.js
      const f = Math.min(1, spd / top);
      engGain = 0.028 + f * 0.075;
      engFreq = 52 + spd * 0.42;
      engCut = 300 + f * 1500;
    }
    engineGain.gain.setTargetAtTime(engGain, t, 0.06);
    engineOsc.frequency.setTargetAtTime(engFreq, t, 0.05);
    engineFilter.frequency.setTargetAtTime(engCut, t, 0.08);

    // Siren: lit stars and a unit within earshot. The tone flips about
    // three times a second; the gain falls off with distance.
    let siren = 0;
    if (player && (player.wanted ?? 0) > 0) {
      let nearest = Infinity;
      for (const car of world.cars) {
        if (car.driver !== 'cop') continue;
        const d = Math.hypot(car.x - player.x, car.y - player.y);
        if (d < nearest) nearest = d;
      }
      if (nearest < 950) siren = (1 - nearest / 950) * 0.05;
    }
    sirenGain.gain.setTargetAtTime(siren, t, 0.09);
    if (siren > 0.001) {
      const toneHz = Math.floor((world.time ?? 0) * 2.8) % 2 === 0 ? 700 : 950;
      sirenOsc.frequency.setTargetAtTime(toneHz, t, 0.02);
    }

    // One-shots: every event is heard exactly once.
    for (const ev of world.events) {
      if (seenEvents.has(ev)) continue;
      seenEvents.add(ev);
      playEvent(ev);
    }
  } catch {
    // A failed audio step must never take the simulation down.
  }
}

// Test hook for harnesses that swap worlds: forget which events the
// previous world already played.
export function resetAudioEvents() {
  seenEvents = new WeakSet();
}
