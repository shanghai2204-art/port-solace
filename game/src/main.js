// Port Solace — an original top-down open-world crime game.
//
// A living grid city of six districts with lane-following traffic and
// crowds on the pavements. You are Rook, a dock courier turned
// wheelman: steal and drive any car on the street, work five story
// missions for Mara Voss — the fixer who runs the Harbor cafe — and
// stay ahead of a five-star wanted system whose police pursue, ram
// and box you in. Busted or wasted costs a fine and a trip to the
// station or the hospital, never the run.
//
// How to play: WASD / arrows walk and drive · F enter or exit a car ·
// mouse aims, click shoots (on foot) · E takes a job at Mara's cafe ·
// P or Esc pauses · M mutes.
// Tech: vanilla JavaScript on a 2D canvas, WebAudio-synthesised sound
// (no audio assets), a deterministic seeded city, localStorage save.
//
// main.js is the shell: the fixed-step loop, the screen states (title,
// play, pause, busted/wasted, story complete), and the staged
// screenshot scenes the ?shot= parameter asks for.

import { VIEW_W, VIEW_H } from './config.js';
import { createInput } from './input.js';
import { createWorld, stepWorld } from './world.js';
import { draw, drawTitle, drawBanner, drawBustedWasted, drawComplete } from './render.js';
import { unlockAudio } from './audio.js';
import { clearSave } from './save.js';
import { MISSIONS } from './missions.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const SEED = Number.isFinite(seedParam) ? seedParam : 1337;
const STEP = 1 / 120;

// An input that does nothing: the title screen's demo world, the
// pause screen and the screenshot scenes step with this, so no stray
// key or click can fire a shot or take a job off-camera.
const stubInput = {
  keys: new Set(),
  mouse: { x: VIEW_W / 2, y: VIEW_H / 2, down: false },
  down: () => false,
  takePressed: () => false,
  clearPressed: () => {},
  walkAxis: () => ({ x: 0, y: 0 }),
  driveAxis: () => ({ steer: 0, throttle: 0, handbrake: false }),
  sprint: false,
};

let world = null;
function setWorld(w) {
  world = w;
  window.__world = w;
}

// Put the player behind the wheel of the car nearest a spot: the
// title screen's cruising shot of the city.
function stageCruise(w, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const car of w.cars) {
    if (car.cls === 'police') continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  if (!best) return;
  best.driver = 'player';
  best.parked = false;
  w.player.car = best;
  w.player.x = best.x;
  w.player.y = best.y;
  w.player.angle = best.angle;
}

function makeTitleWorld() {
  const w = createWorld(SEED);
  stageCruise(w, 1920, 600); // downtown, rolling
  w.demo = true;
  return w;
}

// ------------------------------------------------------- screenshot scenes

function freshShotWorld() {
  const w = createWorld(SEED);
  // A saved run must not leak into a staged scene.
  w.player.cash = 250;
  w.missions.done = [];
  return w;
}

function fastForward(w, seconds) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) stepWorld(w, stubInput, dt);
}

function stageChase(w) {
  let car = w.cars.find((c) => c.cls === 'sports');
  if (!car) {
    car = w.cars[0];
    car.cls = 'sports';
    car.color = '#c23b2e';
  }
  car.x = 1760;
  car.y = 1440;
  car.angle = 0;
  car.speed = 300;
  car.vx = 300;
  car.vy = 0;
  car.driver = 'player';
  car.parked = false;
  car.turn = null;
  w.player.car = car;
  w.player.x = car.x;
  w.player.y = car.y;
  w.player.angle = 0;
  w.heat = 250; // three stars
  // Two units already on the tail; the heat summons the rest.
  for (const [off, lane] of [[130, -8], [245, 10]]) {
    w.cars.push({
      x: 1760 - off,
      y: 1440 + lane,
      angle: 0,
      speed: 285,
      vx: 285,
      vy: 0,
      cls: 'police',
      color: '#262b36',
      damage: 0,
      driver: 'cop',
      parked: false,
      slot: 900 + off,
      _bumpCd: 0,
    });
  }
  w.demo = true;
}

function stageHarbor(w) {
  const st = w.missions;
  w.player.x = 545;
  w.player.y = 1690;
  w.player.angle = Math.atan2(1760 - 1690, 480 - 545); // facing the drop
  st.current = 0;
  st.stepIndex = 2; // M1's deliver step, package in hand
  st.active = true;
  st.carrying = 'package';
  st.title = MISSIONS[0].title;
  st.brief = MISSIONS[0].brief;
  w.demo = false;
}

function stageComplete(w) {
  w.missions.done = MISSIONS.map((m) => m.id);
  w.player.cash = 3350; // the starting $250 plus all five payouts
}

