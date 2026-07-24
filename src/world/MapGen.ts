import { CONFIG, type EnemySpeciesId } from '../config';
import type { BiomeId, ResourceKind, Tile, TileTerrain } from '../core/types';

// Note: land resource nodes use CONFIG.nodeMinSeparation (Chebyshev) so worker
// stand tiles around each node stay exclusive — simpler than fancy path dodge.

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

// ── Rivers (smooth centerline + orthogonal distance) ─────────────────

/** Winding river centerline Y as a function of X — low frequencies only (less zigzag). */
function streamCenterY(seed: number, gx: number): number {
  const phase = (seed % 47) - 23;
  // Long wavelengths dominate; tiny high-freq terms were making stairsteps
  return (
    42 +
    phase +
    Math.sin((gx + seed * 0.07) / 36) * 7.5 +
    Math.sin((gx * 0.9 - seed * 0.2) / 78) * 11 +
    Math.sin((gx + seed) / 140) * 4
  );
}

/**
 * Approximate distance from tile center to the stream centerline,
 * accounting for local slope so diagonals don’t stair-step as hard.
 */
function streamDist(seed: number, gx: number, gy: number): number {
  const cy = streamCenterY(seed, gx);
  const cyL = streamCenterY(seed, gx - 1);
  const cyR = streamCenterY(seed, gx + 1);
  const slope = (cyR - cyL) * 0.5; // dy/dx of centerline
  const dy = gy + 0.5 - cy;
  // Distance to line with slope: |dy| / sqrt(1+m²)
  return Math.abs(dy) / Math.sqrt(1 + slope * slope);
}

function streamHalfWidth(seed: number, gx: number, gy: number): number {
  // Slow width variation — avoid per-tile width noise that creates jaggies
  const w = 1.55 + terrainNoise(seed ^ 0x51f15e, gx * 0.35, gy * 0.35, 14) * 0.85;
  return w;
}

function isStreamWater(seed: number, gx: number, gy: number): boolean {
  return streamDist(seed, gx, gy) < streamHalfWidth(seed, gx, gy);
}

/**
 * Bridge: every ~spacing tiles along X, a short dirt span across the river.
 * Uses river local frame so the crossing is thick enough in Y for wide water.
 */
function isBridgeTile(seed: number, gx: number, gy: number): boolean {
  if (!isStreamWater(seed, gx, gy) && streamDist(seed, gx, gy) > streamHalfWidth(seed, gx, gy) + 0.9) {
    return false;
  }
  const spacing = 48;
  const offset = ((seed >>> 5) % spacing) - Math.floor(spacing / 2);
  const along = ((gx - offset) % spacing + spacing) % spacing;
  // 4-tile-wide deck along river length
  if (along >= 4) return false;
  // Allow deck + short ramps onto bank (slightly outside pure water)
  return streamDist(seed, gx, gy) < streamHalfWidth(seed, gx, gy) + 1.1;
}

// ── Biomes ───────────────────────────────────────────────────────────

export function biomeAt(seed: number, gx: number, gy: number): BiomeId {
  // Large-scale regions so whole chunks feel consistent (no tundra/snow near start)
  const a = terrainNoise(seed ^ 0xb10b10, gx, gy, 92);
  const b = terrainNoise(seed ^ 0xf07e57, gx, gy, 64);
  // Near origin bias to meadow (home-friendly)
  const dist = Math.hypot(gx / CONFIG.chunkSize, gy / CONFIG.chunkSize);
  if (dist < 1.35) return 'meadow';
  if (a > 0.72) return 'arid';
  if (b > 0.55) return 'forest';
  return 'meadow';
}

// ── Dirt paths (soft corridors) ──────────────────────────────────────

function isDirtPath(seed: number, gx: number, gy: number): boolean {
  // Path follows low-frequency noise ridges + occasional straight lanes
  const n = terrainNoise(seed ^ 0x0a7a, gx, gy, 26);
  const ridge = Math.abs(n - 0.5);
  if (ridge < 0.028) return true;
  // Cross-paths every so often (straighter dirt tracks)
  const lane = Math.abs(((gy + Math.floor(seed % 9)) % 29) - 14);
  if (lane <= 0 && n > 0.35 && n < 0.72) return true;
  const laneX = Math.abs(((gx + Math.floor(seed % 7)) % 33) - 16);
  if (laneX <= 0 && n > 0.38 && n < 0.7) return true;
  return false;
}

// ── Base tile composition ────────────────────────────────────────────

