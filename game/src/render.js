// render.js — Port Solace on canvas: the city, the chase, the HUD.
//
// draw() paints one frame in two passes: the world (camera centred on
// the player, clamped to the map) and then the screen-space HUD —
// cash and health, the wanted stars, the mission line and Mara's
// brief, and the minimap. The look is the config's flat map style:
// district ground, banded roads with worn paint, roof-coloured
// buildings, and simple readable figures for people and cars. Police
// units are white with a dark band and a light bar that flashes on
// world.time, damage smokes, and the mission marker is a gold ring
// with a pillar of light. Everything is a function of the world state
// alone — no Math.random anywhere — so a staged world renders the
// same frame every time, which the screenshot scenes rely on.
//
// The overlay helpers (title, banner, busted/wasted, story complete)
// are exported separately; main.js decides when each is on screen.

import {
  VIEW_W, VIEW_H, WORLD_W, WORLD_H, ROAD_W, SIDEWALK,
  COLORS, DISTRICTS, CAR_CLASSES,
} from './config.js';
import { currentObjective, MISSIONS } from './missions.js';

const FONT = '"Avenir Next", "Segoe UI", system-ui, sans-serif';
const GOLD = '#f5c542';
const TEAL = '#2dd4bf';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Deterministic 0..1 hash of a number: decoration that never changes
// between frames or runs (tree spots, smoke drift).
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function rrect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function cameraFor(world) {
  const focus = world.camFocus ?? world.player ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
  return {
    x: clamp(focus.x - VIEW_W / 2, 0, WORLD_W - VIEW_W),
    y: clamp(focus.y - VIEW_H / 2, 0, WORLD_H - VIEW_H),
  };
}

// ------------------------------------------------------------- the world

