// missions.js — Mara Voss's jobs: the story of Port Solace as data,
// plus the small state machine that runs it.
//
// Five missions, always offered in order at Mara's cafe in Old Town:
// stand at the cafe marker in free roam and press E to take the next
// one. Each mission is a list of steps (goto / pickup / deliver /
// stealClass / escape) with an objective point and a line of text for
// the HUD; some steps lean on the police system — a heat floor that
// keeps the law interested during a ride, a slug of heat that starts
// the finale's escape. Completing a mission pays out, records the id
// in state.done and flags world.dirtySave. Failing (a timer runs out,
// or the player is busted / wasted mid-job) drops back to free roam
// and the job can be taken again. Busted and wasted are answered here
// wherever they happen: a fine of 10% of cash (at least $50, never
// more than the player has) and a respawn — hospital if wasted, the
// station if busted — with the heat wiped clean.

import { PLAYER } from './config.js';

// Landmarks. Road intersections and their corners, so every marker is
// somewhere a car can reach and a pedestrian can stand.
const CAFE = { x: 1493, y: 1813 };            // Mara's cafe, Old Town
const HARBOR_WAREHOUSE = { x: 480, y: 1760 }; // the drop in the Harbor
const CHOP_SHOP = { x: 800, y: 800 };         // pays for sports cars, The Flats
const GARDEN_DROPOFF = { x: 2240, y: 1760 };  // Garden Row
const DOWNTOWN_PICKUP = { x: 1920, y: 480 };  // the finale's package
const HOSPITAL = { x: 1760, y: 1120 };        // wasted respawn, Downtown
const STATION = { x: 480, y: 480 };           // busted respawn, The Flats

const CAFE_RADIUS = 55; // stand this close and press E to take a job
const DEFAULT_RADIUS = 55;

export const MISSIONS = [
  {
    id: 'm1',
    title: 'First Run',
    payout: 300,
    brief: [
      "Mara: Rook. You drive, you don't ask what's in the box.",
      'Mara: Pick it up outside the cafe. Drop it at the harbor warehouse.',
      'Mara: Clean run, clean money.',
    ],
    steps: [
      { type: 'goto', x: CAFE.x, y: CAFE.y, radius: 60, text: "Go to Mara's cafe" },
      { type: 'pickup', x: CAFE.x, y: CAFE.y, radius: 40, cargo: 'package', text: 'Pick up the package (on foot)' },
      { type: 'deliver', x: HARBOR_WAREHOUSE.x, y: HARBOR_WAREHOUSE.y, radius: 60, needsCargo: 'package', text: 'Deliver the package to the harbor warehouse' },
    ],
  },
  {
    id: 'm2',
    title: 'Hot Metal',
    payout: 450,
    brief: [
      'Mara: The chop shop in the Flats is short a sports car.',
      'Mara: Find one. Take it. Try not to gift-wrap it in police tape.',
    ],
    steps: [
      { type: 'stealClass', cls: 'sports', text: 'Steal a sports car' },
      { type: 'deliver', x: CHOP_SHOP.x, y: CHOP_SHOP.y, radius: 60, inCar: true, needsClass: 'sports', text: 'Deliver the sports car to the chop shop' },
    ],
  },
  {
    id: 'm3',
    title: 'Clockwork',
    payout: 500,
    timeLimit: 150,
    brief: [
      "Mara: Five corners of this city, one clock. Don't sightsee.",
    ],
    steps: [
      { type: 'goto', x: 480, y: 480, radius: 55, text: 'Checkpoint 1 of 5 — The Flats' },
      { type: 'goto', x: 2080, y: 480, radius: 55, text: 'Checkpoint 2 of 5 — Downtown' },
      { type: 'goto', x: 2720, y: 1440, radius: 55, text: 'Checkpoint 3 of 5 — Airstrip Flats' },
      { type: 'goto', x: 480, y: 2080, radius: 55, text: 'Checkpoint 4 of 5 — the Harbor' },
      { type: 'goto', x: 2080, y: 2080, radius: 55, text: 'Checkpoint 5 of 5 — Garden Row' },
    ],
  },
  {
    id: 'm4',
    title: 'Escort',
    payout: 650,
    brief: [
      "Mara: I'm riding with you this time. Garden Row.",
      'Mara: The law will notice us, Rook. Keep moving.',
    ],
    steps: [
      { type: 'pickup', x: CAFE.x, y: CAFE.y, radius: 40, cargo: 'mara', text: 'Pick up Mara at the cafe (on foot)' },
      { type: 'deliver', x: GARDEN_DROPOFF.x, y: GARDEN_DROPOFF.y, radius: 60, inCar: true, needsCargo: 'mara', heatFloor: 200, text: 'Drive Mara to Garden Row' },
    ],
  },
  {
    id: 'm5',
    title: 'Solace Burning',
    payout: 1200,
    brief: [
      'Mara: Last job, Rook. The package is waiting downtown.',
      'Mara: After you grab it, every badge in Solace lights up.',
      "Mara: Vanish. Then we're done.",
    ],
    steps: [
      { type: 'pickup', x: DOWNTOWN_PICKUP.x, y: DOWNTOWN_PICKUP.y, radius: 40, cargo: 'package', text: 'Pick up the package downtown (on foot)' },
      { type: 'escape', setHeat: 350, text: 'Lose the police — get your stars to zero' },
    ],
  },
];

