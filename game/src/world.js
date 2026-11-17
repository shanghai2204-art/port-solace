// world.js — Port Solace assembled, and advanced one step at a time.
//
// createWorld builds the whole simulation from a seed: the city, Rook,
// the traffic, the crowds, Mara's job list, and the run's bookkeeping
// (heat, events, muzzle flashes), then folds in the saved run if one
// exists. stepWorld is the heartbeat every other module hangs off: it
// steps the systems in their fixed order — player, traffic, car pairs,
// pedestrians, combat, police, missions, audio — and keeps the event
// log trimmed. Deterministic throughout: same seed, same world.
//
// The demo driver lives here too. In demo mode (the title screen, the
// screenshot scenes) no human holds the keys, so demoDrive synthesises
// an input object — walk to the nearest car, get in, then steer between
// intersections, mostly straight through them — and feeds it to the
// ordinary player stepper, so the demo plays by the same rules as a
// person would.

import { VIEW_W, VIEW_H, CAR } from './config.js';
import { generateCity } from './city.js';
import { mulberry32 } from './random.js';
import { createPlayer, stepPlayer } from './player.js';
import { createTraffic, stepTraffic } from './traffic.js';
import { createPeds, stepPeds } from './peds.js';
import { resolveCarPairs } from './drive.js';
import { stepPolice } from './police.js';
import { stepCombat } from './combat.js';
import { createMissions, stepMissions } from './missions.js';
import { stepAudio } from './audio.js';
import { loadSave, applySave, saveGame } from './save.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function createWorld(seed) {
  const rng = mulberry32(seed);
  const world = {
    seed,
    city: generateCity(seed),
    rng,
    cars: [],
    peds: [],
    player: null,
    missions: null,
    events: [],
    flashes: [],
    time: 0,
    heat: 0,
    heatFloor: 0,
    busted: false,
    wasted: false,
    dirtySave: false,
    demo: false,
    lastOutcome: null, // { kind: 'busted' | 'wasted', t } — see stepWorld
    camFocus: null,    // optional { x, y } camera override for the renderer
  };
  world.player = createPlayer(world);
  createTraffic(world, rng);
  createPeds(world, rng);
  createMissions(world);
  const save = loadSave();
  if (save) applySave(world, save);
  return world;
}

export function stepWorld(world, input, dt) {
  world.time += dt;

  if (world.demo) demoDrive(world, dt);
  else stepPlayer(world, input, dt);
  stepTraffic(world, dt);
  resolveCarPairs(world);
  stepPeds(world, dt);
  stepCombat(world, input, dt);
  stepPolice(world, dt);

  // The police raise busted / wasted; the mission step below answers
  // them in the same tick (fine, respawn) and clears the flags, so
  // snapshot the outcome here for main.js to show its overlay.
  if (world.busted) world.lastOutcome = { kind: 'busted', t: world.time };
  else if (world.wasted) world.lastOutcome = { kind: 'wasted', t: world.time };

  stepMissions(world, input, dt);
  stepAudio(world);
  saveGame(world);

  // Age the event log out: nothing downstream reads an event more
  // than a few seconds old, and the log never grows past 200 entries.
  const cutoff = world.time - 3;
  world.events = world.events.filter((ev) => ev.t === undefined || ev.t >= cutoff);
  if (world.events.length > 200) {
    world.events.splice(0, world.events.length - 200);
  }
}

// ---------------------------------------------------------------- demo

