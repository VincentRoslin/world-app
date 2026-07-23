import { CONFIG } from '../config';
import { DIRS4 } from '../core/grid';
import type { EntityId, Hero, ResourceNode } from '../core/types';
import type { World } from '../world/World';
import { clearHeroCombat } from './Combat';
import { addItem } from './Inventory';
import { issueMove } from './Movement';
import { addSkillXp, skillLabel, type LevelUpEvent } from './Skills';

/** Game ticks needed to land one fish (lower level = longer). */
export function fishCatchTicks(fishingLevel: number): number {
  const lvl = Math.max(1, Math.min(99, Math.floor(fishingLevel)));
  const raw = CONFIG.fishBaseTicks - (lvl - 1) * CONFIG.fishTicksPerLevel;
  return Math.max(
    CONFIG.fishMinTicks,
    Math.min(CONFIG.fishBaseTicks, Math.round(raw)),
  );
}

export function clearFishing(hero: Hero): void {
  hero.fishingTimer = 0;
  hero.fishingNodeId = null;
}

/** Queue fishing on the next game tick. */
export function queueFish(world: World, nodeId: EntityId): void {
  if (world.status !== 'playing') return;
  const hero = world.hero();
  if (!hero || !hero.alive) return;
  const node = world.get(nodeId);
  if (!node || node.kind !== 'resourceNode' || node.resource !== 'fish') return;
  if (node.remaining <= 0) {
    world.message = 'This fishing spot is empty right now.';
    return;
  }
  world.selectedId = hero.id;
  world.pendingMove = null;
  world.pendingAttackId = null;
  world.shopInteractNpcId = null;
  world.pendingFishId = nodeId;
  world.message = 'Fishing…';
}

export function startFishing(world: World, hero: Hero, nodeId: EntityId): void {
  const node = world.get(nodeId);
  if (!node || node.kind !== 'resourceNode' || node.resource !== 'fish' || !node.alive) {
    world.message = 'That fishing spot is gone.';
    return;
  }
  if (node.remaining <= 0) {
    world.message = 'This fishing spot is empty right now.';
    return;
  }

  clearHeroCombat(world, hero);
  hero.fishingNodeId = nodeId;
  hero.fishingTimer = 0;

  const stand = pickFishingStand(world, hero, node);
  if (!stand) {
    world.message = 'No shore to fish from.';
    clearFishing(hero);
    return;
  }

  const onStand =
    Math.floor(hero.x) === Math.floor(stand.x) && Math.floor(hero.y) === Math.floor(stand.y);
  if (!onStand) {
    issueMove(world, hero, stand.x, stand.y);
  } else {
    hero.x = stand.x;
    hero.y = stand.y;
    if (hero.order.type === 'move') hero.order = { type: 'none' };
  }
  world.message = 'You cast your line…';
}

