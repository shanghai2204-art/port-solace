// config.js — the fixed numbers of Port Solace: stage, world, street grid,
// palette, the six districts, and the tuning for the player and the cars.
// Everything else reads from here so the city can be rebalanced in one place.

// The canvas stage, in pixels. The camera shows exactly this much world.
export const VIEW_W = 1280;
export const VIEW_H = 800;

// The whole city, in world pixels. Streets form a regular grid over it.
export const WORLD_W = 3200;
export const WORLD_H = 2400;

// Street grid: road centerlines repeat every BLOCK px. A road is ROAD_W px
// wide (two lanes each way) with a SIDEWALK px pavement on both sides, so a
// city block's buildable interior is BLOCK - ROAD_W - 2 * SIDEWALK = 200 px.
export const BLOCK = 320;
export const ROAD_W = 92;
export const SIDEWALK = 14;

// Paint and ground colours. Flat-shaded on purpose: the look is a clean
// map-like top-down, with roofs carrying most of the colour variety.
export const COLORS = {
  asphalt: '#2e3138',
  asphaltEdge: '#23262c',
  lanePaint: '#c9a83c', // worn yellow centre lines
  laneWhite: '#b9bec6', // lane dashes and crosswalks
  sidewalk: '#8f8f86',
  sidewalkEdge: '#6e6e64',
  grass: '#40682f',
  grassDark: '#35582a',
  dirt: '#6d5b43',
  concrete: '#7a7d80',
  water: '#1d4e5f',
  waterDeep: '#173f4d',
  sand: '#9a8a67',
  parkPath: '#7a6a4f',
  // General pool, used when a district style does not pin its own colours.
  buildingPalette: ['#9c6b4f', '#7d7f8a', '#a3906c', '#6f7d8c', '#8a5f56', '#767a68'],
  roofPalette: ['#4c4238', '#55504a', '#5d5348', '#474c55', '#66584a'],
};

// A building style: footprint ranges in px, how many lots of it a block
// tends to hold, and the wall / roof colours its buildings are drawn from.
function style(name, minW, maxW, minH, maxH, perBlock, walls, roofs) {
  return { name, minW, maxW, minH, maxH, perBlock, walls, roofs };
}

