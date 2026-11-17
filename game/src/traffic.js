// traffic.js — the civilian cars of Port Solace.
//
// Parked cars come straight from the city's spawn table and never move.
// Moving cars are kinematic lane-followers: each one owns a road (axis +
// centreline + direction) and rides the lane offset that city.js parked
// its cars against, so moving and parked traffic agree about which side
// of the road is whose. At an intersection a car mostly goes straight and
// sometimes turns, following a quadratic bezier around the corner; where
// a road runs out at the world edge it makes a semicircular U-turn.
// Cars brake for whatever is ahead of them in their lane — including the
// player's car — and honk when held up. Cars that wander too far from
// the player despawn; replacements fade in on roads a few blocks away,
// with the target count following the local district's trafficDensity.
//
// AI cars carry extra fields beyond the shared car shape: axis ('v' |
// 'h'), dir (+1 | -1 along the axis), line (the road centreline), cruise
// (its chosen cruising speed), nextCross / decided (intersection
// bookkeeping) and turn (an in-progress bezier or arc manoeuvre).

import { WORLD_W, WORLD_H, CAR_CLASSES } from './config.js';
import { mulberry32, range, pick, pickWeighted, chance } from './random.js';

const LANE = 17; // lane centre offset from the road centreline
const R_LEFT = 30; // bezier reach of a left turn
const R_RIGHT = 62; // bezier reach of a right turn
const DESPAWN_DIST = 1400;
const SPAWN_MIN = 700;
const SPAWN_MAX = 1100;
const EDGE_UTURN = 130; // start the U-turn this far from the world edge

const CAR_COLORS = ['#b8b4ac', '#7a8894', '#94423a', '#3f5a78', '#c2a15a', '#5d7263', '#8a8d94', '#704a63'];
const TRAFFIC_MIX = [['sedan', 5], ['hatch', 4], ['truck', 2], ['sports', 1]];

const fallbackRng = mulberry32(20240);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rngOf(world) {
  return world.rng ?? fallbackRng;
}

function headingAngle(axis, dir) {
  if (axis === 'v') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

// The next perpendicular centreline strictly ahead of the car, or null
// when the road runs out at the world edge first.
function nextCrossFor(city, car) {
  const lines = car.axis === 'v' ? city.roads.horizontals : city.roads.verticals;
  const along = car.axis === 'v' ? car.y : car.x;
  let best = null;
  let bestDist = Infinity;
  for (const line of lines) {
    const d = (line - along) * car.dir;
    if (d > 1 && d < bestDist) {
      bestDist = d;
      best = line;
    }
  }
  return best;
}

function makeMovingCar(world, rng, axis, dir, line, along) {
  const angle = headingAngle(axis, dir);
  const cls = pickWeighted(rng, TRAFFIC_MIX);
  const car = {
    x: 0,
    y: 0,
    angle,
    speed: 0,
    cls,
    color: pick(rng, CAR_COLORS),
    damage: 0,
    driver: 'ai',
    parked: false,
    vx: 0,
    vy: 0,
    axis,
    dir,
    line,
    cruise: Math.min(195, CAR_CLASSES[cls].maxSpeed * range(rng, 0.4, 0.58)),
    nextCross: null,
    decided: false,
    turn: null,
    honkCd: range(rng, 0, 4),
    blockedT: 0,
  };
  if (axis === 'v') {
    car.x = line + Math.sin(angle) * LANE;
    car.y = along;
  } else {
    car.x = along;
    car.y = line - Math.cos(angle) * LANE;
  }
  car.nextCross = nextCrossFor(world.city, car);
  return car;
}

// Try to place one moving car on a road whose distance from (cx, cy)
// lands in [minD, maxD]. Returns true on success.
function spawnMoving(world, rng, cx, cy, minD, maxD) {
  const city = world.city;
  for (let tries = 0; tries < 12; tries++) {
    const axis = chance(rng, 0.5) ? 'v' : 'h';
    const line = axis === 'v' ? pick(rng, city.roads.verticals) : pick(rng, city.roads.horizontals);
    const along = axis === 'v' ? range(rng, 60, WORLD_H - 60) : range(rng, 60, WORLD_W - 60);
    const dir = chance(rng, 0.5) ? 1 : -1;
    const angle = headingAngle(axis, dir);
    const x = axis === 'v' ? line + Math.sin(angle) * LANE : along;
    const y = axis === 'v' ? along : line - Math.cos(angle) * LANE;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < minD || dist > maxD) continue;
    let clear = true;
    for (const other of world.cars) {
      if (Math.hypot(other.x - x, other.y - y) < 70) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    world.cars.push(makeMovingCar(world, rng, axis, dir, line, along));
    return true;
  }
  return false;
}

export function createTraffic(world, rng) {
  world.rng = world.rng ?? rng;
  const city = world.city;

  // Parked cars: the city's table already chose the spot, the class and
  // the facing; they sit there for the whole session.
  for (const spot of city.spawnPoints.parkedCars) {
    world.cars.push({
      x: spot.x,
      y: spot.y,
      angle: spot.angle,
      speed: 0,
      cls: spot.carClass,
      color: pick(rng, CAR_COLORS),
      damage: 0,
      driver: null,
      parked: true,
      vx: 0,
      vy: 0,
    });
  }

  // A first scatter of moving traffic around the city centre.
  for (let n = 0; n < 14; n++) {
    spawnMoving(world, rng, WORLD_W / 2, WORLD_H / 2, 0, 650);
  }
}

// Gap to the nearest vehicle ahead in this car's lane (centre distance
// minus a car length), or Infinity when the way is clear. Parked cars
// ride 17px further out than the traffic lane, so they never register.
function obstacleAhead(world, car) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let gap = Infinity;
  for (const other of world.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const ahead = dx * fx + dy * fy;
    if (ahead < 4 || ahead > 130) continue;
    const lateral = Math.abs(dx * -fy + dy * fx);
    if (lateral < 15) gap = Math.min(gap, ahead - 27);
  }
  return gap;
}

