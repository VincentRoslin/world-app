import { CONFIG, type EnemySpeciesId } from '../config';
import type { ResourceKind, Tile } from '../core/types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function chunkSeed(worldSeed: number, cx: number, cy: number): number {
  return (worldSeed ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0;
}

export function chunkOrigin(cx: number, cy: number): { ox: number; oy: number } {
  return { ox: cx * CONFIG.chunkSize, oy: cy * CONFIG.chunkSize };
}

/** Stable 0–1 value for a world-space grid point. */
function hash01(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Low-frequency value noise gives terrain regions soft, connected edges. */
function terrainNoise(seed: number, x: number, y: number, scale: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = smoothstep(sx - x0);
  const ty = smoothstep(sy - y0);
  const a = hash01(seed, x0, y0);
  const b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1);
  const d = hash01(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** A continuous, gently winding stream that crosses generated chunks. */
function isStream(seed: number, gx: number, gy: number): boolean {
  const phase = (seed % 47) - 23;
  const streamY =
    42 + phase + Math.sin((gx + seed * 0.13) / 18) * 5 + Math.sin((gx - seed) / 47) * 8;
  const width = 1.15 + terrainNoise(seed ^ 0x51f15e, gx, gy, 10) * 0.9;
  return Math.abs(gy + 0.5 - streamY) < width;
}

/** Repeating three-tile crossings keep a stream from splitting the world. */
function isBridgeCrossing(seed: number, gx: number): boolean {
  const spacing = 56;
  const offset = ((seed >>> 5) % spacing) - Math.floor(spacing / 2);
  const wrapped = ((gx - offset + Math.floor(spacing / 2)) % spacing + spacing) % spacing;
  return wrapped < 3;
}

function wildTerrain(seed: number, gx: number, gy: number): Tile {
  if (isStream(seed, gx, gy)) {
    // Dirt crossing doubles as a simple bridge/path across the narrow stream.
    if (isBridgeCrossing(seed, gx)) return { terrain: 'dirt', blocked: false };
    return { terrain: 'water', blocked: true };
  }

  // Dirt forms broad, sparse clearings rather than a checker of random tiles.
  const clearing = terrainNoise(seed ^ 0x9e3779b9, gx, gy, 12);
  const terrain: Tile['terrain'] = clearing > 0.69 ? 'dirt' : 'grass';
  return { terrain, blocked: false, decoration: pickDecoration(seed, gx, gy, terrain) };
}

/** Sparse scenery provides variety without adding random-looking terrain colors. */
function pickDecoration(
  seed: number,
  gx: number,
  gy: number,
  terrain: Tile['terrain'],
): Tile['decoration'] | undefined {
  const roll = hash01(seed ^ 0x27d4eb2d, gx, gy);
  if (terrain === 'grass') {
    if (roll > 0.972) return 'tree';
    if (roll > 0.954) return 'fallenTree';
  }
  if (terrain === 'dirt' && roll > 0.978) return 'stone';
  return undefined;
}

export interface PackMember {
  x: number;
  y: number;
  species: EnemySpeciesId;
}

export interface ChunkContent {
  tiles: { gx: number; gy: number; tile: Tile }[];
  resources: { x: number; y: number; resource: ResourceKind }[];
  packs: PackMember[];
  /** Only for home chunk */
  base?: { gx: number; gy: number };
  hero?: { x: number; y: number };
  workers?: { x: number; y: number }[];
}

export function generateHomeChunk(worldSeed: number): ChunkContent {
  const size = CONFIG.chunkSize;
  const tiles: ChunkContent['tiles'] = [];
  const { ox, oy } = chunkOrigin(0, 0);

  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const gx = ox + lx;
      const gy = oy + ly;
      const terrain: Tile['terrain'] =
        terrainNoise(worldSeed ^ 0x9e3779b9, gx, gy, 12) > 0.72 ? 'dirt' : 'grass';
      tiles.push({
        gx,
        gy,
        // Home remains dry and walkable, with only a few broad dirt clearings.
        tile: {
          terrain,
          blocked: false,
          decoration: pickDecoration(worldSeed, gx, gy, terrain),
        },
      });
    }
  }

  const baseGx = ox + Math.floor(size / 2) - 1;
  const baseGy = oy + Math.floor(size / 2) - 1;

  // Index for O(1) tile lookup (avoid tiles.find O(N) per place)
  const tileAt = new Map<string, { gx: number; gy: number; tile: Tile }>();
  for (const t of tiles) tileAt.set(`${t.gx},${t.gy}`, t);

  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const t = tileAt.get(`${baseGx + dx},${baseGy + dy}`);
      if (t) {
        t.tile.terrain = 'dirt';
        t.tile.blocked = true;
        t.tile.decoration = undefined;
      }
    }
  }

  const resources: ChunkContent['resources'] = [];
  const used = new Set<string>([
    `${baseGx},${baseGy}`,
    `${baseGx + 1},${baseGy}`,
    `${baseGx},${baseGy + 1}`,
    `${baseGx + 1},${baseGy + 1}`,
  ]);

  const place = (resource: ResourceKind, lx: number, ly: number) => {
    const gx = ox + lx;
    const gy = oy + ly;
    const key = `${gx},${gy}`;
    if (used.has(key)) return;
    used.add(key);
    const t = tileAt.get(key);
    if (t) {
      t.tile.blocked = true;
      t.tile.terrain = resource === 'stone' ? 'dirt' : 'grass';
      t.tile.decoration = undefined;
    }
    resources.push({ x: gx + 0.5, y: gy + 0.5, resource });
  };

  // Relative to 32×32 home chunk (was tuned for 16×16)
  place('stone', 4, 5);
  place('stone', 5, 6);
  place('stone', 6, 4);
  place('wood', 22, 4);
  place('wood', 24, 6);
  place('wood', 20, 8);
  place('food', 18, 22);
  place('food', 20, 24);
  place('food', 16, 20);

  // Small fishing pond in the southwest corner (3×3 water + shore)
  const pondTiles: { gx: number; gy: number }[] = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      const gx = ox + 4 + dx;
      const gy = oy + 22 + dy;
      const key = `${gx},${gy}`;
      if (used.has(key)) continue;
      used.add(key);
      const t = tileAt.get(key);
      if (t) {
        t.tile.terrain = 'water';
        t.tile.blocked = true;
        t.tile.decoration = undefined;
      }
      pondTiles.push({ gx, gy });
    }
  }

  // Fishing spots on water tiles that have a walkable shore neighbor
  const isWalkableHome = (gx: number, gy: number): boolean => {
    const t = tileAt.get(`${gx},${gy}`);
    return !!t && !t.tile.blocked;
  };

  const fishSpots: { gx: number; gy: number }[] = [];
  for (const pt of pondTiles) {
    const hasShore =
      isWalkableHome(pt.gx + 1, pt.gy) ||
      isWalkableHome(pt.gx - 1, pt.gy) ||
      isWalkableHome(pt.gx, pt.gy + 1) ||
      isWalkableHome(pt.gx, pt.gy - 1);
    if (hasShore) fishSpots.push(pt);
  }

  // Place 2 fishing spots on the pond (one is enough for early game)
  for (let i = 0; i < Math.min(2, fishSpots.length); i++) {
    const fs = fishSpots[i]!;
    resources.push({ x: fs.gx + 0.5, y: fs.gy + 0.5, resource: 'fish' });
  }

  // Home square is safe — no mobs in chunk (0,0)
  return {
    tiles,
    resources,
    packs: [],
    base: { gx: baseGx, gy: baseGy },
    hero: { x: baseGx + 2.5, y: baseGy + 1.5 },
    workers: [
      { x: baseGx + 2.5, y: baseGy + 0.5 },
      { x: baseGx + 3.5, y: baseGy + 1.5 },
    ],
  };
}