// The six districts tile the whole 3200x2400 map (see the layout below).
// Densities are 0..1 dials the traffic / pedestrian / police systems read:
//   pedDensity     — how crowded the pavements are
//   policePresence — how much law the district starts with
//   trafficDensity — how busy the roads (and kerbs) are
//
//   y=0     The Flats      | Downtown        | Airstrip
//   y=1200  Harbor         | Old Town | G.Row| Airstrip
export const DISTRICTS = [
  {
    id: 'flats',
    name: 'The Flats',
    x: 0, y: 0, w: 1280, h: 1200,
    ground: '#676b5e',
    buildingStyles: [
      style('apartment block', 62, 112, 52, 92, [1, 3],
        ['#8a7a63', '#7d7268', '#94826a', '#6f7a72'], ['#4c4238', '#55504a', '#5d5348']),
      style('corner shop', 34, 56, 30, 48, [2, 3],
        ['#a3906c', '#9c6b4f', '#7d7f8a'], ['#66584a', '#474c55']),
    ],
    pedDensity: 0.6,
    policePresence: 0.45,
    trafficDensity: 0.55,
  },
  {
    id: 'downtown',
    name: 'Downtown',
    x: 1280, y: 0, w: 1280, h: 1200,
    ground: '#5d6066',
    buildingStyles: [
      style('tower', 72, 128, 72, 128, [1, 2],
        ['#6f7d8c', '#7d7f8a', '#5f707e', '#87919c'], ['#3d434c', '#474c55', '#525860']),
      style('office block', 58, 104, 52, 96, [1, 2],
        ['#7d7f8a', '#6f7d8c', '#94826a'], ['#4c4238', '#474c55']),
      style('bank', 58, 88, 52, 80, [1, 1],
        ['#a3906c', '#8f8268'], ['#55504a']),
    ],
    pedDensity: 1.0,
    policePresence: 0.9,
    trafficDensity: 1.0,
  },
  {
    id: 'airstrip',
    name: 'Airstrip Flats',
    x: 2560, y: 0, w: 640, h: 2400,
    ground: '#75705f',
    buildingStyles: [
      style('hangar', 120, 188, 82, 138, [1, 1],
        ['#7d7f8a', '#8a8d94', '#6f7d8c'], ['#5d5348', '#55504a', '#66584a']),
      style('depot', 60, 110, 48, 84, [1, 2],
        ['#8a7a63', '#767a68'], ['#4c4238', '#55504a']),
    ],
    pedDensity: 0.15,
    policePresence: 0.25,
    trafficDensity: 0.3,
  },
  {
    id: 'harbor',
    name: 'Harbor',
    x: 0, y: 1200, w: 1280, h: 1200,
    ground: '#71685a',
    buildingStyles: [
      style('warehouse', 92, 188, 72, 148, [1, 2],
        ['#8a5f56', '#7d6a58', '#6f7d8c', '#94826a'], ['#4c4238', '#5d5348', '#474c55']),
      style('dock shed', 44, 84, 34, 60, [2, 3],
        ['#767a68', '#8a7a63'], ['#55504a', '#66584a']),
      style('harbor office', 48, 78, 40, 64, [1, 2],
        ['#9c6b4f', '#7d7f8a'], ['#4c4238']),
    ],
    pedDensity: 0.35,
    policePresence: 0.3,
    trafficDensity: 0.45,
  },
  {
    id: 'oldtown',
    name: 'Old Town',
    x: 1280, y: 1200, w: 640, h: 1200,
    ground: '#7c7263',
    buildingStyles: [
      style('shop row', 38, 78, 32, 66, [2, 4],
        ['#a3906c', '#9c6b4f', '#8a5f56', '#b09872'], ['#66584a', '#5d5348', '#474c55']),
      style('tenement', 52, 92, 48, 84, [2, 3],
        ['#8a7a63', '#94826a', '#7d7268'], ['#4c4238', '#55504a']),
      style('cafe', 34, 54, 28, 44, [1, 2],
        ['#b09872', '#a3906c'], ['#66584a']),
    ],
    pedDensity: 0.8,
    policePresence: 0.5,
    trafficDensity: 0.6,
  },
  {
    id: 'gardenrow',
    name: 'Garden Row',
    x: 1920, y: 1200, w: 640, h: 1200,
    ground: '#40682f',
    buildingStyles: [
      style('house', 30, 52, 26, 44, [3, 4],
        ['#b09872', '#9c8a70', '#8a9a7d', '#a87f5f'], ['#5d5348', '#66584a', '#4c4238']),
      style('garden flat', 48, 76, 40, 62, [2, 3],
        ['#94826a', '#8a9a7d'], ['#55504a', '#4c4238']),
    ],
    pedDensity: 0.5,
    policePresence: 0.35,
    trafficDensity: 0.35,
  },
];

// On-foot tuning. Speeds in px/s; the player is a circle of `radius` px.
export const PLAYER = {
  radius: 11,
  walkSpeed: 182,
  sprintSpeed: 278,
  accel: 2100, // how fast velocity catches up to the input direction
  maxHealth: 100,
  enterRange: 48, // how close to a car door the player must be to get in
};

// Driving tuning, per car class. w/h are the car's footprint in px;
// accel and top speeds are px/s and px/s^2; turn is rad/s of heading at
// full lock (scaled down as speed rises, in drive.js); grip is how hard
// the velocity is pulled toward the heading (higher = less drift);
// health is the damage the car soaks before it burns.
export const CAR_CLASSES = {
  hatch:  { w: 34, h: 18, accel: 305, maxSpeed: 332, reverseMax: 112, turn: 2.95, grip: 7.5, health: 70 },
  sedan:  { w: 38, h: 19, accel: 342, maxSpeed: 382, reverseMax: 122, turn: 2.62, grip: 8.0, health: 90 },
  sports: { w: 38, h: 18, accel: 525, maxSpeed: 545, reverseMax: 142, turn: 3.12, grip: 8.6, health: 60 },
  truck:  { w: 48, h: 22, accel: 242, maxSpeed: 302, reverseMax: 102, turn: 2.02, grip: 7.0, health: 150 },
  police: { w: 38, h: 19, accel: 432, maxSpeed: 452, reverseMax: 132, turn: 2.82, grip: 8.6, health: 110 },
};

// Shared driving numbers that do not belong to one class.
export const CAR = {
  enterRange: 54, // px from car centre for the "get in" prompt
  brakeDecel: 620,
  rollFriction: 0.55, // fraction of speed kept per second with no throttle
  handbrakeGrip: 2.1, // grip while the handbrake is held (drift)
  crashSpeed: 265, // impacts above this closing speed damage the car
};