// Begin a bezier turn at the upcoming crossing. `side` is -1 for a left
// turn (heading rotates by -90°) and +1 for a right (+90°).
function startTurn(world, car, side) {
  const cross = car.nextCross;
  const a = car.angle;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  // Where this lane crosses the junction, and where the exit lane does.
  const pc = car.axis === 'v'
    ? { x: car.line + Math.sin(a) * LANE, y: cross - Math.cos(a) * LANE }
    : { x: cross + Math.sin(a) * LANE, y: car.line - Math.cos(a) * LANE };
  const na = a + side * (Math.PI / 2);
  const nAxis = car.axis === 'v' ? 'h' : 'v';
  const nDir = nAxis === 'h' ? Math.sign(Math.cos(na)) : Math.sign(Math.sin(na));
  const pe = nAxis === 'h'
    ? { x: car.line + Math.sin(na) * LANE, y: cross - Math.cos(na) * LANE }
    : { x: cross + Math.sin(na) * LANE, y: car.line - Math.cos(na) * LANE };
  // The bezier control point is the corner where the two lane lines meet.
  const corner = car.axis === 'v' ? { x: pc.x, y: pe.y } : { x: pe.x, y: pc.y };
  const r = side < 0 ? R_LEFT : R_RIGHT;
  const distToCross = Math.abs((cross - (car.axis === 'v' ? car.y : car.x)) * car.dir);
  const p0 = distToCross > r
    ? { x: pc.x - fx * r, y: pc.y - fy * r }
    : { x: car.x, y: car.y };
  const p2 = { x: pe.x + Math.cos(na) * r, y: pe.y + Math.sin(na) * r };
  const len = Math.hypot(corner.x - p0.x, corner.y - p0.y) +
              Math.hypot(p2.x - corner.x, p2.y - corner.y);
  car.turn = {
    kind: 'bez',
    t: 0,
    p0,
    p1: corner,
    p2,
    len: Math.max(24, len * 0.85),
    newAxis: nAxis,
    newDir: nDir,
    newLine: cross,
  };
  car.decided = true;
}

// Begin a semicircular U-turn around the road centreline: the only way
// out when the grid runs into the world edge.
function startUTurn(car) {
  const cx = car.axis === 'v' ? car.line : car.x;
  const cy = car.axis === 'v' ? car.y : car.line;
  car.turn = {
    kind: 'arc',
    cx,
    cy,
    r: LANE,
    th: Math.atan2(car.y - cy, car.x - cx),
    swept: 0,
  };
  car.decided = true;
}

function advanceTurn(world, car, dt) {
  const turn = car.turn;
  car.speed += clamp(Math.min(car.cruise, 128) - car.speed, -320 * dt, 320 * dt);
  const travel = Math.max(car.speed, 42) * dt;
  if (turn.kind === 'bez') {
    turn.t += travel / turn.len;
    const t = Math.min(turn.t, 1);
    const u = 1 - t;
    car.x = u * u * turn.p0.x + 2 * u * t * turn.p1.x + t * t * turn.p2.x;
    car.y = u * u * turn.p0.y + 2 * u * t * turn.p1.y + t * t * turn.p2.y;
    const dx = 2 * u * (turn.p1.x - turn.p0.x) + 2 * t * (turn.p2.x - turn.p1.x);
    const dy = 2 * u * (turn.p1.y - turn.p0.y) + 2 * t * (turn.p2.y - turn.p1.y);
    if (dx !== 0 || dy !== 0) car.angle = Math.atan2(dy, dx);
    if (turn.t >= 1) {
      car.axis = turn.newAxis;
      car.dir = turn.newDir;
      car.line = turn.newLine;
      car.angle = headingAngle(car.axis, car.dir);
      car.turn = null;
      car.decided = false;
      car.nextCross = nextCrossFor(world.city, car);
    }
  } else {
    const dth = travel / turn.r;
    turn.th += dth;
    turn.swept += dth;
    car.x = turn.cx + Math.cos(turn.th) * turn.r;
    car.y = turn.cy + Math.sin(turn.th) * turn.r;
    car.angle = turn.th + Math.PI / 2;
    if (turn.swept >= Math.PI) {
      car.dir = -car.dir;
      car.angle = headingAngle(car.axis, car.dir);
      // Settle exactly onto the opposite lane.
      if (car.axis === 'v') car.x = car.line + Math.sin(car.angle) * LANE;
      else car.y = car.line - Math.cos(car.angle) * LANE;
      car.turn = null;
      car.decided = false;
      car.nextCross = nextCrossFor(world.city, car);
    }
  }
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
}