function nearestCar(world) {
  const p = world.player;
  let best = null;
  let bestDist = Infinity;
  for (const car of world.cars) {
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return { car: best, dist: bestDist };
}

const DEMO_LANE = 17; // lane offset from a centreline, as traffic.js drives

function nearestLine(lines, v) {
  let best = lines[0];
  let bestDist = Infinity;
  for (const line of lines) {
    const d = Math.abs(line - v);
    if (d < bestDist) {
      bestDist = d;
      best = line;
    }
  }
  return best;
}

// The next centreline strictly ahead of `from` travelling `dir`, or
// null when the road runs out at the world edge first.
function nextCrossLine(lines, from, dir) {
  let best = null;
  let bestDist = Infinity;
  for (const line of lines) {
    const d = (line - from) * dir;
    if (d > 1 && d < bestDist) {
      bestDist = d;
      best = line;
    }
  }
  return best;
}

function roadHeading(road) {
  if (road.axis === 'v') return road.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return road.dir > 0 ? 0 : Math.PI;
}

// Last-resort unstick for the demo driver: put the car back on the
// lane of whichever centreline it is closest to, facing the way it
// already roughly faces, stopped. Only demo mode ever does this — a
// wedged backdrop car would otherwise sit straining forever.
function snapToRoad(world, car) {
  const { verticals, horizontals } = world.city.roads;
  const lv = nearestLine(verticals, car.x);
  const lh = nearestLine(horizontals, car.y);
  if (Math.abs(car.x - lv) <= Math.abs(car.y - lh)) {
    const heading = Math.sin(car.angle) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    car.x = lv + Math.sin(heading) * DEMO_LANE;
    car.angle = heading;
  } else {
    const heading = Math.cos(car.angle) >= 0 ? 0 : Math.PI;
    car.y = lh - Math.cos(heading) * DEMO_LANE;
    car.angle = heading;
  }
  car.vx = 0;
  car.vy = 0;
  car.speed = 0;
}

// Drive the player with a synthetic input, one step. On foot: walk at
// the nearest car and climb in. Driving: follow the road the car is on
// the way traffic does — ride the lane to the next crossing, mostly go
// straight through it, sometimes turn onto the crossing road — so the
// demo never cuts a corner through a block.
export function demoDrive(world, dt) {
  const player = world.player;
  if (!player) return;
  const state = world._demo ?? (world._demo = { road: null, turn: null });
  const city = world.city;

  // The backdrop car is maintained off-screen: crash damage past a
  // car's health kills its engine for good (see drive.js), which
  // would stall the title scene on a dead car forever.
  if (player.car && player.car.damage > 40) player.car.damage = 40;

  const input = {
    keys: new Set(),
    mouse: { x: VIEW_W / 2, y: VIEW_H / 2, down: false },
    down: () => false,
    clearPressed: () => {},
    sprint: false,

    takePressed(code) {
      if (code !== 'KeyF' || player.car) return false;
      return nearestCar(world).dist <= CAR.enterRange;
    },

    walkAxis() {
      const { car } = nearestCar(world);
      if (!car) return { x: 0, y: 0 };
      const dx = car.x - player.x;
      const dy = car.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) return { x: 0, y: 0 };
      return { x: dx / d, y: dy / d };
    },

    driveAxis() {
      const car = player.car;
      if (!car) return { steer: 0, throttle: 0, handbrake: false };

      // A turn that has dragged on for seconds has missed its exit
      // (boxed by traffic, swung too wide): abandon it and re-adopt
      // whatever road the car is actually on now.
      if (state.turn && world.time - state.turn.t0 > 4) {
        state.turn = null;
        state.road = null;
      }

      // Adopt the road the car is on, from the way it is facing.
      if (!state.road) {
        if (Math.abs(Math.sin(car.angle)) > Math.abs(Math.cos(car.angle))) {
          state.road = {
            axis: 'v',
            line: nearestLine(city.roads.verticals, car.x),
            dir: Math.sin(car.angle) >= 0 ? 1 : -1,
            cross: null,
          };
        } else {
          state.road = {
            axis: 'h',
            line: nearestLine(city.roads.horizontals, car.y),
            dir: Math.cos(car.angle) >= 0 ? 1 : -1,
            cross: null,
          };
        }
      }
      const road = state.road;
      const crosses = road.axis === 'v' ? city.roads.horizontals : city.roads.verticals;
      const along = road.axis === 'v' ? car.y : car.x;
      if (road.cross === null && !state.turn) {
        road.cross = nextCrossLine(crosses, along, road.dir);
        if (road.cross === null) {
          // The road runs out at the world edge: turn back down it.
          road.dir = -road.dir;
          road.cross = nextCrossLine(crosses, along, road.dir);
        }
      }

      // Reaching the crossing: mostly straight on, sometimes a turn
      // onto the crossing road. At the last crossing before the road
      // runs out at the world edge a turn is forced — there is no
      // straight on, and a U-turn at the kerb swings wide.
      if (!state.turn && road.cross !== null && (road.cross - along) * road.dir < 6) {
        const arrived = road.cross;
        const beyond = nextCrossLine(crosses, arrived + road.dir, road.dir);
        road.cross = beyond;
        if (world.rng() >= 0.62 || beyond === null) {
          const nAxis = road.axis === 'v' ? 'h' : 'v';
          const nCrosses = nAxis === 'v' ? city.roads.horizontals : city.roads.verticals;
          const cx = road.axis === 'v' ? road.line : arrived;
          const cy = road.axis === 'v' ? arrived : road.line;
          // Prefer a side whose road actually continues.
          const sides = world.rng() < 0.5 ? [-1, 1] : [1, -1];
          for (const side of sides) {
            const na = roadHeading(road) + side * (Math.PI / 2);
            const nDir = nAxis === 'h' ? Math.sign(Math.cos(na)) : Math.sign(Math.sin(na));
            const start = nAxis === 'v' ? cy : cx;
            if (nextCrossLine(nCrosses, start, nDir) === null && side !== sides[sides.length - 1]) {
              continue;
            }
            state.turn = {
              cx,
              cy,
              t0: world.time,
              axis: nAxis,
              line: arrived,
              dir: nDir,
              heading: na,
              // Aim through the crossing at a point on the new lane,
              // 130px past the centre: a stable pursuit target,
              // where the centre itself would invite orbiting.
              exitX: nAxis === 'v' ? arrived + Math.sin(na) * DEMO_LANE : cx + nDir * 130,
              exitY: nAxis === 'v' ? cy + nDir * 130 : arrived - Math.cos(na) * DEMO_LANE,
            };
            break;
          }
        }
      }

      let target;
      if (state.turn) {
        const turn = state.turn;
        target = { x: turn.exitX, y: turn.exitY };
        const past = (car.x - turn.cx) * Math.cos(turn.heading)
          + (car.y - turn.cy) * Math.sin(turn.heading);
        const aligned = Math.abs(wrapAngle(turn.heading - car.angle)) < 0.45;
        const arrivedExit = Math.hypot(turn.exitX - car.x, turn.exitY - car.y) < 30;
        if ((aligned && past > 10) || arrivedExit) {
          state.road = { axis: turn.axis, line: turn.line, dir: turn.dir, cross: null };
          state.turn = null;
          target = null;
        }
      }
      if (!target) {
        // A point on this car's lane, ahead toward the crossing.
        const heading = roadHeading(road);
        const room = road.cross === null
          ? 170
          : Math.max(46, (road.cross - along) * road.dir);
        const ahead = Math.min(170, room);
        target = road.axis === 'v'
          ? { x: road.line + Math.sin(heading) * DEMO_LANE, y: car.y + road.dir * ahead }
          : { x: car.x + road.dir * ahead, y: road.line - Math.cos(heading) * DEMO_LANE };
      }

      const diff = wrapAngle(Math.atan2(target.y - car.y, target.x - car.x) - car.angle);
      const now = world.time;

      // Wedged: stepCar reverts any move that clips a building, so a
      // car nosed into a wall barely moves however long the throttle
      // is held. Straining at walking pace for over a second means
      // exactly that — reverse straight back out along the way the
      // car came in, then try again.
      if (state.reverseUntil !== undefined && now < state.reverseUntil) {
        return { steer: 0, throttle: -0.8, handbrake: false };
      }
      if (Math.abs(car.speed) < 9) {
        if (state.slowSince === undefined) state.slowSince = now;
        else if (now - state.slowSince > 1.1) {
          state.slowSince = undefined;
          // Third escape inside ten seconds: the car is boxed in
          // (a building corner, a neighbour, both) and reversing is
          // not freeing it. Snap it back onto its road instead.
          if (state.escapeWindowStart === undefined || now - state.escapeWindowStart > 10) {
            state.escapeWindowStart = now;
            state.escapes = 0;
          }
          state.escapes = (state.escapes ?? 0) + 1;
          if (state.escapes >= 3) {
            snapToRoad(world, car);
            state.road = null;
            state.turn = null;
            state.escapes = 0;
            state.escapeWindowStart = undefined;
            state.reverseUntil = undefined;
            return { steer: 0, throttle: 0.4, handbrake: false };
          }
          state.reverseUntil = now + 0.75;
          return { steer: 0, throttle: -0.8, handbrake: false };
        }
      } else {
        state.slowSince = undefined;
      }

      // Nose pointing the wrong way down the road: back out and let
      // the geometry change. drive.js flips the yaw in reverse, so
      // the wheel goes the opposite way to swing the nose around.
      if (Math.abs(diff) > 2.3) {
        return { steer: diff > 0 ? -1 : 1, throttle: -0.55, handbrake: false };
      }
      const steer = clamp(diff * 1.8, -1, 1);
      const throttle = Math.abs(diff) > 1.0 ? 0.25 : 0.85;
      return { steer, throttle, handbrake: false };
    },
  };

  stepPlayer(world, input, dt);
}