export function createMissions(world) {
  const state = {
    current: -1,      // index into MISSIONS, or -1 in free roam
    stepIndex: 0,
    active: false,
    done: [],         // mission ids, in completion order
    failed: null,     // id of the last failed mission, while failT runs
    failT: 0,         // seconds left to show the failure
    carrying: null,   // cargo id from the last pickup step
    timeLeft: null,   // mission-level timer, when the mission has one
    stepTimeLeft: null,
    title: null,
    brief: null,
  };
  if (world) world.missions = state;
  return state;
}

// Side effects that belong to arriving at a step: the finale's escape
// opens with the whole force lit up.
function applyStepEntry(state, world) {
  const step = MISSIONS[state.current]?.steps[state.stepIndex];
  if (!step) return;
  if (step.setHeat !== undefined) world.heat = step.setHeat;
  state.stepTimeLeft = step.timeLimit ?? null;
}

export function startMission(state, world, i) {
  const m = MISSIONS[i];
  if (!m) return;
  state.current = i;
  state.stepIndex = 0;
  state.active = true;
  state.carrying = null;
  state.title = m.title;
  state.brief = m.brief;
  state.timeLeft = m.timeLimit ?? null;
  applyStepEntry(state, world);
}

function endMission(state, world) {
  state.current = -1;
  state.stepIndex = 0;
  state.active = false;
  state.carrying = null;
  state.timeLeft = null;
  state.stepTimeLeft = null;
  state.title = null;
  state.brief = null;
  if (world.heatFloor !== undefined) delete world.heatFloor;
}

function failMission(state, world) {
  const m = MISSIONS[state.current];
  if (m) {
    state.failed = m.id;
    state.failT = 3.5;
  }
  endMission(state, world);
}

function completeMission(state, world) {
  const m = MISSIONS[state.current];
  const player = world.player;
  player.cash += m.payout;
  state.done.push(m.id);
  world.events.push({
    type: 'missionDone',
    id: m.id,
    x: player.x,
    y: player.y,
    t: world.time ?? 0,
  });
  world.dirtySave = true;
  endMission(state, world);
}