export function stepTraffic(world, dt) {
  const city = world.city;
  const rng = rngOf(world);
  const player = world.player;
  const px = player ? player.x : WORLD_W / 2;
  const py = player ? player.y : WORLD_H / 2;

  // Despawn whatever has drifted too far from the action.
  for (let i = world.cars.length - 1; i >= 0; i--) {
    const car = world.cars[i];
    if (car.driver === 'ai' && Math.hypot(car.x - px, car.y - py) > DESPAWN_DIST) {
      world.cars.splice(i, 1);
    }
  }

  // Top the moving fleet back up toward the local density.
  let moving = 0;
  for (const car of world.cars) if (car.driver === 'ai') moving++;
  const want = 10 + Math.round(10 * (player ? city.districtAt(px, py).trafficDensity : 0.6));
  world._trafficCd = (world._trafficCd ?? 0) - dt;
  if (moving < want && world._trafficCd <= 0) {
    if (spawnMoving(world, rng, px, py, SPAWN_MIN, SPAWN_MAX)) {
      world._trafficCd = 0.4;
    } else {
      world._trafficCd = 1.2;
    }
  }

  for (const car of world.cars) {
    if (car.driver !== 'ai' || car.parked) continue;

    if (car.turn) {
      advanceTurn(world, car, dt);
      continue;
    }

    // Speed control: cruise, ease off behind traffic, stop at its bumper.
    const gap = obstacleAhead(world, car);
    let desired = car.cruise;
    if (gap < 42) desired = 0;
    else if (gap < 120) desired = Math.min(desired, car.cruise * ((gap - 34) / 90));
    const rate = desired > car.speed ? 165 : 430;
    car.speed += clamp(desired - car.speed, -rate * dt, rate * dt);
    if (car.speed < 0) car.speed = 0;

    // Held up? Count it, and honk once in a while.
    car.honkCd -= dt;
    if (gap < 46 && car.speed < 6) {
      car.blockedT += dt;
      if (car.blockedT > 1.4 && car.honkCd <= 0) {
        world.events.push({ type: 'honk', x: car.x, y: car.y, t: world.time ?? 0 });
        car.honkCd = range(rng, 3, 7);
        car.blockedT = 0.6;
      }
    } else {
      car.blockedT = 0;
    }

    // Roll along the lane.
    if (car.axis === 'v') {
      car.x = car.line + Math.sin(car.angle) * LANE;
      car.y += car.dir * car.speed * dt;
    } else {
      car.x += car.dir * car.speed * dt;
      car.y = car.line - Math.cos(car.angle) * LANE;
    }
    car.x = clamp(car.x, 20, WORLD_W - 20);
    car.y = clamp(car.y, 20, WORLD_H - 20);
    car.vx = Math.cos(car.angle) * car.speed;
    car.vy = Math.sin(car.angle) * car.speed;

    const along = car.axis === 'v' ? car.y : car.x;

    // Just crossed a junction: arm the decision for the next one.
    if (car.nextCross !== null && (car.nextCross - along) * car.dir < -2) {
      car.nextCross = nextCrossFor(city, car);
      car.decided = false;
    }

    if (car.nextCross === null) {
      // No junction left: the road ends at the world edge. Turn around.
      const toEdge = car.axis === 'v'
        ? (car.dir > 0 ? WORLD_H - car.y : car.y)
        : (car.dir > 0 ? WORLD_W - car.x : car.x);
      if (toEdge < EDGE_UTURN) startUTurn(car);
    } else if (!car.decided) {
      const dist = (car.nextCross - along) * car.dir;
      if (dist <= R_RIGHT + 2) {
        const roll = rng();
        if (roll < 0.62) {
          car.decided = true; // straight on; decided until we cross
        } else {
          startTurn(world, car, roll < 0.81 ? -1 : 1);
        }
      }
    }
  }
}
