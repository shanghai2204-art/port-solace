// city.js — builds Port Solace from a seed.
//
// The city is a regular street grid over the world: road centerlines every
// BLOCK px, each road ROAD_W wide with a pavement on both sides. The cells
// between roads are blocks; each block takes the building styles of the
// district its centre falls in and is filled with 1-4 buildings on a small
// lot grid. One Garden Row block is left unbuilt as a park.
//
// generateCity returns the static geometry plus the query helpers the rest
// of the game lives by: isRoad / isSidewalk for movement rules,
// districtAt for local flavour and densities, collide for keeping circles
// (people, and cars by their corners) out of buildings, and spawnPoints
// where parked cars and pedestrians enter the world.

import { WORLD_W, WORLD_H, BLOCK, ROAD_W, SIDEWALK, DISTRICTS } from './config.js';
import { mulberry32, range, rangeInt, pick, pickWeighted, chance } from './random.js';

const HALF_ROAD = ROAD_W / 2;
// Distance from a road centreline to the buildable edge of a block.
const BLOCK_INSET = HALF_ROAD + SIDEWALK;

// Parked-car class mix per district id; districts not listed use DEFAULT.
const PARKED_MIX = {
  harbor: [['truck', 4], ['sedan', 3], ['hatch', 2], ['sports', 1]],
  downtown: [['sedan', 4], ['sports', 3], ['hatch', 2], ['truck', 1]],
  gardenrow: [['hatch', 4], ['sedan', 3], ['sports', 1], ['truck', 1]],
};
const PARKED_DEFAULT = [['hatch', 3], ['sedan', 4], ['truck', 1], ['sports', 1]];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function generateCity(seed) {
  const rng = mulberry32(seed);

  // --- street grid -------------------------------------------------------
  const verticals = [];
  for (let x = BLOCK / 2; x < WORLD_W; x += BLOCK) verticals.push(x);
  const horizontals = [];
  for (let y = BLOCK / 2; y < WORLD_H; y += BLOCK) horizontals.push(y);

  function districtAt(x, y) {
    const px = clamp(x, 0, WORLD_W - 1);
    const py = clamp(y, 0, WORLD_H - 1);
    for (const d of DISTRICTS) {
      if (px >= d.x && px < d.x + d.w && py >= d.y && py < d.y + d.h) return d;
    }
    return DISTRICTS[0]; // unreachable: the districts tile the whole map
  }

  function nearLine(lines, v, dist) {
    for (const line of lines) {
      if (Math.abs(v - line) <= dist) return true;
    }
    return false;
  }

  // On the carriageway of some road?
  function isRoad(x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    return nearLine(verticals, x, HALF_ROAD) || nearLine(horizontals, y, HALF_ROAD);
  }

  // On a pavement: within the sidewalk band beside a road but not on it.
  // At intersections this also yields the corner squares, which is fine —
  // pedestrians may stand there too.
  function isSidewalk(x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    const bandV = nearLine(verticals, x, BLOCK_INSET) && !nearLine(verticals, x, HALF_ROAD);
    const bandH = nearLine(horizontals, y, BLOCK_INSET) && !nearLine(horizontals, y, HALF_ROAD);
    return bandV || bandH;
  }

  // --- blocks and buildings ----------------------------------------------
  const buildings = [];
  const parks = [];

  // The park is the Garden Row block whose centre is closest to the
  // district's own centre — chosen before any rng is spent on buildings,
  // so it does not depend on placement order.
  const garden = DISTRICTS.find((d) => d.id === 'gardenrow');
  const gardenCx = garden.x + garden.w / 2;
  const gardenCy = garden.y + garden.h / 2;
  let parkBlock = null;
  let parkDist = Infinity;

  const blocks = [];
  for (let i = 0; i < verticals.length - 1; i++) {
    for (let j = 0; j < horizontals.length - 1; j++) {
      const x0 = verticals[i] + BLOCK_INSET;
      const y0 = horizontals[j] + BLOCK_INSET;
      const size = BLOCK - 2 * BLOCK_INSET; // 200
      const block = { x: x0, y: y0, w: size, h: size };
      blocks.push(block);
      const cx = x0 + size / 2;
      const cy = y0 + size / 2;
      if (districtAt(cx, cy).id === 'gardenrow') {
        const d = (cx - gardenCx) ** 2 + (cy - gardenCy) ** 2;
        if (d < parkDist) {
          parkDist = d;
          parkBlock = block;
        }
      }
    }
  }

  for (const block of blocks) {
    if (block === parkBlock) {
      parks.push({ x: block.x, y: block.y, w: block.w, h: block.h });
      continue;
    }
    const district = districtAt(block.x + block.w / 2, block.y + block.h / 2);
    const lead = pick(rng, district.buildingStyles);
    const count = clamp(rangeInt(rng, lead.perBlock[0], lead.perBlock[1]), 1, 4);

    // Split the block interior into lots: one lot, a pair, or a 2x2 grid.
    let cols = 1;
    let rows = 1;
    if (count === 2) {
      if (chance(rng, 0.5)) cols = 2; else rows = 2;
    } else if (count >= 3) {
      cols = 2;
      rows = 2;
    }
    const lotW = block.w / cols;
    const lotH = block.h / rows;

    for (let k = 0; k < count; k++) {
      const lotX = block.x + (k % cols) * lotW;
      const lotY = block.y + Math.floor(k / cols) * lotH;
      const st = pick(rng, district.buildingStyles);
      const bw = clamp(range(rng, st.minW, st.maxW), 18, lotW - 12);
      const bh = clamp(range(rng, st.minH, st.maxH), 18, lotH - 12);
      const cx = lotX + lotW / 2 + range(rng, -3, 3);
      const cy = lotY + lotH / 2 + range(rng, -3, 3);
      buildings.push({
        x: cx - bw / 2,
        y: cy - bh / 2,
        w: bw,
        h: bh,
        style: st.name,
        district: district.id,
        color: pick(rng, st.walls),
        roof: pick(rng, st.roofs),
      });
    }
  }

  // --- collision -----------------------------------------------------------
  // Push a circle (centre nx/ny, radius r) out of every building rect it
  // overlaps and back inside the world. Returns the corrected position.
  function collide(x, y, r) {
    let nx = clamp(x, r, WORLD_W - r);
    let ny = clamp(y, r, WORLD_H - r);
    for (const b of buildings) {
      const cx = clamp(nx, b.x, b.x + b.w);
      const cy = clamp(ny, b.y, b.y + b.h);
      const dx = nx - cx;
      const dy = ny - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r;
        ny = cy + (dy / d) * r;
      } else {
        // Centre is inside the rect: leave by the shallowest wall,
        // measured against the rect grown by r.
        const left = nx - (b.x - r);
        const right = b.x + b.w + r - nx;
        const top = ny - (b.y - r);
        const bottom = b.y + b.h + r - ny;
        const m = Math.min(left, right, top, bottom);
        if (m === left) nx = b.x - r;
        else if (m === right) nx = b.x + b.w + r;
        else if (m === top) ny = b.y - r;
        else ny = b.y + b.h + r;
      }
    }
    return { x: nx, y: ny };
  }

  // --- spawn points --------------------------------------------------------
  const parkedCars = [];
  const curbOffset = HALF_ROAD - 12; // hugging the kerb, inside the road edge

  function parkAlong(vertical, fixed, segStart, segEnd) {
    // `fixed` is the road centreline; the car sits along the segment
    // segStart..segEnd of the other axis, clear of the intersections.
    const lo = segStart + HALF_ROAD + 34;
    const hi = segEnd - HALF_ROAD - 34;
    if (hi - lo < 30) return;
    for (const side of [-1, 1]) {
      if (!chance(rng, 0.62)) continue;
      const along = range(rng, lo, hi);
      const off = side * curbOffset;
      const x = vertical ? fixed + off : along;
      const y = vertical ? along : fixed + off;
      const district = districtAt(x, y);
      if (!chance(rng, district.trafficDensity + 0.3)) continue;
      // Parked cars face the way traffic on their side of the road goes.
      const angle = vertical
        ? (side > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (side > 0 ? Math.PI : 0);
      parkedCars.push({
        x, y, angle,
        carClass: pickWeighted(rng, PARKED_MIX[district.id] ?? PARKED_DEFAULT),
      });
    }
  }

  const vBounds = [0, ...horizontals, WORLD_H];
  for (const vx of verticals) {
    for (let j = 0; j < vBounds.length - 1; j++) {
      parkAlong(true, vx, vBounds[j], vBounds[j + 1]);
    }
  }
  const hBounds = [0, ...verticals, WORLD_W];
  for (const hy of horizontals) {
    for (let i = 0; i < hBounds.length - 1; i++) {
      parkAlong(false, hy, hBounds[i], hBounds[i + 1]);
    }
  }

  const pedSpawns = [];
  for (let n = 0; n < 280 && pedSpawns.length < 220; n++) {
    const vertical = chance(rng, 0.5);
    const line = vertical ? pick(rng, verticals) : pick(rng, horizontals);
    const along = vertical ? range(rng, 10, WORLD_H - 10) : range(rng, 10, WORLD_W - 10);
    const side = chance(rng, 0.5) ? -1 : 1;
    const off = side * (HALF_ROAD + SIDEWALK / 2);
    const x = vertical ? line + off : along;
    const y = vertical ? along : line + off;
    if (chance(rng, districtAt(x, y).pedDensity + 0.2)) pedSpawns.push({ x, y });
  }

  return {
    buildings,
    parks,
    roads: { verticals, horizontals },
    spawnPoints: { parkedCars, peds: pedSpawns },
    isRoad,
    isSidewalk,
    districtAt,
    collide,
  };
}
