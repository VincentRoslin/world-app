import { CONFIG } from '../config';
import type { World } from '../world/World';

/** Load chunks near the hero and reveal tiles within vision radius. */
export function updateExploration(world: World): void {
  const hero = world.hero();
  if (!hero || !hero.alive) return;

  world.ensureChunksAround(hero.x, hero.y);

  const r = CONFIG.visionRadius;
  const hx = Math.floor(hero.x);
  const hy = Math.floor(hero.y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      // A square sight footprint prevents the thin, black diagonal gaps that
      // a circular tile reveal leaves when walking around an area.
      if (Math.max(Math.abs(dx), Math.abs(dy)) > r) continue;
      const gx = hx + dx;
      const gy = hy + dy;
      // Skip redundant Set inserts
      if (world.isExplored(gx, gy)) continue;
      if (world.tileAt(gx, gy)) {
        world.markExplored(gx, gy);
      }
    }
  }

  fillEnclosedFog(world, hx, hy);
}

/**
 * Reveal local fog islands completely surrounded by explored tiles. This makes
 * looping around an area feel like mapping it, without exposing open territory
 * beyond the player's explored perimeter.
 */
function fillEnclosedFog(world: World, hx: number, hy: number): void {
  const radius = CONFIG.visionRadius * 4;
  const minX = Math.max(world.minGx, hx - radius);
  const maxX = Math.min(world.maxGx, hx + radius);
  const minY = Math.max(world.minGy, hy - radius);
  const maxY = Math.min(world.maxGy, hy + radius);
  const outside = new Set<string>();
  const queue: { x: number; y: number }[] = [];

  const tryAdd = (x: number, y: number) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return;
    if (world.isExplored(x, y) || !world.tileAt(x, y)) return;
    const key = `${x},${y}`;
    if (outside.has(key)) return;
    outside.add(key);
    queue.push({ x, y });
  };

  // Unexplored fog touching this local boundary is still connected to unknown
  // territory. Flood-fill it; everything left over is an enclosed pocket.
  for (let x = minX; x <= maxX; x++) {
    tryAdd(x, minY);
    tryAdd(x, maxY);
  }
  for (let y = minY + 1; y < maxY; y++) {
    tryAdd(minX, y);
    tryAdd(maxX, y);
  }

  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i]!;
    tryAdd(x + 1, y);
    tryAdd(x - 1, y);
    tryAdd(x, y + 1);
    tryAdd(x, y - 1);
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!world.isExplored(x, y) && world.tileAt(x, y) && !outside.has(`${x},${y}`)) {
        world.markExplored(x, y);
      }
    }
  }
}
