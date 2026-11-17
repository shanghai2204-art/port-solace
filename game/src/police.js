// police.js — the law in Port Solace.
//
// Crimes arrive as world events (theft, hitped, crash, shot) and are
// converted into heat: 0..500 crime points, shown to the player as
// 0..5 stars (player.wanted). Heat fades slowly while a patrol has the
// player in contact range and faster once they break away. While any
// stars are lit, police cars spawn on the roads a few blocks out and
// pursue with a simple interception steer: they aim where the player
// is going, ram when close, and box a slow player in — hold the player
// nearly stopped next to a unit for a couple of seconds and it is a
// bust. Consequences (respawn, fines, mission failure) are not handled
// here: this module only raises world.busted / world.wasted, once.

import { WORLD_W, WORLD_H, CAR_CLASSES } from './config.js';
import { stepCar } from './drive.js';
import { mulberry32, range, pick } from './random.js';

const HEAT_MAX = 500;
const CONTACT_DIST = 420; // a unit this close is "in contact"
const DECAY_FREE = 4;     // heat per second shed while unseen
const DECAY_SEEN = 0.8;   // heat per second shed while in contact
const SPAWN_MIN = 800;    // units appear on roads this far out...
const SPAWN_MAX = 1000;   // ...up to this far
const DESPAWN_DIST = 1500;
const SPAWN_CD = 0.5;     // seconds between reinforcements
const BUST_DIST = 90;
const BUST_SPEED = 25;    // player slower than this is being held
const BUST_TIME = 2.5;    // ...for this long, next to a unit
const COP_COLOR = '#262b36';

const fallbackRng = mulberry32(9091);

