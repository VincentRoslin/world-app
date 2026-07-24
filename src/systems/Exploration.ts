import type { World } from '../world/World';

/**
 * Stream chunks around the hero (and optionally camera look-at for Dev cam).
 * Map visibility is full for all loaded tiles.
 */
export function updateExploration(
  world: World,
  opts?: { alsoAround?: { x: number; y: number } },
): void {
  const hero = world.hero();
  if (hero && hero.alive) {
    world.ensureChunksAround(hero.x, hero.y);
  }
  // Dev cam / free look: generate chunks under the lens without moving the hero
  if (opts?.alsoAround) {
    world.ensureChunksAround(opts.alsoAround.x, opts.alsoAround.y);
  }
}
