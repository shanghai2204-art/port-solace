// input.js — keyboard and pointer state for Port Solace.
//
// One input object is created around the canvas and polled by the game
// loop. It keeps two kinds of state apart:
//   - held state:    `keys` (a Set of KeyboardEvent codes) and `mouse`
//   - edge state:    codes pressed since the last frame, read once with
//                    takePressed() so "press F to get in" fires once.
// Mouse coordinates are reported in view (canvas) pixels: the canvas is
// CSS-scaled to fit the window, so client coordinates are mapped back
// through its bounding rect.

import { VIEW_W, VIEW_H } from './config.js';

// Keys the browser would otherwise scroll or quick-find on.
const SWALLOW = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);

export function createInput(canvas) {
  const keys = new Set();
  const fresh = new Set(); // pressed since the last takePressed/clear cycle
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false };

  window.addEventListener('keydown', (event) => {
    if (SWALLOW.has(event.code)) event.preventDefault();
    if (!event.repeat) fresh.add(event.code);
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    mouse.down = false;
  });

  function toView(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((event.clientY - rect.top) / rect.height) * VIEW_H,
    };
  }

  canvas.addEventListener('pointermove', (event) => {
    const p = toView(event);
    mouse.x = p.x;
    mouse.y = p.y;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const p = toView(event);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.down = true;
    fresh.add('PointerDown');
  });
  window.addEventListener('pointerup', () => {
    mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function held(...codes) {
    return codes.some((code) => keys.has(code));
  }

  return {
    keys,
    mouse,

    // True if the code is currently held down.
    down: held,

    // True once if the code went down since the last frame; consumes it.
    takePressed(code) {
      const hit = fresh.has(code);
      if (hit) fresh.delete(code);
      return hit;
    },

    // Drop all pending edge presses (called at the end of a frame).
    clearPressed() {
      fresh.clear();
    },

    // On-foot movement axis from WASD or the arrow keys, normalised so
    // diagonals are not faster. y grows downward (screen space).
    walkAxis() {
      let x = 0;
      let y = 0;
      if (held('KeyA', 'ArrowLeft')) x -= 1;
      if (held('KeyD', 'ArrowRight')) x += 1;
      if (held('KeyW', 'ArrowUp')) y -= 1;
      if (held('KeyS', 'ArrowDown')) y += 1;
      if (x !== 0 && y !== 0) {
        x *= Math.SQRT1_2;
        y *= Math.SQRT1_2;
      }
      return { x, y };
    },

    // Driving controls: steer is -1 (left) .. 1 (right) from A/D or the
    // arrow keys; throttle is 1 (accelerate), 0, or -1 (brake / reverse)
    // from W/S or Up/Down. handbrake is Space, held.
    driveAxis() {
      let steer = 0;
      let throttle = 0;
      if (held('KeyA', 'ArrowLeft')) steer -= 1;
      if (held('KeyD', 'ArrowRight')) steer += 1;
      if (held('KeyW', 'ArrowUp')) throttle += 1;
      if (held('KeyS', 'ArrowDown')) throttle -= 1;
      return { steer, throttle, handbrake: keys.has('Space') };
    },

    // Sprint while on foot: either Shift key.
    get sprint() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight');
    },
  };
}
