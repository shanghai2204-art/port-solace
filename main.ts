// Port Solace — a gta6-01 entry (Node 22, standard library only).
//
// Port Solace is an original top-down open-world crime game. A living
// grid city of six districts — Harbor, Old Town, Downtown, The Flats,
// Garden Row and Airstrip Flats — with lane-following traffic, crowds
// on the pavements and a five-level wanted system whose police pursue,
// ram and box the player in. You are Rook, a dock courier turned
// wheelman: steal and drive any car on the street, and work five story
// missions for Mara Voss, the fixer who runs the Harbor cafe.
//
// How to play: WASD / arrows walk and drive; F enters or exits a car;
// the mouse aims and click shoots while on foot; E takes a job at
// Mara's cafe; P or Esc pauses; M mutes.
//
// Features: a deterministic seeded city (same seed, same streets);
// arcade driving with drifting, damage and burnt-out wrecks; traffic
// that queues, brakes and honks; pedestrians who stroll, flee and get
// knocked down; heat that decays only once the law loses sight of you;
// busted / wasted consequences (a fine and a respawn, never a reset);
// a localStorage save that keeps cash and finished jobs between runs;
// a demo mode that drives itself behind the title screen.
//
// Tech: vanilla JavaScript on a 2D canvas — no engine, no build step,
// no assets and no network. Sound is synthesised live with WebAudio
// (engine, siren, gunshots, crashes, chimes). The game is this
// directory's game/ folder, plain static files a desktop browser loads
// offline; this program hands it in: it copies game/ and screenshots/
// from beside this file to /output and writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8901.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
