import { CONFIG } from '../config';
import { DIRS4 } from '../core/grid';
import { dist, floorTile } from '../core/math';
import type { EntityId, Npc } from '../core/types';
import type { World } from '../world/World';
import { clearHeroCombat } from './Combat';
import { clearFishing } from './Fishing';
import { issueMove } from './Movement';

/**
 * RMB vendor: sticky approach + open when in range (like attack/fish).
 * Cleared by move/attack/fish or after shop opens.
 */
export function queueShopInteract(world: World, npcId: EntityId): void {
  if (world.status !== 'playing') return;
  const hero = world.hero();
  if (!hero || !hero.alive) return;
  const npc = world.get(npcId);
  if (!npc || npc.kind !== 'npc' || npc.role !== 'shop' || !npc.alive) {
    world.message = 'That vendor is gone.';
    return;
  }

  world.selectedId = hero.id;
  world.pendingMove = null;
  world.pendingAttackId = null;
  world.pendingFishId = null;
  clearFishing(hero);
  clearHeroCombat(world, hero);

  world.shopInteractNpcId = npcId;
  world.message = `Walking to ${npc.name}…`;

  // Start path immediately (continuous movement), not only next tick
  if (!heroInRangeOfNpc(hero.x, hero.y, npc)) {
    const stand = pickVendorStand(world, hero.x, hero.y, npc);
    if (stand) issueMove(world, hero, stand.x, stand.y);
  }
}

export function clearShopInteract(world: World): void {
  world.shopInteractNpcId = null;
}

function heroInRangeOfNpc(hx: number, hy: number, npc: Npc): boolean {
  return dist(hx, hy, npc.x, npc.y) <= CONFIG.shopInteractRange;
}

/** Stand near vendor (tile center on/adjacent walkable). */
function pickVendorStand(
  world: World,
  hx: number,
  hy: number,
  npc: Npc,
): { x: number; y: number } | null {
  const ng = floorTile(npc.x, npc.y);
  const candidates: { x: number; y: number }[] = [];
  if (world.isWalkable(ng.gx, ng.gy)) {
    candidates.push({ x: ng.gx + 0.5, y: ng.gy + 0.5 });
  }
  for (const d of DIRS4) {
    const gx = ng.gx + d.x;
    const gy = ng.gy + d.y;
    if (world.isWalkable(gx, gy)) candidates.push({ x: gx + 0.5, y: gy + 0.5 });
  }
  // Diagonals as fallback
  for (const dx of [-1, 1]) {
    for (const dy of [-1, 1]) {
      const gx = ng.gx + dx;
      const gy = ng.gy + dy;
      if (world.isWalkable(gx, gy)) candidates.push({ x: gx + 0.5, y: gy + 0.5 });
    }
  }
  if (candidates.length === 0) return { x: npc.x, y: npc.y };

  let best = candidates[0]!;
  let bestD = Infinity;
  for (const c of candidates) {
    // Prefer stands still within interact range of the NPC
    if (dist(c.x, c.y, npc.x, npc.y) > CONFIG.shopInteractRange) continue;
    const d = dist(c.x, c.y, hx, hy);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // If none in range, pick closest walkable to hero among all candidates
  if (bestD === Infinity) {
    for (const c of candidates) {
      const d = dist(c.x, c.y, hx, hy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/**
 * Each frame after movement: keep pathing toward vendor; when in range return npc id to open UI.
 */
export function updateShopInteract(world: World): EntityId | null {
  const id = world.shopInteractNpcId;
  if (id == null) return null;

  const hero = world.hero();
  if (!hero || !hero.alive) {
    world.shopInteractNpcId = null;
    return null;
  }

  const npc = world.get(id);
  if (!npc || !npc.alive || npc.kind !== 'npc' || npc.role !== 'shop') {
    world.shopInteractNpcId = null;
    world.message = 'That vendor is gone.';
    return null;
  }

  if (heroInRangeOfNpc(hero.x, hero.y, npc)) {
    world.shopInteractNpcId = null;
    if (hero.order.type === 'move') hero.order = { type: 'none' };
    return id;
  }

  // Still approaching — repath if idle or destination is stale
  const stand = pickVendorStand(world, hero.x, hero.y, npc);
  if (!stand) return null;

  const needRepath =
    hero.order.type !== 'move' ||
    dist(hero.order.tx, hero.order.ty, stand.x, stand.y) > 0.75;

  if (needRepath) {
    issueMove(world, hero, stand.x, stand.y);
  }

  // Soft progress message occasionally (don't spam)
  if (world.tickCount % 8 === 0) {
    world.message = `Walking to ${npc.name}…`;
  }
  return null;
}