function rngOf(world) {
  return world.rng ?? fallbackRng;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function heatToStars(heat) {
  if (heat <= 0) return 0;
  return Math.min(5, Math.ceil(heat / 100));
}

// Did the player cause this event? Events may carry an explicit
// byPlayer flag; without one we fall back to proximity — an event
// within 60px of the player (whose position is the car's, while
// driving) is treated as the player's.
function playerCaused(world, ev) {
  if (ev.byPlayer !== undefined) return ev.byPlayer;
  const p = world.player;
  if (!p) return false;
  return Math.hypot(ev.x - p.x, ev.y - p.y) <= 60;
}

// Heat owed for one world event. Crashes and hit-peds only count when
// the player caused them: traffic flattens its own pedestrians often
// enough that charging those to the player would pin an innocent
// bystander at five stars within seconds.
function heatForEvent(world, ev) {
  switch (ev.type) {
    case 'theft': return 60;
    case 'hitped': return playerCaused(world, ev) ? 90 : 0;
    case 'shot': return 50;
    case 'crash': return playerCaused(world, ev) ? 8 * (ev.severity ?? 1) : 0;
    default: return 0;
  }
}

// Place one unit on a road centreline 800-1000px from the player.
function spawnCop(world, rng) {
  const city = world.city;
  const p = world.player;
  for (let tries = 0; tries < 14; tries++) {
    const vertical = rng() < 0.5;
    const line = vertical ? pick(rng, city.roads.verticals) : pick(rng, city.roads.horizontals);
    const along = vertical ? range(rng, 40, WORLD_H - 40) : range(rng, 40, WORLD_W - 40);
    const dir = rng() < 0.5 ? 1 : -1;
    const angle = vertical ? dir * (Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const x = vertical ? line + Math.sin(angle) * 17 : along;
    const y = vertical ? along : line - Math.cos(angle) * 17;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
    let clear = true;
    for (const other of world.cars) {
      if (Math.hypot(other.x - x, other.y - y) < 55) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    world._copSeq = (world._copSeq ?? 0) + 1;
    world.cars.push({
      x, y, angle,
      speed: 0,
      vx: 0,
      vy: 0,
      cls: 'police',
      color: COP_COLOR,
      damage: 0,
      driver: 'cop',
      parked: false,
      slot: world._copSeq,
      _bumpCd: 0,
    });
    return true;
  }
  return false;
}

// Steer one unit after the player. The aim point leads the player's
// motion by the time the unit needs to close the gap; close in, it
// leads by a nose — a ram, not a rendezvous. Against a player on foot
// the unit pulls up alongside and holds position, and the bust clock
// in stepPolice does the rest.
function driveCop(world, cop, dt) {
  const player = world.player;
  const cls = CAR_CLASSES[cop.cls];
  const pvx = player.vx ?? 0;
  const pvy = player.vy ?? 0;
  const dx = player.x - cop.x;
  const dy = player.y - cop.y;
  const dist = Math.hypot(dx, dy);

  const lead = dist < 220 ? 0.22 : dist / cls.maxSpeed;
  const tx = player.x + pvx * lead;
  const ty = player.y + pvy * lead;
  const diff = wrapAngle(Math.atan2(ty - cop.y, tx - cop.x) - cop.angle);

  let throttle = 1;
  if (!player.car && dist < 110) {
    // On foot: roll up to boxing distance, then brake to a hold.
    throttle = dist > 92 ? 0.45 : (Math.abs(cop.speed) > 6 ? -1 : 0);
  } else if (Math.abs(diff) > 2.5 && dist < 130) {
    throttle = -0.8; // nose pointing the wrong way at close range: back out
  }
  let steer = clamp(diff * 1.7, -1, 1);
  if (throttle < 0) steer = -steer; // drive.js flips yaw in reverse
  stepCar(world, cop, { throttle, steer, handbrake: false }, dt);
}

export function stepPolice(world, dt) {
  const player = world.player;
  if (!player) return;
  const rng = rngOf(world);
  if (world.heat === undefined) world.heat = 0;

  // 1. New crimes become heat. Events are stamped once counted, so a
  //    persistent event log is never charged twice.
  for (const ev of world.events) {
    if (ev._counted) continue;
    ev._counted = true;
    world.heat += heatForEvent(world, ev);
  }

  // 2. Ramming a unit is its own crime, charged once per impact
  //    (per-unit cooldown) rather than per frame of contact.
  const cops = world.cars.filter((c) => c.driver === 'cop');
  for (const cop of cops) {
    cop._bumpCd = Math.max(0, (cop._bumpCd ?? 0) - dt);
    if (!player.car || cop._bumpCd > 0) continue;
    const d = Math.hypot(player.car.x - cop.x, player.car.y - cop.y);
    if (d >= 44) continue;
    const rel = Math.hypot(
      (player.car.vx ?? 0) - (cop.vx ?? 0),
      (player.car.vy ?? 0) - (cop.vy ?? 0),
    );
    if (rel > 60) {
      world.heat += 120;
      cop._bumpCd = 1.5;
    }
  }

  // 3. Contact, decay, and any floor a mission has set on the heat.
  const inContact = cops.some(
    (c) => Math.hypot(c.x - player.x, c.y - player.y) <= CONTACT_DIST,
  );
  world.heat -= (inContact ? DECAY_SEEN : DECAY_FREE) * dt;
  if (world.heatFloor !== undefined && world.heatFloor !== null) {
    world.heat = Math.max(world.heat, world.heatFloor);
  }
  world.heat = clamp(world.heat, 0, HEAT_MAX);
  const stars = heatToStars(world.heat);
  player.wanted = stars;

  // 4. Manpower: clear out when the heat dies, top up to stars + 1
  //    units (never more than 7), drop units left far behind or burnt
  //    out where they stopped.
  if (stars === 0) {
    for (let i = world.cars.length - 1; i >= 0; i--) {
      if (world.cars[i].driver === 'cop') world.cars.splice(i, 1);
    }
  } else {
    for (let i = world.cars.length - 1; i >= 0; i--) {
      const c = world.cars[i];
      if (c.driver !== 'cop') continue;
      const far = Math.hypot(c.x - player.x, c.y - player.y) > DESPAWN_DIST;
      const wreck = c.damage >= CAR_CLASSES[c.cls].health && Math.abs(c.speed) < 5;
      if (far || wreck) world.cars.splice(i, 1);
    }
    let count = 0;
    for (const c of world.cars) if (c.driver === 'cop') count++;
    const want = Math.min(7, stars + 1);
    world._copCd = (world._copCd ?? 0) - dt;
    if (count < want && world._copCd <= 0) {
      if (spawnCop(world, rng)) world._copCd = SPAWN_CD;
      else world._copCd = 0.25;
    }
  }

  // 5. Pursuit.
  for (const c of world.cars) {
    if (c.driver === 'cop') driveCop(world, c, dt);
  }

  // 6. Bust: held nearly still next to a unit while wanted.
  let held = false;
  if (stars > 0) {
    const pSpeed = Math.hypot(player.vx ?? 0, player.vy ?? 0);
    if (pSpeed < BUST_SPEED) {
      for (const c of world.cars) {
        if (c.driver !== 'cop') continue;
        if (Math.hypot(c.x - player.x, c.y - player.y) < BUST_DIST) {
          held = true;
          break;
        }
      }
    }
  }
  world._bustT = held ? (world._bustT ?? 0) + dt : 0;
  if (world._bustT >= BUST_TIME && !world.busted) {
    world.busted = true;
    world.events.push({ type: 'busted', x: player.x, y: player.y, t: world.time ?? 0 });
  }

  // 7. Wasted: health gone. Flag only — the consequence lives with
  //    the mission system / main, like the bust's.
  if (player.health <= 0 && !world.wasted) {
    world.wasted = true;
  }
}
