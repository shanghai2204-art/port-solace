// combat.js — Rook's pistol, on foot.
//
// A hitscan shot along the player's aim angle, throttled to one round
// per 140ms while the mouse is held. The ray stops at the first thing
// it meets: a building wall, a car (which takes a little damage), or a
// pedestrian (who goes down). Every shot is loud — a 'shot' event at
// the player's position is what the police convert to heat and what
// nearby pedestrians flee from — and leaves a short-lived record in
// world.flashes for the renderer to draw the muzzle flash / tracer.

import { CAR_CLASSES } from './config.js';

const RANGE = 460;
const COOLDOWN = 0.14; // seconds between shots
const FLASH_TTL = 0.05;
const PED_HIT_DIST = 11; // ray passing this close to a pedestrian connects

// Slab test: distance along the ray (dx, dy unit) to the rect, or
// Infinity when the ray misses. A negative return means the origin is
// inside the rect; the caller clamps that to 0.
function rayRect(ox, oy, dx, dy, b) {
  let t0 = 0;
  let t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.x || ox > b.x + b.w) return Infinity;
  } else {
    let ta = (b.x - ox) / dx;
    let tb = (b.x + b.w - ox) / dx;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.y || oy > b.y + b.h) return Infinity;
  } else {
    let ta = (b.y - oy) / dy;
    let tb = (b.y + b.h - oy) / dy;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

function fire(world, player) {
  const ox = player.x;
  const oy = player.y;
  const ang = player.aimAngle;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const t = world.time ?? 0;

  // The shot itself is always heard, hit or miss.
  world.events.push({ type: 'shot', x: ox, y: oy, severity: 2, t });

  // Buildings are the backstop: nothing past the nearest wall counts.
  let wallT = RANGE;
  for (const b of world.city.buildings) {
    const hit = rayRect(ox, oy, dx, dy, b);
    if (hit < wallT) wallT = Math.max(0, hit);
  }

  // Nearest pedestrian and nearest car along the ray, inside the wall.
  let pedHit = null;
  let pedT = Infinity;
  for (const ped of world.peds) {
    if (ped.down > 0) continue;
    const rx = ped.x - ox;
    const ry = ped.y - oy;
    const along = rx * dx + ry * dy;
    if (along < 0 || along > wallT) continue;
    const perp = Math.abs(rx * -dy + ry * dx);
    if (perp < PED_HIT_DIST && along < pedT) {
      pedT = along;
      pedHit = ped;
    }
  }
  let carHit = null;
  let carT = Infinity;
  for (const car of world.cars) {
    const rx = car.x - ox;
    const ry = car.y - oy;
    const along = rx * dx + ry * dy;
    if (along < 0 || along > wallT) continue;
    const perp = Math.abs(rx * -dy + ry * dx);
    if (perp < CAR_CLASSES[car.cls].w / 2 + 2 && along < carT) {
      carT = along;
      carHit = car;
    }
  }

  let len = wallT;
  if (pedHit && pedT <= carT) {
    len = pedT;
    pedHit.down = 3;
    pedHit.speed = 0;
    pedHit.state = 'down';
    world.events.push({ type: 'peddown', x: pedHit.x, y: pedHit.y, severity: 3, t });
  } else if (carHit) {
    len = carT;
    carHit.damage = Math.min(999, carHit.damage + 8);
  }

  world.flashes.push({
    x: ox + dx * 14,
    y: oy + dy * 14,
    angle: ang,
    len,
    ttl: FLASH_TTL,
  });
}

export function stepCombat(world, input, dt) {
  if (!world.flashes) world.flashes = [];
  for (let i = world.flashes.length - 1; i >= 0; i--) {
    world.flashes[i].ttl -= dt;
    if (world.flashes[i].ttl <= 0) world.flashes.splice(i, 1);
  }
  world._shotCd = Math.max(0, (world._shotCd ?? 0) - dt);

  const player = world.player;
  if (!player || player.car) return; // the pistol stays holstered in a car
  if (!input.mouse.down || world._shotCd > 0) return;
  world._shotCd = COOLDOWN;
  fire(world, player);
}
