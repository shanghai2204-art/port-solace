// peds.js — the pedestrians of Port Solace.
//
// Pedestrians are seeded from the city's sidewalk spawn table and stroll
// between nearby sidewalk points: they walk a leg, pause a moment, pick
// another point and walk on. They are not brave. A fresh gunshot or crash
// event nearby, or a car bearing down on them at speed, sends them
// running directly away from the threat for a few seconds. A car that
// actually reaches one knocks them down for a moment and reports a
// 'hitped' event — the police system draws its own conclusions.
//
// Ped shape: { x, y, angle, speed, state ('walk' | 'idle' | 'flee' |
// 'down'), color, walkSpeed, tx, ty (stroll target), wait (idle timer),
// panic (flee timer), fx, fy (point fled from), down (knockdown timer) }.

import { CAR_CLASSES } from './config.js';
import { mulberry32, range, pick, chance } from './random.js';

const MAX_PEDS = 130;
const PED_RADIUS = 9;
const FLEE_DIST = 170; // events within this range spook a pedestrian
const DODGE_DIST = 120; // a fast car within this range does too
const DODGE_SPEED = 200;
const FLEE_SPEED = 232;

const PED_COLORS = ['#c9c2b4', '#8a4a3a', '#3a5a78', '#6b7d4f', '#b09872', '#5d4a68', '#946b54', '#4f6b6b'];

const fallbackRng = mulberry32(777);

function rngOf(world) {
  return world.rng ?? fallbackRng;
}

// Choose the next stroll target: one of the city's sidewalk points
// within a few blocks, preferring points on the same pavement line (same
// x or same y) so most legs run straight along a sidewalk; a leg to a
// perpendicular point cuts the corner at the junction, which reads as
// crossing the road. Falls back to standing still when nothing is near.
function pickTarget(world, ped, rng) {
  const pts = world.city.spawnPoints.peds;
  let sameLine = null;
  let anyNear = null;
  for (let tries = 0; tries < 8; tries++) {
    const p = pts[Math.floor(rng() * pts.length)];
    const dx = p.x - ped.x;
    const dy = p.y - ped.y;
    if (dx * dx + dy * dy > 460 * 460) continue;
    if (Math.abs(dx) < 9 || Math.abs(dy) < 9) {
      sameLine = p;
      break;
    }
    anyNear = anyNear ?? p;
  }
  const target = sameLine ?? anyNear;
  if (target) {
    ped.tx = target.x + range(rng, -4, 4);
    ped.ty = target.y + range(rng, -4, 4);
  } else {
    ped.tx = ped.x;
    ped.ty = ped.y;
  }
}

export function createPeds(world, rng) {
  world.rng = world.rng ?? rng;
  for (const spot of world.city.spawnPoints.peds) {
    if (world.peds.length >= MAX_PEDS) break;
    if (!chance(rng, 0.55)) continue;
    const ped = {
      x: spot.x + range(rng, -3, 3),
      y: spot.y + range(rng, -3, 3),
      angle: range(rng, 0, Math.PI * 2),
      speed: 0,
      state: 'walk',
      color: pick(rng, PED_COLORS),
      walkSpeed: range(rng, 52, 84),
      tx: spot.x,
      ty: spot.y,
      wait: 0,
      panic: 0,
      fx: 0,
      fy: 0,
      down: 0,
    };
    pickTarget(world, ped, rng);
    world.peds.push(ped);
  }
}

// Move one pedestrian and keep it out of the buildings.
function movePed(world, ped, dirX, dirY, targetSpeed, dt) {
  const rate = 900; // px/s^2 of speed change: brisk but not robotic
  ped.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - ped.speed));
  if (ped.speed > 1) ped.angle = Math.atan2(dirY, dirX);
  const nx = ped.x + dirX * ped.speed * dt;
  const ny = ped.y + dirY * ped.speed * dt;
  const c = world.city.collide(nx, ny, PED_RADIUS);
  ped.x = c.x;
  ped.y = c.y;
}

export function stepPeds(world, dt) {
  const rng = rngOf(world);
  const city = world.city;

  for (const ped of world.peds) {
    // Knocked down: lie there until the timer runs out.
    if (ped.down > 0) {
      ped.down -= dt;
      ped.speed = 0;
      ped.state = 'down';
      continue;
    }
    if (ped.state === 'down') ped.state = 'walk';

    // Threats: fresh loud events, then fast cars.
    let threat = null;
    for (const ev of world.events) {
      if (ev.type !== 'shot' && ev.type !== 'crash') continue;
      if (ev.t !== undefined && world.time !== undefined && world.time - ev.t > 0.15) continue;
      const dx = ped.x - ev.x;
      const dy = ped.y - ev.y;
      if (dx * dx + dy * dy < FLEE_DIST * FLEE_DIST) {
        threat = ev;
        break;
      }
    }
    if (!threat) {
      for (const car of world.cars) {
        if (Math.abs(car.speed) < DODGE_SPEED) continue;
        const dx = ped.x - car.x;
        const dy = ped.y - car.y;
        if (dx * dx + dy * dy < DODGE_DIST * DODGE_DIST) {
          threat = car;
          break;
        }
      }
    }
    if (threat) {
      ped.state = 'flee';
      ped.panic = Math.max(ped.panic, 2.4);
      ped.fx = threat.x;
      ped.fy = threat.y;
    }

    // Run down: a moving car whose body reaches the pedestrian.
    let hit = false;
    for (const car of world.cars) {
      if (Math.abs(car.speed) < 45) continue;
      const reach = CAR_CLASSES[car.cls].w / 2 + PED_RADIUS - 4;
      const dx = ped.x - car.x;
      const dy = ped.y - car.y;
      if (dx * dx + dy * dy < reach * reach) {
        hit = true;
        break;
      }
    }
    if (hit) {
      ped.down = 1.3;
      ped.speed = 0;
      ped.state = 'down';
      world.events.push({ type: 'hitped', x: ped.x, y: ped.y, severity: 3, t: world.time ?? 0 });
      continue;
    }

    if (ped.state === 'flee') {
      ped.panic -= dt;
      let dx = ped.x - ped.fx;
      let dy = ped.y - ped.fy;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        dx = Math.cos(ped.angle);
        dy = Math.sin(ped.angle);
      } else {
        dx /= d;
        dy /= d;
      }
      movePed(world, ped, dx, dy, FLEE_SPEED, dt);
      if (ped.panic <= 0) {
        ped.state = 'walk';
        pickTarget(world, ped, rng);
      }
    } else if (ped.wait > 0) {
      ped.wait -= dt;
      ped.state = 'idle';
      movePed(world, ped, 0, 0, 0, dt);
    } else {
      ped.state = 'walk';
      const dx = ped.tx - ped.x;
      const dy = ped.ty - ped.y;
      const d = Math.hypot(dx, dy);
      if (d < 7) {
        if (chance(rng, 0.5)) ped.wait = range(rng, 0.4, 2.8);
        else pickTarget(world, ped, rng);
        movePed(world, ped, 0, 0, 0, dt);
      } else {
        movePed(world, ped, dx / d, dy / d, ped.walkSpeed, dt);
      }
    }
  }
}