function landTerrainForBiome(biome: BiomeId, seed: number, gx: number, gy: number): TileTerrain {
  const clearing = terrainNoise(seed ^ 0x9e3779b9, gx, gy, 14);
  switch (biome) {
    case 'arid':
      return clearing > 0.55 ? 'sand' : 'dirt';
    case 'forest':
      return clearing > 0.82 ? 'dirt' : 'grass';
    case 'meadow':
    default:
      return clearing > 0.71 ? 'dirt' : 'grass';
  }
}

function pickDecoration(
  seed: number,
  gx: number,
  gy: number,
  terrain: TileTerrain,
  biome: BiomeId,
): Tile['decoration'] | undefined {
  if (terrain === 'water') return undefined;
  const roll = hash01(seed ^ 0x27d4eb2d, gx, gy);
  const forestBoost = biome === 'forest' ? 0.04 : 0;
  const aridBoost = biome === 'arid' ? 0.02 : 0;

  if (terrain === 'grass') {
    // Non-resource trees / bushes — denser in forest
    if (roll > 0.965 - forestBoost) return 'tree';
    if (roll > 0.948 - forestBoost * 0.5) return 'bush';
    if (roll > 0.935) return 'fallenTree';
  }
  if (terrain === 'dirt' || terrain === 'sand') {
    if (roll > 0.97 - aridBoost) return 'rock';
    if (roll > 0.955 - aridBoost) return 'stone';
    if (roll > 0.94 && biome === 'forest') return 'bush';
  }
  return undefined;
}

function composeTile(seed: number, gx: number, gy: number): Tile {
  const biome = biomeAt(seed, gx, gy);

  // River + bridges first
  if (isBridgeTile(seed, gx, gy)) {
    return { terrain: 'dirt', blocked: false, biome, decoration: undefined };
  }
  if (isStreamWater(seed, gx, gy)) {
    return { terrain: 'water', blocked: true, biome };
  }

  // Paths over land
  if (isDirtPath(seed, gx, gy)) {
    const t: TileTerrain = biome === 'arid' ? 'sand' : 'dirt';
    return {
      terrain: t,
      blocked: false,
      biome,
      decoration: pickDecoration(seed, gx, gy, t, biome),
    };
  }

  const terrain = landTerrainForBiome(biome, seed, gx, gy);
  return {
    terrain,
    blocked: false,
    biome,
    decoration: pickDecoration(seed, gx, gy, terrain, biome),
  };
}

/**
 * Soften water/land edges inside a chunk: fill single-tile bites, trim 1-tile spikes.
 * Keeps bridges (dirt that was stream) intact.
 */