function stageShot(name) {
  const w = freshShotWorld();
  let overlay = null;
  if (name === 'title') {
    stageCruise(w, 1920, 600);
    w.demo = true;
    fastForward(w, 2.5);
    overlay = () => drawTitle(ctx, w);
  } else if (name === 'chase') {
    stageChase(w);
    fastForward(w, 2.5);
  } else if (name === 'harbor') {
    stageHarbor(w);
    fastForward(w, 2.5);
  } else if (name === 'complete') {
    stageComplete(w);
    fastForward(w, 1.5);
    w.events.push({ type: 'missionDone', id: 'm5', x: w.player.x, y: w.player.y, t: w.time });
  } else {
    fastForward(w, 0.5);
  }
  setWorld(w);
  draw(ctx, w, stubInput);
  if (overlay) overlay();
  window.__shotReady = true;
  // Hold the staged frame: redraw it, never advance it, so a capture
  // taken at any moment sees exactly this scene.
  const hold = () => {
    draw(ctx, w, stubInput);
    if (overlay) overlay();
    requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
}

// ---------------------------------------------------------------- live game

const shot = params.get('shot');
if (shot) {
  stageShot(shot);
} else {
  const input = createInput(canvas);
  window.addEventListener('pointerdown', unlockAudio, { once: false });
  window.addEventListener('keydown', unlockAudio, { once: false });

  let state = 'title';
  let stateSince = performance.now();
  let overUntil = 0;
  let handledOutcomeT = -1;
  let prevDone = 0;
  let justCompletedAll = false;
  let completeShown = false;

  setWorld(makeTitleWorld());

  function setState(next) {
    state = next;
    stateSince = performance.now();
  }

  function startPlay() {
    const w = createWorld(SEED);
    w.demo = false;
    setWorld(w);
    prevDone = w.missions.done.length;
    justCompletedAll = false;
    handledOutcomeT = -1;
    setState('play');
  }

  function anyPress() {
    return input.mouse.down || input.keys.size > 0;
  }

  // Start/continue only on a fresh press: a key still held from the
  // previous screen (or the N that just cleared the save) must be
  // released before it can press again.
  let titleArmed = false;
  let completeArmed = false;

  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let delta = (now - last) / 1000;
    last = now;
    if (delta > 0.1) delta = 0.1; // a stalled tab never fast-forwards

    if (state === 'title') {
      if (!anyPress()) titleArmed = true;
      if (input.takePressed('KeyN')) {
        clearSave();
        setWorld(makeTitleWorld());
        titleArmed = false;
      } else if (titleArmed && anyPress() && now - stateSince > 250) {
        titleArmed = false;
        startPlay();
      }
      if (state === 'title') {
        acc += delta;
        while (acc >= STEP) {
          stepWorld(world, stubInput, STEP);
          acc -= STEP;
          if (acc > STEP * 10) { acc = 0; break; }
        }
      }
    } else if (state === 'play') {
      if (input.takePressed('Escape') || input.takePressed('KeyP')) {
        setState('pause');
      } else {
        acc += delta;
        while (acc >= STEP) {
          stepWorld(world, input, STEP);
          acc -= STEP;
          if (acc > STEP * 10) { acc = 0; break; }
        }
        const doneNow = world.missions.done.length;
        if (doneNow === MISSIONS.length && prevDone < MISSIONS.length) {
          justCompletedAll = true;
        }
        prevDone = doneNow;
        if (world.lastOutcome && world.lastOutcome.t > handledOutcomeT) {
          handledOutcomeT = world.lastOutcome.t;
          overUntil = now + 2600;
          setState('over');
        } else if (justCompletedAll && !completeShown) {
          completeShown = true;
          setState('complete');
        }
      }
    } else if (state === 'pause') {
      if (input.takePressed('Escape') || input.takePressed('KeyP')) {
        setState('play');
      }
    } else if (state === 'over') {
      if (now >= overUntil) {
        if (justCompletedAll && !completeShown) {
          completeShown = true;
          setState('complete');
        } else {
          setState('play');
        }
      }
    } else if (state === 'complete') {
      if (!anyPress()) completeArmed = true;
      if (completeArmed && anyPress() && now - stateSince > 300) {
        completeArmed = false;
        justCompletedAll = false;
        setState('play');
      }
    }

    const viewInput = state === 'play' ? input : stubInput;
    draw(ctx, world, viewInput);
    if (state === 'title') drawTitle(ctx, world);
    else if (state === 'pause') drawBanner(ctx, 'Paused', 'Esc or P to resume');
    else if (state === 'over') drawBustedWasted(ctx, world);
    else if (state === 'complete') drawComplete(ctx, world);

    input.clearPressed();
  }

  requestAnimationFrame(frame);
}
