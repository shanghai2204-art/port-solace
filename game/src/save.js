// save.js — Port Solace's memory: one localStorage slot.
//
// The save is written only when the world raises dirtySave (a mission
// payout is the moment that matters) and holds just enough to pick a
// run back up: the cash, the missions already done, and where Rook was
// standing. Everything else — the city, the traffic, the heat — is
// rebuilt from the seed on load, so a save can never strand the player
// inside a version of the world that no longer exists. Storage may be
// unavailable (private mode, a headless harness): every function here
// then quietly does nothing and the game plays unsaved.

import { MISSIONS } from './missions.js';

export const SAVE_KEY = 'port-solace-save-v1';

const KNOWN_IDS = new Set(MISSIONS.map((m) => m.id));

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

// The parsed save, or null when there is none worth trusting.
export function loadSave() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (typeof data.cash !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

// Persist the world when it says it changed; clears the flag either
// way so a failed write is not retried every step.
export function saveGame(world) {
  if (!world.dirtySave) return;
  world.dirtySave = false;
  const store = storage();
  if (!store || !world.player) return;
  try {
    store.setItem(SAVE_KEY, JSON.stringify({
      cash: world.player.cash,
      missionsDone: world.missions ? [...world.missions.done] : [],
      playerPos: { x: world.player.x, y: world.player.y },
    }));
  } catch {
    // Quota or privacy mode: the run simply goes unsaved.
  }
}

// Fold a loaded save back into a freshly built world: the cash, the
// finished jobs (the cafe offers the next one, as usual), and Rook's
// position — resolved through the city's collision so a stale spot
// can never leave him inside a building.
export function applySave(world, data) {
  if (!data || !world.player) return;
  const player = world.player;
  if (typeof data.cash === 'number' && Number.isFinite(data.cash)) {
    player.cash = Math.max(0, Math.floor(data.cash));
  }
  if (Array.isArray(data.missionsDone) && world.missions) {
    for (const id of data.missionsDone) {
      if (KNOWN_IDS.has(id) && !world.missions.done.includes(id)) {
        world.missions.done.push(id);
      }
    }
  }
  const pos = data.playerPos;
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && !player.car) {
    const c = world.city.collide(pos.x, pos.y, player.radius);
    player.x = c.x;
    player.y = c.y;
  }
}

// The title screen's new game: forget the save entirely. The caller
// rebuilds the world afterwards so the erasure takes effect at once.
export function clearSave() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // Nothing to erase, or nowhere it was kept.
  }
}
