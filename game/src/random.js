// random.js — a small deterministic random toolkit.
//
// Everything in Port Solace that is "random" (the city layout, traffic,
// crowds) is driven by one seeded generator so a given seed always builds
// the same city. The generator is mulberry32: a compact 32-bit PRNG with
// a good enough spread for game content and a very short period cost.

// Create a generator from a numeric seed. Returns a function that yields
// floats in [0, 1), like Math.random, but reproducible.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Float in [min, max).
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

// Integer in [min, max], both ends included.
export function rangeInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// One element of a non-empty array.
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

// True with probability p (0..1).
export function chance(rng, p) {
  return rng() < p;
}

// Weighted pick: entries are [value, weight] pairs.
export function pickWeighted(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let roll = rng() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// In-place Fisher-Yates shuffle driven by rng; returns the same array.
export function shuffle(rng, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