export function generateWildChunk(worldSeed: number, cx: number, cy: number): ChunkContent {
  const rand = mulberry32(chunkSeed(worldSeed, cx, cy));
  const size = CONFIG.chunkSize;
  const { ox, oy } = chunkOrigin(cx, cy);
  const tiles: ChunkContent['tiles'] = [];

  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const gx = ox + lx;
      const gy = oy + ly;
      tiles.push({ gx, gy, tile: wildTerrain(worldSeed, gx, gy) });
    }
  }

  const tileAt = new Map<string, { gx: number; gy: number; tile: Tile }>();
  for (const t of tiles) tileAt.set(`${t.gx},${t.gy}`, t);

  const resources: ChunkContent['resources'] = [];
  const kinds: ResourceKind[] = ['stone', 'wood', 'food'];
  // ~2.5× the old 16×16 counts (not full 4×) so density stays playable on 32×32
  const resCount = 5 + Math.floor(rand() * 7);
  for (let i = 0; i < resCount; i++) {
    const lx = 1 + Math.floor(rand() * (size - 2));
    const ly = 1 + Math.floor(rand() * (size - 2));
    const gx = ox + lx;
    const gy = oy + ly;
    const t = tileAt.get(`${gx},${gy}`);
    if (!t || t.tile.blocked) continue;
    t.tile.blocked = true;
    const resource = kinds[Math.floor(rand() * kinds.length)]!;
    if (resource === 'stone') t.tile.terrain = 'dirt';
    t.tile.decoration = undefined;
    resources.push({ x: gx + 0.5, y: gy + 0.5, resource });
  }

  // Fishing spots on water tiles that have a walkable shore neighbor
  const isWalkableLocal = (map: Map<string, { gx: number; gy: number; tile: Tile }>, gx: number, gy: number): boolean => {
    const t = map.get(`${gx},${gy}`);
    return !!t && !t.tile.blocked;
  };

  const shoreWater: { gx: number; gy: number }[] = [];
  for (const t of tiles) {
    if (t.tile.terrain !== 'water' || !t.tile.blocked) continue;
    const hasShore =
      isWalkableLocal(tileAt, t.gx + 1, t.gy) ||
      isWalkableLocal(tileAt, t.gx - 1, t.gy) ||
      isWalkableLocal(tileAt, t.gx, t.gy + 1) ||
      isWalkableLocal(tileAt, t.gx, t.gy - 1);
    if (hasShore) shoreWater.push({ gx: t.gx, gy: t.gy });
  }
  if (shoreWater.length > 0) {
    const fishCount = rand() < 0.55 ? 1 + (rand() < 0.35 ? 1 : 0) : 0;
    const usedFish = new Set<string>();
    for (let i = 0; i < fishCount && usedFish.size < shoreWater.length; i++) {
      const pick = shoreWater[Math.floor(rand() * shoreWater.length)]!;
      const key = `${pick.gx},${pick.gy}`;
      if (usedFish.has(key)) continue;
      usedFish.add(key);
      // Don't place fish on a tile already claimed as solid resource
      const alreadyResource = resources.some(
        (r) => Math.floor(r.x) === pick.gx && Math.floor(r.y) === pick.gy,
      );
      if (alreadyResource) continue;
      resources.push({ x: pick.gx + 0.5, y: pick.gy + 0.5, resource: 'fish' });
    }
  }

  // Never treat as home; wild only. Scatter packs with 2–4 tile spacing.
  const packs: PackMember[] = [];
  const nearHome = Math.max(Math.abs(cx), Math.abs(cy)) <= 1;
  const chance = nearHome ? CONFIG.wildPackChance * 0.85 : CONFIG.wildPackChance;
  if (rand() < chance) {
    const speciesRoll = rand();
    const species: EnemySpeciesId =
      speciesRoll < 0.4 ? 'cow' : speciesRoll < 0.75 ? 'goblin' : 'human';
    const packCount = nearHome ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2);
    for (let attempt = 0; attempt < 40; attempt++) {
      const lx = 2 + Math.floor(rand() * (size - 4));
      const ly = 2 + Math.floor(rand() * (size - 4));
      const gx = ox + lx;
      const gy = oy + ly;
      const t = tileAt.get(`${gx},${gy}`);
      if (!t || t.tile.blocked) continue;

      const placed: { x: number; y: number }[] = [];
      for (let i = 0; i < packCount; i++) {
        let found = false;
        for (let tryN = 0; tryN < 20; tryN++) {
          const ox2 = gx + Math.floor(rand() * 7) - 3;
          const oy2 = gy + Math.floor(rand() * 7) - 3;
          // Enforce min spacing of 2 tiles between pack members
          if (placed.some((p) => Math.abs(p.x - ox2) + Math.abs(p.y - oy2) < 2)) continue;
          const tt = tileAt.get(`${ox2},${oy2}`);
          if (!tt || tt.tile.blocked) continue;
          placed.push({ x: ox2, y: oy2 });
          packs.push({ x: ox2 + 0.5, y: oy2 + 0.5, species });
          found = true;
          break;
        }
        if (!found && i === 0) {
          packs.push({ x: gx + 0.5, y: gy + 0.5, species });
          placed.push({ x: gx, y: gy });
        }
      }
      break;
    }
  }

  return { tiles, resources, packs };
}
