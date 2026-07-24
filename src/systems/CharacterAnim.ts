/**
 * Tick-synced character animation (stepped keyframes).
 *
 * Rules:
 * - Advances only on the 0.6s game tick (never per-frame).
 * - No interpolation between poses — renderer snapshots hard angles.
 * - Walk: 4 hard poses cycle each tick while pathing (plant / pass / plant / pass).
 * - Attack: 3 poses over 3 ticks — ready (0), contact (1), recover (2).
 *   Combat sets contact on the swing tick; this module advances after.
 */

import { CONFIG } from '../config';
import type { Hero } from '../core/types';
import type { World } from '../world/World';

function isPathing(hero: Hero): boolean {
  if (hero.order.type === 'move') {
    if (hero.order.path.length > 0) return true;
    const d = Math.hypot(hero.order.tx + 0.5 - hero.x, hero.order.ty + 0.5 - hero.y);
    return d > 0.08;
  }
  if (hero.order.type === 'attack' && hero.order.path && hero.order.path.length > 0) {
    return true;
  }
  return false;
}

/** Snap facing from current order / combat target (once per tick). */
function snapFacing(world: World, hero: Hero): void {
  let aimX = hero.x;
  let aimY = hero.y;

  if (hero.order.type === 'move') {
    if (hero.order.path.length > 0) {
      const n = hero.order.path[0]!;
      aimX = n.x + 0.5;
      aimY = n.y + 0.5;
    } else {
      aimX = hero.order.tx + 0.5;
      aimY = hero.order.ty + 0.5;
    }
  } else if (hero.order.type === 'attack' && hero.order.path && hero.order.path.length > 0) {
    const n = hero.order.path[0]!;
    aimX = n.x + 0.5;
    aimY = n.y + 0.5;
  } else if (hero.combatTargetId != null) {
    const t = world.get(hero.combatTargetId);
    if (t && t.alive) {
      aimX = t.x;
      aimY = t.y;
    }
  }

  // Iso screen-x ≈ (worldX - worldY)
  const scrDx = aimX - hero.x - (aimY - hero.y);
  if (Math.abs(scrDx) > 0.02) {
    hero.animFacing = scrDx >= 0 ? 1 : -1;
  }
}

/**
 * Called once per game tick after combat resolution.
 * Advances stepped walk / attack clips; never blends.
 */
export function updateCharacterAnimOnTick(world: World): void {
  const hero = world.hero();
  if (!hero || !hero.alive) return;

  snapFacing(world, hero);

  // --- Attack clip: 3 hard keyframes over 3 ticks ---
  if (hero.animClip === 'attack') {
    if (hero.animHoldTick) {
      // Same tick as swing contact — hold frame, advance next tick
      hero.animHoldTick = false;
      return;
    }
    hero.animFrame += 1;
    if (hero.animFrame >= CONFIG.charAttackFrames) {
      // Finished recovery → idle or walk next tick's choice
      hero.animClip = isPathing(hero) ? 'walk' : 'idle';
      hero.animFrame = 0;
    }
    return;
  }

  // Ready stance one tick before swing (timer counted down to 1)
  if (hero.combatInMelee && hero.combatEngaged && hero.attackTimer === 1) {
    hero.animClip = 'attack';
    hero.animFrame = 0; // ready / weapon raised
    hero.animHoldTick = false;
    return;
  }

  // --- Walk: flip pose each tick while pathing ---
  if (isPathing(hero)) {
    if (hero.animClip !== 'walk') {
      hero.animClip = 'walk';
      hero.animFrame = 0;
    } else {
      hero.animFrame = (hero.animFrame + 1) % CONFIG.charWalkFrames;
    }
    return;
  }

  // Idle
  hero.animClip = 'idle';
  hero.animFrame = 0;
}

/**
 * Start (or force) the contact keyframe on the swing tick.
 * Called from combat when the hero's weapon lands.
 */
export function startHeroAttackContact(hero: Hero): void {
  hero.animClip = 'attack';
  hero.animFrame = 1; // contact / active frame
  hero.animHoldTick = true; // don't advance until next game tick
}