function drawGround(ctx, world, cam) {
  const vx0 = cam.x - 30;
  const vy0 = cam.y - 30;
  const vx1 = cam.x + VIEW_W + 30;
  const vy1 = cam.y + VIEW_H + 30;
  const city = world.city;

  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.fillRect(
      Math.max(d.x, vx0), Math.max(d.y, vy0),
      Math.min(d.x + d.w, vx1) - Math.max(d.x, vx0),
      Math.min(d.y + d.h, vy1) - Math.max(d.y, vy0),
    );
  }

  // The park: darker grass, a crossing of paths, a scatter of trees.
  for (const park of city.parks) {
    if (park.x > vx1 || park.x + park.w < vx0 || park.y > vy1 || park.y + park.h < vy0) continue;
    ctx.fillStyle = COLORS.grassDark;
    ctx.fillRect(park.x, park.y, park.w, park.h);
    ctx.fillStyle = COLORS.parkPath;
    ctx.fillRect(park.x, park.y + park.h / 2 - 6, park.w, 12);
    ctx.fillRect(park.x + park.w / 2 - 6, park.y, 12, park.h);
    for (let i = 0; i < 8; i++) {
      const tx = park.x + 18 + hash01(park.x + i * 17.3) * (park.w - 36);
      const ty = park.y + 18 + hash01(park.y + i * 29.1) * (park.h - 36);
      const tr = 8 + hash01(i * 7.7 + park.x) * 7;
      ctx.fillStyle = '#2c4f22';
      ctx.beginPath();
      ctx.arc(tx, ty, tr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a632c';
      ctx.beginPath();
      ctx.arc(tx - tr * 0.25, ty - tr * 0.25, tr * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Roads: pavement bands first (both axes), then the asphalt, so
  // intersections read as one continuous surface.
  const inset = ROAD_W / 2 + SIDEWALK;
  ctx.fillStyle = COLORS.sidewalk;
  for (const line of city.roads.verticals) {
    ctx.fillRect(line - inset, Math.max(0, vy0), inset * 2, Math.min(WORLD_H, vy1) - Math.max(0, vy0));
  }
  for (const line of city.roads.horizontals) {
    ctx.fillRect(Math.max(0, vx0), line - inset, Math.min(WORLD_W, vx1) - Math.max(0, vx0), inset * 2);
  }
  ctx.fillStyle = COLORS.asphalt;
  for (const line of city.roads.verticals) {
    ctx.fillRect(line - ROAD_W / 2, Math.max(0, vy0), ROAD_W, Math.min(WORLD_H, vy1) - Math.max(0, vy0));
  }
  for (const line of city.roads.horizontals) {
    ctx.fillRect(Math.max(0, vx0), line - ROAD_W / 2, Math.min(WORLD_W, vx1) - Math.max(0, vx0), ROAD_W);
  }

  // Paint: soft edge lines and the worn yellow centre dashes, which
  // break where a crossing road runs through.
  ctx.fillStyle = 'rgba(185, 190, 198, 0.35)';
  for (const line of city.roads.verticals) {
    ctx.fillRect(line - ROAD_W / 2 + 3, Math.max(0, vy0), 2, Math.min(WORLD_H, vy1) - Math.max(0, vy0));
    ctx.fillRect(line + ROAD_W / 2 - 5, Math.max(0, vy0), 2, Math.min(WORLD_H, vy1) - Math.max(0, vy0));
  }
  for (const line of city.roads.horizontals) {
    ctx.fillRect(Math.max(0, vx0), line - ROAD_W / 2 + 3, Math.min(WORLD_W, vx1) - Math.max(0, vx0), 2);
    ctx.fillRect(Math.max(0, vx0), line + ROAD_W / 2 - 5, Math.min(WORLD_W, vx1) - Math.max(0, vx0), 2);
  }
  ctx.fillStyle = COLORS.lanePaint;
  for (const line of city.roads.verticals) {
    for (let y = 24; y < WORLD_H; y += 48) {
      if (y > vy1 || y + 24 < vy0) continue;
      let crossing = false;
      for (const h of city.roads.horizontals) {
        if (Math.abs(y + 12 - h) < ROAD_W / 2 + 8) { crossing = true; break; }
      }
      if (!crossing) ctx.fillRect(line - 1.5, y, 3, 24);
    }
  }
  for (const line of city.roads.horizontals) {
    for (let x = 24; x < WORLD_W; x += 48) {
      if (x > vx1 || x + 24 < vx0) continue;
      let crossing = false;
      for (const v of city.roads.verticals) {
        if (Math.abs(x + 12 - v) < ROAD_W / 2 + 8) { crossing = true; break; }
      }
      if (!crossing) ctx.fillRect(x, line - 1.5, 24, 3);
    }
  }
}

function drawBuildings(ctx, world, cam) {
  const vx0 = cam.x - 40;
  const vy0 = cam.y - 40;
  const vx1 = cam.x + VIEW_W + 40;
  const vy1 = cam.y + VIEW_H + 40;
  for (const b of world.city.buildings) {
    if (b.x > vx1 || b.x + b.w < vx0 || b.y > vy1 || b.y + b.h < vy0) continue;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(b.x, b.y, b.w, 3);
  }
}

function drawMarker(ctx, world, cam) {
  const objective = currentObjective(world.missions);
  if (!objective || objective.x === null || objective.x === undefined) return;
  const { x, y } = objective;
  if (x < cam.x - 60 || x > cam.x + VIEW_W + 60 || y < cam.y - 200 || y > cam.y + VIEW_H + 60) return;
  const pulse = 24 + Math.sin(world.time * 3.5) * 5;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawMarkerPillar(ctx, world) {
  const objective = currentObjective(world.missions);
  if (!objective || objective.x === null || objective.x === undefined) return;
  const { x, y } = objective;
  const grad = ctx.createLinearGradient(0, y - 175, 0, y);
  grad.addColorStop(0, 'rgba(245, 197, 66, 0)');
  grad.addColorStop(1, 'rgba(245, 197, 66, 0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - 13, y - 175, 26, 175);
}

function drawPed(ctx, ped) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(ped.x, ped.y + 3, 8, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.rotate(ped.angle);
  if (ped.state === 'down' || ped.down > 0) {
    // Lying where they fell: a long shape along the facing, darkened.
    rrect(ctx, -10, -3.4, 20, 6.8, 3);
    ctx.fillStyle = ped.color;
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    rrect(ctx, -10, -3.4, 20, 6.8, 3);
    ctx.fill();
    ctx.fillStyle = '#d9b48f';
    ctx.beginPath();
    ctx.arc(12, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = ped.color;
    ctx.beginPath();
    ctx.arc(0, 0, 5.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9b48f';
    ctx.beginPath();
    ctx.arc(1.4, 0, 2.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCar(ctx, world, car) {
  const cls = CAR_CLASSES[car.cls];
  const w = cls.w;
  const h = cls.h;

  if (car.driver === 'player') {
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(car.x, car.y, w * 0.68, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  rrect(ctx, -w / 2 + 2, -h / 2 + 3, w, h, 5);
  ctx.fill();

  if (car.cls === 'police') {
    ctx.fillStyle = '#e9ebee';
    rrect(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.fillStyle = '#262b36';
    ctx.fillRect(-3.5, -h / 2, 7, h);
    // The light bar: two halves across the car, trading brightness.
    const phase = Math.floor(world.time * 2.6) % 2 === 0;
    ctx.fillStyle = phase ? 'rgba(248, 113, 113, 1)' : 'rgba(248, 113, 113, 0.30)';
    ctx.fillRect(-2.5, -h / 2 + 2.5, 5, h / 2 - 2.5);
    ctx.fillStyle = phase ? 'rgba(96, 165, 250, 0.30)' : 'rgba(96, 165, 250, 1)';
    ctx.fillRect(-2.5, 0, 5, h / 2 - 2.5);
    ctx.fillStyle = 'rgba(16, 22, 30, 0.85)';
    ctx.fillRect(w * 0.26, -h / 2 + 2, 3.5, h - 4);
  } else {
    ctx.fillStyle = car.color;
    rrect(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(16, 22, 30, 0.85)';
    ctx.fillRect(w * 0.24, -h / 2 + 2, 3.5, h - 4); // windshield
    ctx.fillRect(-w * 0.30, -h / 2 + 2.5, 3, h - 5); // rear window
    ctx.fillStyle = 'rgba(0, 0, 0, 0.20)';
    rrect(ctx, -w * 0.22, -h / 2 + 2.5, w * 0.42, h - 5, 3);
    ctx.fill();
  }

  if (car.damage >= cls.health) {
    ctx.fillStyle = 'rgba(12, 10, 10, 0.45)';
    rrect(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fill();
  }
  ctx.restore();

  // Smoke off a hurting engine, drifting up and thinning out.
  if (car.damage > 55) {
    for (let i = 0; i < 3; i++) {
      const phase = (world.time * 0.55 + hash01(car.x * 0.37 + car.y * 0.73 + i * 1.7)) % 1;
      const px = car.x + (hash01(car.x + i * 3.1) - 0.5) * 10;
      const py = car.y - 8 - phase * 26;
      ctx.fillStyle = `rgba(198, 200, 205, ${0.26 * (1 - phase)})`;
      ctx.beginPath();
      ctx.arc(px, py, 3 + phase * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayer(ctx, world, input) {
  const player = world.player;
  if (!player || player.car) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + 3, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(player.x, player.y, 13.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#0d9488';
  ctx.beginPath();
  ctx.arc(player.x, player.y, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c39e';
  ctx.beginPath();
  ctx.arc(
    player.x + Math.cos(player.angle) * 1.6,
    player.y + Math.sin(player.angle) * 1.6,
    3, 0, Math.PI * 2,
  );
  ctx.fill();

  // The aim line while the trigger is held.
  if (input && input.mouse && input.mouse.down) {
    ctx.strokeStyle = 'rgba(255, 96, 80, 0.50)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(
      player.x + Math.cos(player.aimAngle) * 46,
      player.y + Math.sin(player.aimAngle) * 46,
    );
    ctx.stroke();
  }
}

function drawFlashes(ctx, world) {
  for (const f of world.flashes) {
    const alpha = clamp(f.ttl / 0.05, 0, 1);
    ctx.strokeStyle = `rgba(255, 214, 106, ${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + Math.cos(f.angle) * f.len, f.y + Math.sin(f.angle) * f.len);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 240, 180, ${alpha})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- the HUD

function fmtCash(cash) {
  return '$' + String(Math.max(0, Math.floor(cash))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawMinimap(ctx, world, cam) {
  const mw = 220;
  const mh = 165;
  const mx = VIEW_W - mw - 14;
  const my = VIEW_H - mh - 14;
  const sx = mw / WORLD_W;
  const sy = mh / WORLD_H;
  const city = world.city;

  ctx.fillStyle = 'rgba(8, 10, 14, 0.72)';
  rrect(ctx, mx, my, mw, mh, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  rrect(ctx, mx, my, mw, mh, 6);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(200, 205, 215, 0.35)';
  ctx.beginPath();
  for (const v of city.roads.verticals) {
    ctx.moveTo(mx + v * sx, my);
    ctx.lineTo(mx + v * sx, my + mh);
  }
  for (const h of city.roads.horizontals) {
    ctx.moveTo(mx, my + h * sy);
    ctx.lineTo(mx + mw, my + h * sy);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(170, 158, 132, 0.50)';
  for (const b of city.buildings) {
    ctx.fillRect(mx + b.x * sx, my + b.y * sy, 2, 2);
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
  for (const ped of world.peds) {
    ctx.fillRect(mx + ped.x * sx, my + ped.y * sy, 1.4, 1.4);
  }

  const phase = Math.floor(world.time * 2.2) % 2 === 0;
  let copIndex = 0;
  for (const car of world.cars) {
    if (car.driver !== 'cop') continue;
    ctx.fillStyle = (copIndex + (phase ? 1 : 0)) % 2 === 0 ? '#f87171' : '#60a5fa';
    ctx.fillRect(mx + car.x * sx - 1.5, my + car.y * sy - 1.5, 3, 3);
    copIndex++;
  }

  const objective = currentObjective(world.missions);
  if (objective && objective.x !== null && objective.x !== undefined) {
    const ox = mx + objective.x * sx;
    const oy = my + objective.y * sy;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, 4.5 + Math.sin(world.time * 3.5) * 1.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(ox, oy, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const player = world.player;
  if (player) {
    ctx.save();
    ctx.translate(mx + player.x * sx, my + player.y * sy);
    ctx.rotate(player.angle);
    ctx.fillStyle = TEAL;
    ctx.beginPath();
    ctx.moveTo(5.5, 0);
    ctx.lineTo(-4, -3.4);
    ctx.lineTo(-4, 3.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, VIEW_W * sx, VIEW_H * sy);
}

function drawHud(ctx, world, input, cam) {
  const player = world.player;
  const state = world.missions;
  ctx.textBaseline = 'alphabetic';

  // Cash and health, top-left.
  if (player) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(fmtCash(player.cash), 16, 34);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText('C A S H', 17, 48);

    const frac = clamp(player.health / 100, 0, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    rrect(ctx, 16, 56, 180, 10, 5);
    ctx.fill();
    ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#facc15' : '#f87171';
    if (frac > 0) {
      rrect(ctx, 16, 56, 180 * frac, 10, 5);
      ctx.fill();
    }
  }

  // Wanted stars, top-right.
  const wanted = player ? (player.wanted ?? 0) : 0;
  ctx.textAlign = 'left';
  ctx.font = '26px sans-serif';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < wanted ? '#fbbf24' : 'rgba(255, 255, 255, 0.20)';
    ctx.fillText('★', VIEW_W - 16 - 5 * 30 + i * 30, 36);
  }

  // Mission line, top-centre.
  const objective = currentObjective(state);
  ctx.textAlign = 'center';
  if (state && state.active) {
    ctx.fillStyle = GOLD;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(`— ${(state.title ?? '').toUpperCase()} —`, VIEW_W / 2, 26);
    if (objective) {
      ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.font = `600 17px ${FONT}`;
      ctx.fillText(objective.text, VIEW_W / 2, 50);
    }
    if (state.timeLeft !== null && state.timeLeft !== undefined) {
      ctx.fillStyle = state.timeLeft < 30 ? '#f87171' : 'rgba(248, 250, 252, 0.85)';
      ctx.font = `700 16px ${FONT}`;
      ctx.fillText(fmtTime(state.timeLeft), VIEW_W / 2, 74);
    }
  } else if (objective) {
    ctx.fillStyle = 'rgba(248, 250, 252, 0.80)';
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(objective.text, VIEW_W / 2, 30);
  }

  // Mara's brief: a phone-style card for the first seconds of a job.
  if (state && state.active && state.brief) {
    if (world._briefFor !== state.brief) {
      world._briefFor = state.brief;
      world._briefT = world.time;
    }
    if (world.time - (world._briefT ?? 0) < 6) {
      const lines = state.brief;
      const bw = 580;
      const bh = 44 + lines.length * 21;
      const bx = VIEW_W / 2 - bw / 2;
      const by = 92;
      ctx.fillStyle = 'rgba(9, 13, 19, 0.85)';
      rrect(ctx, bx, by, bw, bh, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.45)';
      ctx.lineWidth = 1;
      rrect(ctx, bx, by, bw, bh, 10);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = TEAL;
      ctx.font = `700 10px ${FONT}`;
      ctx.fillText('M A R A   V O S S', bx + 18, by + 20);
      ctx.fillStyle = '#e5f5f2';
      ctx.font = `15px ${FONT}`;
      lines.forEach((line, i) => {
        ctx.fillText(line, bx + 18, by + 44 + i * 21);
      });
      ctx.textAlign = 'center';
    }
  } else if (world._briefFor) {
    world._briefFor = null;
  }

  // Failure and completion banners ride over the HUD.
  if (state && state.failed && state.failT > 0) {
    drawBanner(ctx, 'Mission failed', 'The job is still on the table at Mara\u2019s cafe.');
  } else {
    for (let i = world.events.length - 1; i >= 0; i--) {
      const ev = world.events[i];
      if (ev.type !== 'missionDone' || ev.t === undefined) continue;
      if (world.time - ev.t < 3) {
        const m = MISSIONS.find((mm) => mm.id === ev.id);
        drawBanner(ctx, 'Mission complete', m ? `${m.title} · +${fmtCash(m.payout)}` : '');
      }
      break;
    }
  }

  drawMinimap(ctx, world, cam);

  // A crosshair where the mouse points, while Rook is on foot.
  if (player && !player.car && input && input.mouse) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(input.mouse.x, input.mouse.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- frames

export function draw(ctx, world, input) {
  const cam = cameraFor(world);
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  drawGround(ctx, world, cam);
  drawBuildings(ctx, world, cam);
  drawMarker(ctx, world, cam);
  for (const ped of world.peds) drawPed(ctx, ped);
  for (const car of world.cars) drawCar(ctx, world, car);
  drawPlayer(ctx, world, input);
  drawFlashes(ctx, world);
  drawMarkerPillar(ctx, world);
  ctx.restore();

  drawHud(ctx, world, input, cam);
}

export function drawBanner(ctx, title, sub) {
  const bw = 560;
  const bh = 116;
  const bx = VIEW_W / 2 - bw / 2;
  const by = VIEW_H / 2 - 150;
  ctx.fillStyle = 'rgba(8, 11, 17, 0.84)';
  rrect(ctx, bx, by, bw, bh, 10);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(bx + 24, by, bw - 48, 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(title, VIEW_W / 2, by + 52);
  if (sub) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `16px ${FONT}`;
    ctx.fillText(sub, VIEW_W / 2, by + 84);
  }
}

export function drawTitle(ctx, world) {
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, 'rgba(5, 8, 14, 0.52)');
  grad.addColorStop(0.45, 'rgba(5, 8, 14, 0.10)');
  grad.addColorStop(1, 'rgba(5, 8, 14, 0.80)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText('PORT SOLACE', VIEW_W / 2, 168);
  ctx.fillStyle = GOLD;
  ctx.font = `600 19px ${FONT}`;
  ctx.fillText('Every crew in the city wants one wheelman. Tonight, that\u2019s you.', VIEW_W / 2, 204);

  const pulse = 0.55 + 0.45 * Math.sin(world.time * 2.4);
  ctx.fillStyle = `rgba(248, 250, 252, ${pulse.toFixed(3)})`;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('Press any key to start', VIEW_W / 2, VIEW_H - 128);
  ctx.fillStyle = 'rgba(203, 213, 225, 0.65)';
  ctx.font = `13px ${FONT}`;
  ctx.fillText('N — new game (erases the saved run)', VIEW_W / 2, VIEW_H - 102);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(203, 213, 225, 0.85)';
  ctx.font = `14px ${FONT}`;
  const lines = [
    'WASD / arrows — walk and drive',
    'F — enter or exit a car        E — take a job at Mara\u2019s cafe',
    'Mouse — aim · click — shoot (on foot)',
    'P or Esc — pause        M — mute',
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, 28, VIEW_H - 96 + i * 20);
  });
  ctx.textAlign = 'center';
}

export function drawBustedWasted(ctx, world) {
  const kind = world.lastOutcome?.kind ?? (world.busted ? 'busted' : world.wasted ? 'wasted' : null);
  if (!kind) return;
  ctx.fillStyle = kind === 'busted' ? 'rgba(30, 58, 138, 0.36)' : 'rgba(127, 29, 29, 0.40)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `800 92px ${FONT}`;
  ctx.fillText(kind === 'busted' ? 'BUSTED' : 'WASTED', VIEW_W / 2, VIEW_H / 2 - 10);
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.font = `17px ${FONT}`;
  ctx.fillText(
    kind === 'busted'
      ? 'The law got its hands on you — fined, and released at the station.'
      : 'You wake up at the hospital. The bill comes out of your pocket.',
    VIEW_W / 2, VIEW_H / 2 + 32,
  );
}

export function drawComplete(ctx, world) {
  ctx.fillStyle = 'rgba(5, 8, 14, 0.62)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const bw = 640;
  const bh = 250;
  const bx = VIEW_W / 2 - bw / 2;
  const by = VIEW_H / 2 - bh / 2;
  ctx.fillStyle = 'rgba(8, 11, 17, 0.88)';
  rrect(ctx, bx, by, bw, bh, 12);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(bx + 24, by, bw - 48, 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = GOLD;
  ctx.font = `800 42px ${FONT}`;
  ctx.fillText('STORY COMPLETE', VIEW_W / 2, by + 66);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `17px ${FONT}`;
  ctx.fillText('All five of Mara\u2019s jobs are done. Port Solace knows your name now.', VIEW_W / 2, by + 106);
  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(`Cash in hand: ${fmtCash(world.player ? world.player.cash : 0)}`, VIEW_W / 2, by + 148);
  ctx.fillStyle = 'rgba(203, 213, 225, 0.8)';
  ctx.font = `15px ${FONT}`;
  ctx.fillText('The city stays open — free roam as long as you like.', VIEW_W / 2, by + 182);
  ctx.fillText('Press any key to keep driving', VIEW_W / 2, by + 210);
}