function pickFishingStand(
  world: World,
  hero: Hero,
  node: ResourceNode,
): { x: number; y: number } | null {
  const stands = world.standPositions(node);
  if (stands.length === 0) {
    // Fallback: any ortho walkable neighbor of the water tile
    const nx = Math.floor(node.x);
    const ny = Math.floor(node.y);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const d of DIRS4) {
      const gx = nx + d.x;
      const gy = ny + d.y;
      if (!world.isWalkable(gx, gy)) continue;
      const dMan =
        Math.abs(gx - Math.floor(hero.x)) + Math.abs(gy - Math.floor(hero.y));
      if (dMan < bestD) {
        bestD = dMan;
        best = { x: gx + 0.5, y: gy + 0.5 };
      }
    }
    return best;
  }
  let best = stands[0]!;
  let bestD = Infinity;
  for (const s of stands) {
    const d = Math.hypot(s.x - hero.x, s.y - hero.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function isAdjacentToNode(hero: Hero, node: ResourceNode): boolean {
  const hx = Math.floor(hero.x);
  const hy = Math.floor(hero.y);
  const nx = Math.floor(node.x);
  const ny = Math.floor(node.y);
  const dx = Math.abs(hx - nx);
  const dy = Math.abs(hy - ny);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

/** Advance hero fishing one game tick. */
export function updateFishingOnTick(world: World): void {
  const hero = world.hero();
  if (!hero || !hero.alive) return;
  if (hero.fishingNodeId == null) return;

  // Interrupt conditions
  if (hero.combatEngaged) {
    clearFishing(hero);
    return;
  }
  // Player walked away mid-fish (order is a move not toward stand)
  if (hero.order.type === 'move') {
    // Still approaching stand — keep fishing intent, don't tick catch
    const node = world.get(hero.fishingNodeId);
    if (!node || node.kind !== 'resourceNode') {
      clearFishing(hero);
      return;
    }
    // If somehow moving elsewhere, clear
    const stand = pickFishingStand(world, hero, node);
    if (
      stand &&
      (hero.order.tx !== Math.floor(stand.x) || hero.order.ty !== Math.floor(stand.y))
    ) {
      clearFishing(hero);
    }
    return;
  }

  const node = world.get(hero.fishingNodeId);
  if (
    !node ||
    node.kind !== 'resourceNode' ||
    node.resource !== 'fish' ||
    !node.alive
  ) {
    clearFishing(hero);
    world.message = 'The fishing spot is gone.';
    return;
  }
  if (node.remaining <= 0) {
    clearFishing(hero);
    world.message = 'This fishing spot is empty.';
    return;
  }

  if (!isAdjacentToNode(hero, node)) {
    const stand = pickFishingStand(world, hero, node);
    if (stand) issueMove(world, hero, stand.x, stand.y);
    else clearFishing(hero);
    return;
  }

  // Snap to tile center while fishing
  hero.x = Math.floor(hero.x) + 0.5;
  hero.y = Math.floor(hero.y) + 0.5;
  hero.order = { type: 'none' };

  const need = fishCatchTicks(hero.skills.fishing.level);
  hero.fishingTimer += 1;

  if (hero.fishingTimer < need) {
    world.message = `Fishing… (${hero.fishingTimer}/${need})`;
    return;
  }

  // Catch!
  hero.fishingTimer = 0;
  const fish = world.createItem('raw_fish', 1);
  if (!addItem(world.inventory, fish, () => world.allocItemUid())) {
    world.message = 'Inventory full — you release the fish.';
    world.spawnFloatText(hero.x, hero.y, 'Bag full', '#f85149');
    return;
  }

  node.remaining -= 1;
  world.spawnFloatText(hero.x, hero.y - 0.15, '+1 Raw Fish', '#388bfd');
  const events = addSkillXp(hero.skills, 'fishing', CONFIG.fishXpPerCatch);
  for (const ev of events) announceFishLevel(world, hero, ev);

  if (node.remaining <= 0) {
    node.remaining = 0;
    // Remove depleted spot and schedule respawn at a nearby water tile
    const oldX = node.x;
    const oldY = node.y;
    clearFishing(hero);
    world.removeEntity(node.id);
    world.pendingFishRespawns.push({
      timer: CONFIG.fishRespawnDelay,
      nearX: oldX,
      nearY: oldY,
    });
    world.message = 'The fishing spot is depleted. A new one will appear nearby soon.';
  } else {
    world.message = `You catch a Raw Fish. (${node.remaining} left)`;
  }
}

function announceFishLevel(world: World, hero: Hero, ev: LevelUpEvent): void {
  world.spawnFloatText(hero.x, hero.y, `${skillLabel(ev.skill)} ${ev.level}!`, '#e3b341');
  world.message = `Congratulations! Your ${skillLabel(ev.skill)} level is now ${ev.level}.`;
}

/** Process pending fishing spot respawns: decrement timers and spawn new spots. */
export function updateFishRespawns(world: World): void {
  for (let i = world.pendingFishRespawns.length - 1; i >= 0; i--) {
    const entry = world.pendingFishRespawns[i]!;
    entry.timer -= CONFIG.gameTickSec;
    if (entry.timer <= 0) {
      // Find a nearby water tile with shore and spawn a new fishing spot
      const pos = world.findNearbyWaterWithShore(entry.nearX, entry.nearY);
      if (pos) {
        world.createResourceNode(pos.x, pos.y, 'fish');
      }
      // Remove entry whether or not we found a spot (prevents infinite retry loops)
      world.pendingFishRespawns.splice(i, 1);
    }
  }
}