function smoothWaterEdges(
  tiles: { gx: number; gy: number; tile: Tile }[],
  seed: number,
): void {
  const map = new Map<string, Tile>();
  for (const t of tiles) map.set(`${t.gx},${t.gy}`, t.tile);

  const isWater = (gx: number, gy: number) => map.get(`${gx},${gy}`)?.terrain === 'water';

  // Two light passes — enough to kill most stairsteps without erasing the river
  for (let pass = 0; pass < 2; pass++) {
    const updates: { key: string; toWater: boolean }[] = [];
    for (const t of tiles) {
      const { gx, gy, tile } = t;
      // Never convert bridge dirt back to water
      if (isBridgeTile(seed, gx, gy)) continue;

      let n = 0;
      if (isWater(gx + 1, gy)) n++;
      if (isWater(gx - 1, gy)) n++;
      if (isWater(gx, gy + 1)) n++;
      if (isWater(gx, gy - 1)) n++;

      if (tile.terrain === 'water' && n <= 1) {
        // Lonely / spike water → land
        updates.push({ key: `${gx},${gy}`, toWater: false });
      } else if (tile.terrain !== 'water' && !tile.blocked && n >= 3) {
        // Pocket almost enclosed by water → fill (smoother bank)
        updates.push({ key: `${gx},${gy}`, toWater: true });
      }
    }
    for (const u of updates) {
      const tile = map.get(u.key);
      if (!tile) continue;
      if (u.toWater) {
        tile.terrain = 'water';
        tile.blocked = true;
        tile.decoration = undefined;
      } else {
        const [xs, ys] = u.key.split(',').map(Number) as [number, number];
        const biome = tile.biome ?? biomeAt(seed, xs, ys);
        tile.terrain = landTerrainForBiome(biome, seed, xs, ys);
        tile.blocked = false;
        tile.decoration = pickDecoration(seed, xs, ys, tile.terrain, biome);
      }
    }
  }
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

/**
 * Procedural content for one chunk before World materializes entities/tiles.
 *
 * Home chunk (0,0): safe base, tight resource clusters, pond, workers — no packs.
 * Wild chunks: biomes, smoother streams + bridges, dirt paths, décor, resources, packs.
 */
export function generateHomeChunk(worldSeed: number): ChunkContent {
  const size = CONFIG.chunkSize;
  const tiles: ChunkContent['tiles'] = [];
  const { ox, oy } = chunkOrigin(0, 0);

  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const gx = ox + lx;
      const gy = oy + ly;
      let terrain: TileTerrain =
        terrainNoise(worldSeed ^ 0x9e3779b9, gx, gy, 12) > 0.72 ? 'dirt' : 'grass';
      if (isDirtPath(worldSeed, gx, gy)) terrain = 'dirt';
      tiles.push({
        gx,
        gy,
        tile: {
          terrain,
          blocked: false,
          biome: 'meadow',
          decoration: pickDecoration(worldSeed, gx, gy, terrain, 'meadow'),
        },
      });
    }
  }

  const baseGx = ox + Math.floor(size / 2) - 1;
  const baseGy = oy + Math.floor(size / 2) - 1;

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
  const nodeCells: { gx: number; gy: number }[] = [];
  const minSep = CONFIG.nodeMinSeparation;

  const farEnough = (gx: number, gy: number): boolean => {
    for (const n of nodeCells) {
      if (Math.max(Math.abs(n.gx - gx), Math.abs(n.gy - gy)) < minSep) return false;
    }
    return true;
  };

  const place = (resource: ResourceKind, lx: number, ly: number) => {
    const gx = ox + lx;
    const gy = oy + ly;
    const key = `${gx},${gy}`;
    if (used.has(key)) return;
    if (!farEnough(gx, gy)) return;
    used.add(key);
    nodeCells.push({ gx, gy });
    const t = tileAt.get(key);
    if (t) {
      t.tile.blocked = true;
      t.tile.terrain = resource === 'stone' ? 'dirt' : 'grass';
      t.tile.decoration = undefined;
    }
    resources.push({ x: gx + 0.5, y: gy + 0.5, resource });
  };

  place('stone', 3, 4);
  place('stone', 3, 7);
  place('stone', 6, 4);
  place('wood', 21, 4);
  place('wood', 21, 7);
  place('wood', 24, 4);
  place('food', 16, 21);
  place('food', 16, 24);
  place('food', 19, 21);

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

  for (let i = 0; i < Math.min(2, fishSpots.length); i++) {
    const fs = fishSpots[i]!;
    resources.push({ x: fs.gx + 0.5, y: fs.gy + 0.5, resource: 'fish' });
  }

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
      tiles.push({ gx, gy, tile: composeTile(worldSeed, gx, gy) });
    }
  }

  smoothWaterEdges(tiles, worldSeed);

  const tileAt = new Map<string, { gx: number; gy: number; tile: Tile }>();
  for (const t of tiles) tileAt.set(`${t.gx},${t.gy}`, t);

  const resources: ChunkContent['resources'] = [];
  const kinds: ResourceKind[] = ['stone', 'wood', 'food'];
  const nodeCells: { gx: number; gy: number }[] = [];
  const minSep = CONFIG.nodeMinSeparation;
  const resCount = 5 + Math.floor(rand() * 7);
  let attempts = 0;
  while (resources.length < resCount && attempts < resCount * 24) {
    attempts++;
    const lx = 1 + Math.floor(rand() * (size - 2));
    const ly = 1 + Math.floor(rand() * (size - 2));
    const gx = ox + lx;
    const gy = oy + ly;
    const t = tileAt.get(`${gx},${gy}`);
    if (!t || t.tile.blocked) continue;
    let ok = true;
    for (const n of nodeCells) {
      if (Math.max(Math.abs(n.gx - gx), Math.abs(n.gy - gy)) < minSep) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    t.tile.blocked = true;
    const resource = kinds[Math.floor(rand() * kinds.length)]!;
    if (resource === 'stone') t.tile.terrain = 'dirt';
    t.tile.decoration = undefined;
    nodeCells.push({ gx, gy });
    resources.push({ x: gx + 0.5, y: gy + 0.5, resource });
  }

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
      const alreadyResource = resources.some(
        (r) => Math.floor(r.x) === pick.gx && Math.floor(r.y) === pick.gy,
      );
      if (alreadyResource) continue;
      resources.push({ x: pick.gx + 0.5, y: pick.gy + 0.5, resource: 'fish' });
    }
  }

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
