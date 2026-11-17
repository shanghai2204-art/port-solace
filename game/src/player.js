// player.js — Rook, the player character of Port Solace.
//
// On foot the player is a circle that walks and sprints with a little
// acceleration smoothing, kept out of buildings by the city's collide.
// The F key is the car door: pressed beside a car it gets in (and if the
// car had a driver, or was rolling, that is a theft — reported as an
// event, with the driver tipped out as a fleeing pedestrian); pressed
// while driving it gets out and leaves the car parked where it stopped.
// While driving, the player *is* the car for position purposes and the
// driving controls go straight to drive.js.
//
// aimAngle is the direction from the screen centre — where the camera
// keeps the player — to the mouse, ready for the combat system.

import { VIEW_W, VIEW_H, PLAYER, CAR, CAR_CLASSES } from './config.js';
import { stepCar } from './drive.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createPlayer(world) {
  const city = world.city;
  // Old Town's centre: the pavement point nearest to it is home ground,
  // a short stroll from Mara's cafe.
  const cx = 1600;
  const cy = 1800;
  let x = cx;
  let y = cy;
  let best = null;
  let bestDist = Infinity;
  for (const p of city.spawnPoints.peds) {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best) {
    x = best.x;
    y = best.y;
  }
  if (!city.isSidewalk(x, y)) {
    // Spiral out from the district centre until a pavement turns up.
    let found = false;
    for (let r = 10; r < 320 && !found; r += 10) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
        const nx = cx + Math.cos(a) * r;
        const ny = cy + Math.sin(a) * r;
        if (city.isSidewalk(nx, ny)) {
          x = nx;
          y = ny;
          found = true;
          break;
        }
      }
    }
  }
  return {
    x,
    y,
    angle: -Math.PI / 2,
    speed: 0,
    vx: 0,
    vy: 0,
    health: PLAYER.maxHealth,
    cash: 250,
    car: null,
    wanted: 0,
    radius: PLAYER.radius,
    aimAngle: -Math.PI / 2,
  };
}

function exitCar(world, player) {
  const car = player.car;
  const cls = CAR_CLASSES[car.cls];
  const rx = -Math.sin(car.angle); // the car's right-hand side
  const ry = Math.cos(car.angle);
  const offset = cls.h / 2 + PLAYER.radius + 5;
  // Prefer whichever side the buildings leave alone.
  let placed = null;
  for (const sideSign of [1, -1]) {
    const cand = {
      x: car.x + rx * offset * sideSign,
      y: car.y + ry * offset * sideSign,
    };
    const resolved = world.city.collide(cand.x, cand.y, PLAYER.radius);
    const drift = Math.hypot(resolved.x - cand.x, resolved.y - cand.y);
    if (!placed || drift < placed.drift) placed = { ...resolved, drift };
    if (drift < 1) break;
  }
  player.x = placed.x;
  player.y = placed.y;
  player.vx = 0;
  player.vy = 0;
  player.speed = 0;
  car.driver = null;
  if (Math.abs(car.speed) < 10) {
    car.parked = true;
    car.speed = 0;
    car.vx = 0;
    car.vy = 0;
  }
  player.car = null;
}

function enterCar(world, player) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const car of world.cars) {
    const d = Math.hypot(car.x - player.x, car.y - player.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = car;
    }
  }
  if (!nearest || nearestDist > CAR.enterRange) return;
  const car = nearest;

  const wasDriven = car.driver === 'ai';
  const wasMoving = Math.abs(car.speed) > 5;
  if (wasDriven) {
    // The driver is tipped out onto the pavement and runs for it.
    world.peds.push({
      x: car.x + Math.cos(car.angle + Math.PI / 2) * 16,
      y: car.y + Math.sin(car.angle + Math.PI / 2) * 16,
      angle: car.angle,
      speed: 0,
      state: 'flee',
      color: '#c9c2b4',
      walkSpeed: 70,
      tx: car.x,
      ty: car.y,
      wait: 0,
      panic: 3,
      fx: car.x,
      fy: car.y,
      down: 0,
    });
  }
  if (wasDriven || wasMoving) {
    world.events.push({ type: 'theft', x: car.x, y: car.y, severity: 2, t: world.time ?? 0 });
  }
  car.driver = 'player';
  car.parked = false;
  car.turn = null; // a stolen AI car drops its manoeuvre; the player drives
  player.car = car;
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
}

export function stepPlayer(world, input, dt) {
  const player = world.player;
  if (!player) return;
  const city = world.city;

  player.aimAngle = Math.atan2(
    input.mouse.y - VIEW_H / 2,
    input.mouse.x - VIEW_W / 2,
  );

  if (input.takePressed('KeyF')) {
    if (player.car) exitCar(world, player);
    else enterCar(world, player);
  }

  if (player.car) {
    const c = input.driveAxis();
    stepCar(world, player.car, {
      throttle: c.throttle,
      steer: c.steer,
      handbrake: c.handbrake,
    }, dt);
    player.x = player.car.x;
    player.y = player.car.y;
    player.angle = player.car.angle;
    player.speed = player.car.speed;
    player.vx = player.car.vx;
    player.vy = player.car.vy;
    return;
  }

  // On foot: ease the velocity toward the input direction.
  const axis = input.walkAxis();
  const top = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const dvx = axis.x * top;
  const dvy = axis.y * top;
  const acc = PLAYER.accel * dt;
  player.vx += clamp(dvx - player.vx, -acc, acc);
  player.vy += clamp(dvy - player.vy, -acc, acc);
  const c = city.collide(
    player.x + player.vx * dt,
    player.y + player.vy * dt,
    PLAYER.radius,
  );
  player.x = c.x;
  player.y = c.y;
  player.speed = Math.hypot(player.vx, player.vy);
  if (player.speed > 12) player.angle = Math.atan2(player.vy, player.vx);
}
