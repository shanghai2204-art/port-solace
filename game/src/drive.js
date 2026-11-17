// drive.js — arcade car physics for Port Solace.
//
// One stepCar call advances a single car under a control input
// ({ throttle -1..1, steer -1..1, handbrake }). The model is the classic
// two-component arcade split: the velocity is decomposed into a forward
// part (engine, brakes, drag) and a lateral part that grip bleeds away
// every frame — hold the handbrake and grip collapses, so the car drifts.
// Buildings are solid: the car's corners are tested against the building
// rects, and a hard enough impact damages the car and reports a 'crash'
// event for the police / pedestrian systems to hear.
//
// Cars carry two fields beyond the shared shape: vx / vy, the velocity
// vector in px/s. car.speed is kept as the signed forward speed.

import { WORLD_W, WORLD_H, CAR, CAR_CLASSES } from './config.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// True if any of the car's (slightly inset) corners sits inside a
// building rect grown by a small skin, so resting contact still counts.
function cornersInBuilding(city, car) {
  const cls = CAR_CLASSES[car.cls];
  const hl = cls.w / 2 - 2; // half length along the heading
  const hw = cls.h / 2 - 1; // half width across it
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const rx = -fy;
  const ry = fx;
  for (const lf of [hl, -hl]) {
    for (const lr of [hw, -hw]) {
      const px = car.x + fx * lf + rx * lr;
      const py = car.y + fy * lf + ry * lr;
      for (const b of city.buildings) {
        if (px > b.x - 1.5 && px < b.x + b.w + 1.5 &&
            py > b.y - 1.5 && py < b.y + b.h + 1.5) {
          return true;
        }
      }
    }
  }
  return false;
}

export function stepCar(world, car, control, dt) {
  const cls = CAR_CLASSES[car.cls];
  const city = world.city;
  if (car.vx === undefined) {
    car.vx = 0;
    car.vy = 0;
  }

  // Decompose the current velocity along the heading.
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const rx = -fy;
  const ry = fx;
  let vf = car.vx * fx + car.vy * fy; // signed forward speed
  let vl = car.vx * rx + car.vy * ry; // lateral slide

  // Engine, brakes and reverse. A burnt-out car (damage past its health)
  // gets no engine force at all and simply coasts.
  const dead = car.damage >= cls.health;
  const th = dead ? 0 : clamp(control.throttle, -1, 1);
  if (th > 0) {
    vf += cls.accel * th * dt;
  } else if (th < 0) {
    if (vf > 4) vf -= CAR.brakeDecel * dt; // braking while rolling forward
    else vf -= cls.accel * 0.55 * dt; // easing into reverse
  }
  vf = clamp(vf, -cls.reverseMax, cls.maxSpeed);
  if (th === 0) vf *= Math.pow(CAR.rollFriction, dt); // coasting drag
  vf -= vf * 0.25 * dt; // faint aero drag at all times
  if (control.handbrake) {
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), 300 * dt);
  }

  // Steering: nothing at a standstill, eager at town speeds, calmer at
  // full pace; reversed while backing up; sharper with the handbrake.
  const spd = Math.abs(vf);
  const speedFac = clamp(spd / 130, 0, 1) * (1 - 0.42 * clamp(spd / cls.maxSpeed, 0, 1));
  let yaw = clamp(control.steer, -1, 1) * cls.turn * speedFac;
  if (vf < 0) yaw = -yaw;
  if (control.handbrake) yaw *= 1.32;
  car.angle += yaw * dt;

  // Grip eats the lateral slide; the handbrake barely does (drift).
  const grip = control.handbrake ? CAR.handbrakeGrip : cls.grip;
  vl *= Math.exp(-grip * dt);

  // Recompose the velocity along the (possibly new) heading.
  const nfx = Math.cos(car.angle);
  const nfy = Math.sin(car.angle);
  const nrx = -nfy;
  const nry = nfx;
  car.vx = nfx * vf + nrx * vl;
  car.vy = nfy * vf + nry * vl;

  // Integrate, then keep the buildings out of the bodywork.
  const px = car.x;
  const py = car.y;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  if (cornersInBuilding(city, car)) {
    const impact = Math.hypot(car.vx, car.vy);
    car.x = px;
    car.y = py;
    if (impact > CAR.crashSpeed) {
      car.damage = Math.min(999, car.damage + (impact - CAR.crashSpeed) * 0.09 + 4);
      world.events.push({
        type: 'crash',
        x: car.x,
        y: car.y,
        severity: Math.min(5, 1 + (impact - CAR.crashSpeed) / 90),
        byPlayer: car.driver === 'player',
        t: world.time ?? 0,
      });
    }
    car.vx *= -0.22; // a dead bounce, not a spring
    car.vy *= -0.22;
    // Guarantee the resting centre is never left inside a rect.
    const c = city.collide(car.x, car.y, cls.h / 2);
    car.x = c.x;
    car.y = c.y;
  }

  // The world edge is a wall too.
  const m = cls.w / 2;
  car.x = clamp(car.x, m, WORLD_W - m);
  car.y = clamp(car.y, m, WORLD_H - m);

  car.speed = car.vx * nfx + car.vy * nfy;
}

// Soft circle push-apart for every pair of cars that overlaps, so traffic
// queues and parking scrapes resolve as nudges instead of interpenetration.
// Parked cars never move; a pair of parked cars is left alone entirely.
// Pairs involving a parked car only resolve on a deep overlap — a moving
// car legitimately passes a parked one with less clearance than the full
// circle sum, and shallow passes must not shove it sideways.
export function resolveCarPairs(world) {
  const cars = world.cars;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    const ra = CAR_CLASSES[a.cls].w * 0.34;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const rb = CAR_CLASSES[b.cls].w * 0.34;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let rr = ra + rb;
      if (a.parked || b.parked) {
        if (a.parked && b.parked) continue;
        rr *= 0.55;
      }
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = rr - d;
      const ux = dx / d;
      const uy = dy / d;
      if (a.parked) {
        b.x += ux * push;
        b.y += uy * push;
      } else if (b.parked) {
        a.x -= ux * push;
        a.y -= uy * push;
      } else {
        a.x -= ux * push * 0.5;
        a.y -= uy * push * 0.5;
        b.x += ux * push * 0.5;
        b.y += uy * push * 0.5;
      }
    }
  }
}
