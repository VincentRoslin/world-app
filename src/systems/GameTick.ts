import { CONFIG } from '../config';
import type { World } from '../world/World';
import { clearHeroCombat, onGameTickCombat, setHeroCombatTarget } from './Combat';
import { clearFishing, startFishing, updateFishingOnTick, updateFishRespawns } from './Fishing';
import { issueMove } from './Movement';
import { updateProductionOnTick } from './Production';
import { updateExploration } from './Exploration';
import { updateLootPickup } from './Loot';
import { dist } from '../core/math';

/**
 * Advance the OSRS-style game clock. Returns how many full ticks to process.
 * @see https://oldschool.runescape.wiki/w/Game_tick
 */
export function advanceClock(world: World, dt: number): number {
  world.tickAcc += dt;
  let n = 0;
  while (world.tickAcc >= CONFIG.gameTickSec && n < CONFIG.maxTicksPerFrame) {
    world.tickAcc -= CONFIG.gameTickSec;
    n++;
  }
  if (n >= CONFIG.maxTicksPerFrame && world.tickAcc > CONFIG.gameTickSec) {
    world.tickAcc = world.tickAcc % CONFIG.gameTickSec;
  }
  return n;
}

/** Fraction through the current tick [0,1) (unused for walk; combat UI optional). */
export function tickAlpha(world: World): number {
  return Math.min(1, Math.max(0, world.tickAcc / CONFIG.gameTickSec));
}

/**
 * One server cycle (0.6s at 1×):
 * 1) apply queued player intents
 * 2) combat / AI
 * 3) production / exploration / loot
 *
 * Walking is continuous every frame (OSRS run rate via heroSpeed), not stepped here.
 */
export function processGameTick(world: World): void {
  applyPlayerIntents(world);
  onGameTickCombat(world);
  updateFishingOnTick(world);
  updateFishRespawns(world);
  updateProductionOnTick(world);
  updateExploration(world);
  updateLootPickup(world);
  world.tickCount += 1;
}

function applyPlayerIntents(world: World): void {
  const attackId = world.pendingAttackId;
  const move = world.pendingMove;
  const fishId = world.pendingFishId;
  world.pendingAttackId = null;
  world.pendingMove = null;
  world.pendingFishId = null;

  if (attackId != null) {
    const hero = world.hero();
    if (!hero || !hero.alive) return;
    const enemy = world.get(attackId);
    if (!enemy || enemy.kind !== 'enemy' || !enemy.alive) {
      world.message = 'That target is gone.';
      return;
    }
    world.selectedId = hero.id;
    clearFishing(hero);
    setHeroCombatTarget(world, attackId, true);
    return;
  }

  if (fishId != null) {
    const hero = world.hero();
    if (!hero || !hero.alive) return;
    world.selectedId = hero.id;
    startFishing(world, hero, fishId);
    return;
  }

  if (move) {
    const hero = world.hero();
    if (!hero || !hero.alive) return;
    world.selectedId = hero.id;
    clearFishing(hero);
    // Keep combat if still inside camp leash — mobs can chase; only hard-escape clears fight
    if (hero.combatEngaged && hero.combatTargetId != null) {
      const front = world.get(hero.combatTargetId);
      if (
        front &&
        front.kind === 'enemy' &&
        front.alive &&
        dist(hero.x, hero.y, front.campX, front.campY) <= CONFIG.enemyLeashDistance &&
        dist(front.x, front.y, front.campX, front.campY) <= CONFIG.enemyLeashDistance
      ) {
        // Soft kite: walk without ending combat
        issueMove(world, hero, move.x, move.y);
        hero.combatStandX = null;
        hero.combatStandY = null;
        world.message = '';
        return;
      }
    }
    clearHeroCombat(world, hero);
    issueMove(world, hero, move.x, move.y);
    world.message = '';
  }
}
