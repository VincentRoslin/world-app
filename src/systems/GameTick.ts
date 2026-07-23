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
 * Discrete "server" clock for the hybrid game.
 *
 * Architecture (important for learning the codebase):
 * - **Continuous (every frame):** hero/worker movement, camera, rendering.
 * - **Discrete (every CONFIG.gameTickSec ≈ 0.6s):** combat swings, fishing progress,
 *   worker gather ticks, node replenish, train timers.
 *
 * Why both? Movement feels smooth; combat/economy stay readable and fair (no
 * frame-rate-dependent DPS). Player RMB intents are *queued* and applied at the
 * start of the next tick so order of resolution is deterministic.
 *
 * Called from Game.ts each frame:
 *   n = advanceClock(world, dt)
 *   for i in 0..n: processGameTick(world)
 */

/**
 * Accumulate real time and return how many full ticks to process this frame.
 * Caps at maxTicksPerFrame so a long tab-out doesn't simulate minutes in one frame
 * (the "spiral of death" problem in fixed-timestep games).
 */
export function advanceClock(world: World, dt: number): number {
  world.tickAcc += dt;
  let n = 0;
  while (world.tickAcc >= CONFIG.gameTickSec && n < CONFIG.maxTicksPerFrame) {
    world.tickAcc -= CONFIG.gameTickSec;
    n++;
  }
  // Drop leftover time if we hit the cap so we don't process an infinite backlog later.
  if (n >= CONFIG.maxTicksPerFrame && world.tickAcc > CONFIG.gameTickSec) {
    world.tickAcc = world.tickAcc % CONFIG.gameTickSec;
  }
  return n;
}

/** Fraction through the current tick [0,1) — used for optional visual lerp. */
export function tickAlpha(world: World): number {
  return Math.min(1, Math.max(0, world.tickAcc / CONFIG.gameTickSec));
}

/**
 * One server cycle:
 * 1) apply queued player intents (attack / fish / move)
 * 2) combat AI + swings
 * 3) fishing catch progress + fish respawns
 * 4) workers (gather / deposit / wait-for-respawn) + buildings
 * 5) fog-of-war / chunk streaming, loot pickup
 *
 * Walking itself is NOT stepped here — Movement.updateMovement runs every frame.
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

/**
 * Drain pendingAttackId / pendingFishId / pendingMove set by Input this tick window.
 * Only one intent wins: attack > fish > move (checked in that order).
 */
function applyPlayerIntents(world: World): void {
  const attackId = world.pendingAttackId;
  const move = world.pendingMove;
  const fishId = world.pendingFishId;
  // Clear first so a failed action cannot re-fire next tick.
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
    // Soft kite: if still inside the enemy camp leash, walk without ending combat.
    // Leaving the leash (or no valid front) fully clears the fight.
    if (hero.combatEngaged && hero.combatTargetId != null) {
      const front = world.get(hero.combatTargetId);
      if (
        front &&
        front.kind === 'enemy' &&
        front.alive &&
        dist(hero.x, hero.y, front.campX, front.campY) <= CONFIG.enemyLeashDistance &&
        dist(front.x, front.y, front.campX, front.campY) <= CONFIG.enemyLeashDistance
      ) {
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
