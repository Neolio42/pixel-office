// Asset loader — loads all PNG sprite sheets and pre-colorizes floor/wall tiles

export interface AssetBundle {
  characters: HTMLImageElement[];   // char_0.png … char_5.png
  floors: HTMLImageElement[];       // floor_0.png … floor_8.png
  wallSheet: HTMLImageElement;      // wall_0.png
  furniture: Map<string, HTMLImageElement>; // keyed by "FOLDER/FILENAME" e.g. "DESK/DESK_FRONT"
  // Pre-colorized offscreen canvases
  colorizedFloors: Map<string, HTMLCanvasElement>; // key = floorIndex:h:s:b:c
  colorizedWall: HTMLCanvasElement;
}

// HSBC colorize params (Photoshop-style Colorize)
export interface HsbcParams {
  h: number;  // hue 0-360
  s: number;  // saturation 0-100
  b: number;  // brightness -100..100
  c: number;  // contrast -100..100
}

// Floor color presets referenced by office-layout
export const FLOOR_COLORS = {
  wood:    { h: 25,  s: 48, b: -43, c: -88 } as HsbcParams,
  blueCarpet: { h: 209, s: 39, b: -25, c: -80 } as HsbcParams,
  neutralTile: { h: 209, s: 0,  b: -16, c: -8  } as HsbcParams,
};

export const WALL_COLORS: HsbcParams = { h: 214, s: 30, b: -100, c: -55 };

// ── HSL helpers ────────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Apply Photoshop-style colorize to a grayscale image and return an offscreen canvas
export function colorizeImage(img: HTMLImageElement, params: HsbcParams): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const { h, s, b, c } = params;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;

    // 1. Luminance from grayscale source
    const r = data[i], g = data[i + 1], bl2 = data[i + 2];
    let L = (0.299 * r + 0.587 * g + 0.114 * bl2) / 255;

    // 2. Apply contrast
    L = 0.5 + (L - 0.5) * (100 + c) / 100;

    // 3. Apply brightness
    L = L + b / 200;

    // 4. Clamp
    L = Math.max(0, Math.min(1, L));

    // 5. HSL → RGB
    const [nr, ng, nb] = hslToRgb(h, s, L * 100);
    data[i]     = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ── Image loading ──────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

// Furniture items we actually use in the office layout
const FURNITURE_ASSETS: Array<{ key: string; path: string }> = [
  // Desks & PCs
  { key: 'DESK/DESK_FRONT',           path: '/assets/furniture/DESK/DESK_FRONT.png' },
  { key: 'PC/PC_FRONT_ON_1',          path: '/assets/furniture/PC/PC_FRONT_ON_1.png' },
  { key: 'PC/PC_FRONT_ON_2',          path: '/assets/furniture/PC/PC_FRONT_ON_2.png' },
  { key: 'PC/PC_FRONT_ON_3',          path: '/assets/furniture/PC/PC_FRONT_ON_3.png' },
  { key: 'PC/PC_FRONT_OFF',           path: '/assets/furniture/PC/PC_FRONT_OFF.png' },
  // Bookshelves
  { key: 'BOOKSHELF/BOOKSHELF',       path: '/assets/furniture/BOOKSHELF/BOOKSHELF.png' },
  { key: 'DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF', path: '/assets/furniture/DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png' },
  // Plants & greenery
  { key: 'PLANT/PLANT',               path: '/assets/furniture/PLANT/PLANT.png' },
  { key: 'PLANT_2/PLANT_2',           path: '/assets/furniture/PLANT_2/PLANT_2.png' },
  { key: 'LARGE_PLANT/LARGE_PLANT',   path: '/assets/furniture/LARGE_PLANT/LARGE_PLANT.png' },
  { key: 'CACTUS/CACTUS',             path: '/assets/furniture/CACTUS/CACTUS.png' },
  { key: 'HANGING_PLANT/HANGING_PLANT', path: '/assets/furniture/HANGING_PLANT/HANGING_PLANT.png' },
  { key: 'POT/POT',                   path: '/assets/furniture/POT/POT.png' },
  // Wall art
  { key: 'SMALL_PAINTING/SMALL_PAINTING',     path: '/assets/furniture/SMALL_PAINTING/SMALL_PAINTING.png' },
  { key: 'SMALL_PAINTING_2/SMALL_PAINTING_2', path: '/assets/furniture/SMALL_PAINTING_2/SMALL_PAINTING_2.png' },
  { key: 'LARGE_PAINTING/LARGE_PAINTING',     path: '/assets/furniture/LARGE_PAINTING/LARGE_PAINTING.png' },
  { key: 'CLOCK/CLOCK',               path: '/assets/furniture/CLOCK/CLOCK.png' },
  // Seating & tables
  { key: 'WHITEBOARD/WHITEBOARD',     path: '/assets/furniture/WHITEBOARD/WHITEBOARD.png' },
  { key: 'SOFA/SOFA_BACK',            path: '/assets/furniture/SOFA/SOFA_BACK.png' },
  { key: 'COFFEE_TABLE/COFFEE_TABLE', path: '/assets/furniture/COFFEE_TABLE/COFFEE_TABLE.png' },
  { key: 'COFFEE/COFFEE',             path: '/assets/furniture/COFFEE/COFFEE.png' },
  { key: 'WOODEN_CHAIR/WOODEN_CHAIR_BACK', path: '/assets/furniture/WOODEN_CHAIR/WOODEN_CHAIR_BACK.png' },
  { key: 'CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK', path: '/assets/furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK.png' },
  // Misc
  { key: 'BIN/BIN',                   path: '/assets/furniture/BIN/BIN.png' },
];

export async function loadAssets(): Promise<AssetBundle> {
  // Load character sheets
  const characterPromises = Array.from({ length: 6 }, (_, i) =>
    loadImage(`/assets/characters/char_${i}.png`)
  );

  // Load floor tiles
  const floorPromises = Array.from({ length: 9 }, (_, i) =>
    loadImage(`/assets/floors/floor_${i}.png`)
  );

  // Load wall sheet
  const wallPromise = loadImage('/assets/walls/wall_0.png');

  // Load furniture
  const furniturePromises = FURNITURE_ASSETS.map(({ key, path }) =>
    loadImage(path).then(img => ({ key, img }))
  );

  const [characters, floors, wallSheet, furnitureResults] = await Promise.all([
    Promise.all(characterPromises),
    Promise.all(floorPromises),
    wallPromise,
    Promise.all(furniturePromises),
  ]);

  const furniture = new Map<string, HTMLImageElement>();
  for (const { key, img } of furnitureResults) {
    furniture.set(key, img);
  }

  // Pre-colorize floor tiles for each variant we use
  const colorizedFloors = new Map<string, HTMLCanvasElement>();
  const floorVariants: Array<{ floorIndex: number; params: HsbcParams }> = [
    { floorIndex: 7, params: FLOOR_COLORS.wood },
    { floorIndex: 1, params: FLOOR_COLORS.blueCarpet },
    { floorIndex: 0, params: FLOOR_COLORS.neutralTile },
  ];
  for (const { floorIndex, params } of floorVariants) {
    const key = `${floorIndex}:${params.h}:${params.s}:${params.b}:${params.c}`;
    colorizedFloors.set(key, colorizeImage(floors[floorIndex], params));
  }

  // Pre-colorize wall sheet
  const colorizedWall = colorizeImage(wallSheet, WALL_COLORS);

  return { characters, floors, wallSheet, furniture, colorizedFloors, colorizedWall };
}