// The bust / wasted consequence: fine, out of the car, back on your
// feet at the station or the hospital with full health and no heat.
export function respawnPlayer(world) {
  const player = world.player;
  if (!player) return;
  const fine = Math.min(player.cash, Math.max(50, Math.round(player.cash * 0.1)));
  player.cash -= fine;
  if (player.car) {
    player.car.driver = null;
    player.car.parked = true;
    player.car.speed = 0;
    player.car.vx = 0;
    player.car.vy = 0;
    player.car = null;
  }
  const home = world.wasted ? HOSPITAL : STATION;
  player.x = home.x;
  player.y = home.y;
  player.vx = 0;
  player.vy = 0;
  player.speed = 0;
  player.health = PLAYER.maxHealth;
  world.heat = 0;
  if (world.heatFloor !== undefined) delete world.heatFloor;
  world.busted = false;
  world.wasted = false;
  world._bustT = 0;
}

function stepSatisfied(state, world, step) {
  const p = world.player;
  const d = Math.hypot(p.x - (step.x ?? p.x), p.y - (step.y ?? p.y));
  const radius = step.radius ?? DEFAULT_RADIUS;
  switch (step.type) {
    case 'goto':
      if (d > radius) return false;
      if (step.inCar && !p.car) return false;
      if (step.onFoot && p.car) return false;
      return true;
    case 'pickup':
      return !p.car && d <= radius;
    case 'deliver':
      if (d > radius) return false;
      if (step.inCar && !p.car) return false;
      if (step.needsClass && (!p.car || p.car.cls !== step.needsClass)) return false;
      if (step.needsCargo && state.carrying !== step.needsCargo) return false;
      return true;
    case 'stealClass':
      return !!p.car && p.car.cls === step.cls;
    case 'escape':
      return (world.heat ?? 0) <= 0 && (p.wanted ?? 0) === 0;
    default:
      return false;
  }
}

export function stepMissions(world, input, dt) {
  const state = world.missions ?? createMissions(world);
  const player = world.player;
  if (!player) return state;

  if (state.failT > 0) {
    state.failT -= dt;
    if (state.failT <= 0) state.failed = null;
  }

  // Busted or wasted ends everything, mission or not.
  if (world.busted || world.wasted) {
    if (state.active) failMission(state, world);
    respawnPlayer(world);
    return state;
  }

  if (!state.active) {
    // Free roam: the cafe marker offers the next unfinished job.
    const d = Math.hypot(player.x - CAFE.x, player.y - CAFE.y);
    if (d <= CAFE_RADIUS && input.takePressed('KeyE')) {
      const next = MISSIONS.findIndex((m) => !state.done.includes(m.id));
      if (next >= 0) startMission(state, world, next);
    }
    return state;
  }

  const mission = MISSIONS[state.current];
  const step = mission.steps[state.stepIndex];

  // A step may pin the heat (Mara's escort keeps two stars lit).
  if (step.heatFloor !== undefined) world.heatFloor = step.heatFloor;
  else if (world.heatFloor !== undefined) delete world.heatFloor;

  // Timers: mission-wide (Clockwork) and per-step.
  if (state.timeLeft !== null) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      failMission(state, world);
      return state;
    }
  }
  if (state.stepTimeLeft !== null) {
    state.stepTimeLeft -= dt;
    if (state.stepTimeLeft <= 0) {
      failMission(state, world);
      return state;
    }
  }

  if (stepSatisfied(state, world, step)) {
    if (step.type === 'pickup') state.carrying = step.cargo ?? state.carrying;
    if (step.type === 'deliver') state.carrying = null;
    state.stepIndex++;
    if (state.stepIndex >= mission.steps.length) {
      completeMission(state, world);
    } else {
      applyStepEntry(state, world);
    }
  }
  return state;
}

// What the HUD points at: the current step's marker and line, or the
// cafe while a job is still on offer in free roam.
export function currentObjective(state) {
  if (!state) return null;
  if (state.active) {
    const step = MISSIONS[state.current]?.steps[state.stepIndex];
    if (!step) return null;
    return { x: step.x ?? null, y: step.y ?? null, text: step.text };
  }
  if (state.done.length < MISSIONS.length) {
    return { x: CAFE.x, y: CAFE.y, text: 'Meet Mara at the cafe — press E' };
  }
  return null;
}
