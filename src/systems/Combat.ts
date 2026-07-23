import { CONFIG, ENEMY_SPECIES } from '../config';
import { dist, floorTile } from '../core/math';
import { DIRS4 } from '../core/grid';
import type { Enemy, EntityId, Hero } from '../core/types';
import type { World } from '../world/World';
import { issueAttack, issueMove } from './Movement';
import { spawnLootAt } from './Loot';
import {
  applyHeroStats,
  attackRoll,
  defenceRoll,
  estimateMaxHit,
} from './Inventory';
import {
  addSkillXp,
  XP_PER_HIT,
  skillLabel,
  type LevelUpEvent,
} from './Skills';

/**
 * Combat system (tick-based).
 *
 * High-level flow each game tick (see GameTick.processGameTick → onGameTickCombat):
 * 1. Maintain fight queue / pack join / leash (soft death: escape by distance).
 * 2. Alternate hero ↔ front-enemy swings when both are in melee.
 * 3. Accuracy = meleeHitChance(attackRoll, defenceRoll); damage uniform 0..maxHit.
 * 4. Grant XP: one step (XP_PER_HIT) only when damage > 0 — no XP on misses / zero rolls.
 *
 * Melee is orthogonal adjacency only (no diagonal) so positioning stays readable.
 */

/** True when A and B share an edge (N/E/S/W). Diagonal does not count. */
function inMeleeRange(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(Math.floor(ax) - Math.floor(bx));
  const dy = Math.abs(Math.floor(ay) - Math.floor(by));
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

export function setHeroCombatTarget(world: World, enemyId: EntityId, queueIfBusy: boolean): void {
  const hero = world.hero();
  const enemy = world.get(enemyId);
  if (!hero || !hero.alive || !enemy || enemy.kind !== 'enemy' || !enemy.alive) return;

  hero.combatEngaged = true;

  const inQueue = hero.fightQueue.includes(enemyId);
  const fighting = hero.combatEngaged && hero.fightQueue.length > 0 && hero.combatTargetId != null;

  if (queueIfBusy && fighting && hero.combatTargetId !== enemyId) {
    if (inQueue) {
      promoteToFront(world, hero, enemyId);
      world.message = `Fighting ${speciesName(enemy)}.`;
      return;
    }
    // Only same pack can join mid-fight
    const front = hero.combatTargetId != null ? world.get(hero.combatTargetId) : null;
    if (
      front &&
      front.kind === 'enemy' &&
      enemy.packId !== 0 &&
      enemy.packId === front.packId &&
      dist(enemy.x, enemy.y, front.x, front.y) <= CONFIG.fightGroupRadius
    ) {
      addToFightQueue(world, hero, enemyId);
      layoutFight(world, hero);
      world.message = `${speciesName(enemy)} joined the fight.`;
      return;
    }
    hero.queuedTargetId = enemyId;
    world.message = `Queued ${speciesName(enemy)}.`;
    return;
  }

  beginFight(world, hero, enemyId);
}

export function clearHeroCombat(world: World, hero: Hero): void {
  for (const id of hero.fightQueue) {
    const e = world.get(id);
    if (e && e.kind === 'enemy') {
      e.fightRole = 'idle';
      e.queueIndex = -1;
      if (!e.leashing) {
        e.aggressive = false;
        e.order = { type: 'none' };
      }
    }
  }
  hero.fightQueue = [];
  hero.combatTargetId = null;
  hero.queuedTargetId = null;
  hero.combatStandX = null;
  hero.combatStandY = null;
  hero.combatEngaged = false;
  hero.combatTurn = 'hero';
  if (hero.order.type === 'attack') hero.order = { type: 'none' };
  // Drop queued player intents so a stale attack cannot re-engage next tick
  world.pendingAttackId = null;
  world.shopInteractNpcId = null;
  // pendingMove left alone — flee may have just been queued
}

function beginFight(world: World, hero: Hero, primaryId: EntityId): void {
  const primary = world.get(primaryId);
  if (!primary || primary.kind !== 'enemy' || !primary.alive) {
    clearHeroCombat(world, hero);
    return;
  }

  clearHeroCombat(world, hero);
  hero.combatEngaged = true;
  hero.combatTurn = 'hero'; // hero always opens

  hero.fightQueue = [primaryId];
  // ONLY same pack within group radius — never random nearby packs
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'enemy') continue;
    if (e.id === primaryId) continue;
    if (primary.packId === 0) continue;
    if (e.packId !== primary.packId) continue;
    if (dist(e.x, e.y, primary.x, primary.y) > CONFIG.fightGroupRadius) continue;
    hero.fightQueue.push(e.id);
  }

  assignRoles(world, hero);
  layoutFight(world, hero);
  hero.combatTargetId = hero.fightQueue[0] ?? null;
  // Don't overwrite a stand approach move — maintainCombat / layoutFight set orders.
  if (hero.combatTargetId != null && hero.order.type !== 'move') {
    const front = world.get(hero.combatTargetId);
    if (front && front.kind === 'enemy' && inMeleeRange(hero.x, hero.y, front.x, front.y)) {
      issueAttack(hero, hero.combatTargetId);
    } else if (hero.combatStandX == null) {
      issueAttack(hero, hero.combatTargetId);
    }
  }
  world.message = `Fighting ${speciesName(primary)}.`;
}

function addToFightQueue(world: World, hero: Hero, enemyId: EntityId): void {
  if (hero.fightQueue.includes(enemyId)) return;
  hero.fightQueue.push(enemyId);
  assignRoles(world, hero);
}

function promoteToFront(world: World, hero: Hero, enemyId: EntityId): void {
  const idx = hero.fightQueue.indexOf(enemyId);
  if (idx <= 0) return;
  hero.fightQueue.splice(idx, 1);
  hero.fightQueue.unshift(enemyId);
  hero.combatTurn = 'hero';
  assignRoles(world, hero);
  layoutFight(world, hero);
  hero.combatTargetId = enemyId;
  issueAttack(hero, enemyId);
}

function assignRoles(world: World, hero: Hero): void {
  hero.fightQueue = hero.fightQueue.filter((id) => {
    const e = world.get(id);
    return e && e.alive && e.kind === 'enemy';
  });

  for (let i = 0; i < hero.fightQueue.length; i++) {
    const e = world.get(hero.fightQueue[i]!);
    if (!e || e.kind !== 'enemy') continue;
    e.queueIndex = i;
    e.fightRole = i === 0 ? 'front' : 'waiting';
    e.aggressive = true;
    e.leashing = false;
    if (i === 0) {
      // Front: only engage once hero is adjacent (don't chase the player)
      if (inMeleeRange(e.x, e.y, hero.x, hero.y)) {
        if (e.order.type !== 'attack' || e.order.targetId !== hero.id) {
          issueAttack(e, hero.id);
        }
      } else if (e.order.type === 'attack') {
        e.order = { type: 'none' };
      }
      // leave move alone only if somehow set; front should hold
      if (e.order.type === 'move') e.order = { type: 'none' };
    } else {
      // Waiters: may path to lineup slots (layoutFight sets move). Cancel chase-attack.
      if (e.order.type === 'attack') e.order = { type: 'none' };
    }
  }
  hero.combatTargetId = hero.fightQueue[0] ?? null;
}

/**
 * Hero walks to an ortho tile beside the front mob (front holds).
 * Waiters path into queue: behind the front, then hero flanks.
 */
function layoutFight(world: World, hero: Hero): void {
  if (!hero.combatEngaged) return;
  const frontId = hero.fightQueue[0];
  if (frontId == null) return;
  const front = world.get(frontId);
  if (!front || front.kind !== 'enemy') return;

  const ftx = Math.floor(front.x);
  const fty = Math.floor(front.y);

  // Front holds its tile — hero closes the gap
  front.x = ftx + 0.5;
  front.y = fty + 0.5;
  if (!inMeleeRange(front.x, front.y, hero.x, hero.y)) {
    if (front.order.type === 'move' || front.order.type === 'attack') {
      front.order = { type: 'none' };
    }
  }

  const stand = pickHeroStandTile(world, hero, ftx, fty);
  if (stand) {
    hero.combatStandX = stand.x + 0.5;
    hero.combatStandY = stand.y + 0.5;
    if (Math.floor(hero.x) !== stand.x || Math.floor(hero.y) !== stand.y) {
      issueMove(world, hero, stand.x + 0.5, stand.y + 0.5);
    } else {
      hero.x = stand.x + 0.5;
      hero.y = stand.y + 0.5;
      if (hero.order.type === 'move') hero.order = { type: 'none' };
      issueAttack(hero, front.id);
      if (inMeleeRange(hero.x, hero.y, front.x, front.y)) {
        issueAttack(front, hero.id);
      }
    }
  }

  placeWaiters(world, hero, front, stand);
}

/**
 * Queue slots for waiters (queueIndex 1+):
 *  1) behind the front (away from hero stand)
 *  2) hero's left / right flanks
 *  3) further back / diagonal fallbacks
 * So the next packmate is already in place when the front dies.
 */
function placeWaiters(
  world: World,
  hero: Hero,
  front: Enemy,
  stand: { x: number; y: number } | null,
): void {
  const ftx = Math.floor(front.x);
  const fty = Math.floor(front.y);
  const hx = stand ? stand.x : Math.floor(hero.combatStandX ?? hero.x);
  const hy = stand ? stand.y : Math.floor(hero.combatStandY ?? hero.y);

  // Unit vector from front → hero stand (ortho fight axis)
  let dhx = Math.sign(hx - ftx);
  let dhy = Math.sign(hy - fty);
  if (dhx === 0 && dhy === 0) {
    dhx = 1;
    dhy = 0;
  }
  // Behind front (queue line) and perpendicular sides
  const bx = -dhx;
  const by = -dhy;
  const sx = -dhy;
  const sy = dhx;

  // Ordered candidate tiles for successive waiters
  const candidates: { x: number; y: number }[] = [
    // Queue behind front
    { x: ftx + bx, y: fty + by },
    { x: ftx + bx * 2, y: fty + by * 2 },
    { x: ftx + bx * 3, y: fty + by * 3 },
    // Hero flanks (either side of the player)
    { x: hx + sx, y: hy + sy },
    { x: hx - sx, y: hy - sy },
    // Behind + side offsets
    { x: ftx + bx + sx, y: fty + by + sy },
    { x: ftx + bx - sx, y: fty + by - sy },
    { x: ftx + bx * 2 + sx, y: fty + by * 2 + sy },
    { x: ftx + bx * 2 - sx, y: fty + by * 2 - sy },
    // Extra ortho around front if needed
    { x: ftx + sx, y: fty + sy },
    { x: ftx - sx, y: fty - sy },
  ];

  const occupied = new Set<string>([`${ftx},${fty}`, `${hx},${hy}`]);
  // Don't assign hero stand or front to waiters
  let candIdx = 0;

  for (let i = 1; i < hero.fightQueue.length; i++) {
    const e = world.get(hero.fightQueue[i]!);
    if (!e || e.kind !== 'enemy') continue;

    let placed = false;
    while (candIdx < candidates.length) {
      const c = candidates[candIdx++]!;
      const key = `${c.x},${c.y}`;
      if (occupied.has(key)) continue;
      if (!world.isWalkable(c.x, c.y)) continue;
      if (tileOccupied(world, c.x, c.y, e.id)) continue;
      occupied.add(key);
      const tx = c.x + 0.5;
      const ty = c.y + 0.5;
      if (Math.floor(e.x) === c.x && Math.floor(e.y) === c.y) {
        e.x = tx;
        e.y = ty;
        if (e.order.type === 'attack') e.order = { type: 'none' };
        // already there — stop moving
        if (e.order.type === 'move') e.order = { type: 'none' };
      } else {
        issueMove(world, e, tx, ty);
      }
      placed = true;
      break;
    }
    if (!placed && e.order.type === 'attack') e.order = { type: 'none' };
  }
}

function pickHeroStandTile(
  world: World,
  hero: Hero,
  ftx: number,
  fty: number,
): { x: number; y: number } | null {
  const from = floorTile(hero.x, hero.y);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const d of DIRS4) {
    const x = ftx + d.x;
    const y = fty + d.y;
    if (!world.isWalkable(x, y)) continue;
    if (tileOccupied(world, x, y, hero.id)) continue;
    const dMan = Math.abs(x - from.gx) + Math.abs(y - from.gy);
    if (dMan < bestD) {
      bestD = dMan;
      best = { x, y };
    }
  }
  if (!best) {
    for (const d of DIRS4) {
      const x = ftx + d.x;
      const y = fty + d.y;
      if (!world.isWalkable(x, y)) continue;
      return { x, y };
    }
  }
  return best;
}

function tileOccupied(world: World, gx: number, gy: number, ignoreId: EntityId): boolean {
  for (const e of world.entities.values()) {
    if (!e.alive || e.id === ignoreId) continue;
    if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'enemy') continue;
    if (Math.floor(e.x) === gx && Math.floor(e.y) === gy) return true;
  }
  return false;
}

function speciesName(e: Enemy): string {
  return ENEMY_SPECIES[e.species]?.name ?? 'Enemy';
}

/**
 * Combat + AI phase for one game tick (called from GameTick orchestrator).
 * No continuous dt — decisions and swings are discrete.
 */
export function onGameTickCombat(world: World): void {
  const hero = world.hero();
  if (hero && hero.alive) {
    hero.combatTimer += CONFIG.gameTickSec;
    if (hero.combatEngaged) {
      maintainCombatMovement(world, hero);
    }
  }

  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'enemy') continue;
    updateEnemyMovementAi(world, e, hero);
  }

  processCombatSwings(world);
  processDeaths(world);

  if (hero && hero.alive) {
    if (hero.combatTimer >= CONFIG.heroCombatGrace && hero.hp < hero.maxHp) {
      // Regen scaled per tick (≈ old per-second rate)
      hero.hp = Math.min(
        hero.maxHp,
        hero.hp + CONFIG.heroHpRegenPerSec * CONFIG.gameTickSec,
      );
    }
  }

  const base = world.base();
  if (base && !base.alive && world.status === 'playing') {
    world.status = 'lost';
    world.message = 'Your base was destroyed.';
  }

  world.removeDead();
}

/** True if both hero and enemy are still within camp leash (tiles). */
function withinCampLeash(hero: Hero, enemy: Enemy): boolean {
  const lim = CONFIG.enemyLeashDistance;
  return (
    dist(enemy.x, enemy.y, enemy.campX, enemy.campY) <= lim &&
    dist(hero.x, hero.y, enemy.campX, enemy.campY) <= lim
  );
}

function maintainCombatMovement(world: World, hero: Hero): void {
  if (!hero.combatEngaged || hero.fightQueue.length === 0) return;

  // Light refresh: drop dead from queue
  const prevFront = hero.combatTargetId;
  hero.fightQueue = hero.fightQueue.filter((id) => {
    const e = world.get(id);
    return e && e.alive && e.kind === 'enemy';
  });
  if (hero.fightQueue.length === 0) {
    promoteNext(world, hero);
    return;
  }
  if (hero.fightQueue[0] !== prevFront) {
    assignRoles(world, hero);
    layoutFight(world, hero);
  }

  const frontId = hero.fightQueue[0];
  if (frontId == null) return;
  const front = world.get(frontId);
  if (!front || front.kind !== 'enemy' || !front.alive) {
    promoteNext(world, hero);
    return;
  }
  hero.combatTargetId = frontId;

  // Broke camp leash (10 tiles) — drop combat; mobs return home via AI
  if (!withinCampLeash(hero, front)) {
    const savedMove = world.pendingMove;
    // Keep current flee path if any
    const fleeOrder = hero.order.type === 'move' ? hero.order : null;
    clearHeroCombat(world, hero);
    if (fleeOrder) hero.order = fleeOrder;
    world.pendingMove = savedMove;
    world.message = 'You escape the fight.';
    return;
  }

  const sx = hero.combatStandX;
  const sy = hero.combatStandY;
  const movingToStand =
    hero.order.type === 'move' &&
    sx != null &&
    sy != null &&
    hero.order.tx === Math.floor(sx) &&
    hero.order.ty === Math.floor(sy);

  // Free flee/kite: never rewrite hero movement while they're walking somewhere
  // other than the combat stand. Front chases via enemy AI; fight stays queued.
  if (hero.order.type === 'move' && !movingToStand) {
    hero.combatStandX = null;
    hero.combatStandY = null;
    return;
  }

  const inMelee = inMeleeRange(hero.x, hero.y, front.x, front.y);

  // After kiting (stand cleared): do not pull hero back across the map.
  // Only resume fighting when the leashed mob is actually in melee.
  if ((sx == null || sy == null) && !inMelee) {
    return;
  }

  // Melee contact while still leashed → resume combat in place
  if (inMelee) {
    hero.combatStandX = Math.floor(hero.x) + 0.5;
    hero.combatStandY = Math.floor(hero.y) + 0.5;
    hero.x = hero.combatStandX;
    hero.y = hero.combatStandY;
    if (hero.order.type === 'move') hero.order = { type: 'none' };
    if (hero.order.type !== 'attack' || hero.order.targetId !== front.id) {
      issueAttack(hero, front.id);
    }
    return;
  }

  // Initial engage / after promote: walk to stand beside the front (stand still set)
  const nsx = hero.combatStandX;
  const nsy = hero.combatStandY;
  if (nsx == null || nsy == null) return;

  const onStand =
    Math.floor(hero.x) === Math.floor(nsx) && Math.floor(hero.y) === Math.floor(nsy);
  if (!onStand) {
    if (
      hero.order.type !== 'move' ||
      hero.order.tx !== Math.floor(nsx) ||
      hero.order.ty !== Math.floor(nsy)
    ) {
      issueMove(world, hero, nsx, nsy);
    }
  } else {
    hero.x = nsx;
    hero.y = nsy;
    if (hero.order.type === 'move') hero.order = { type: 'none' };
    if (hero.order.type !== 'attack' || hero.order.targetId !== front.id) {
      issueAttack(hero, front.id);
    }
  }
}

function processCombatSwings(world: World): void {
  const hero = world.hero();
  if (!hero || !hero.alive || !hero.combatEngaged) return;
  if (hero.fightQueue.length === 0 || hero.combatTargetId == null) return;

  const front = world.get(hero.combatTargetId);
  if (!front || !front.alive || front.kind !== 'enemy' || front.leashing) {
    promoteNext(world, hero);
    return;
  }

  // Must be in melee for either side to swing
  const inMelee = inMeleeRange(hero.x, hero.y, front.x, front.y);
  if (!inMelee) {
    // Same-tile or diagonal stall — re-layout so someone takes an ortho stand
    const sameTile =
      Math.floor(hero.x) === Math.floor(front.x) && Math.floor(hero.y) === Math.floor(front.y);
    if (sameTile || hero.combatStandX == null) {
      layoutFight(world, hero);
    }
    return;
  }

  // Alternating turns: hero → enemy → hero → enemy
  if (hero.combatTurn === 'hero') {
    if (hero.attackTimer > 0) {
      hero.attackTimer -= 1;
      return;
    }
    processHeroAttackTick(world, hero, front);
    hero.combatTurn = 'enemy';
    // Front mob ready on next turn (no stacked delay)
    front.attackTimer = 0;
  } else {
    if (front.attackTimer > 0) {
      front.attackTimer -= 1;
      return;
    }
    processEnemyAttackTick(world, front, hero);
    hero.combatTurn = 'hero';
    hero.attackTimer = 0;
  }
}

/**
 * Resolve one hero weapon swing. Resets attackTimer to weapon speed (ticks).
 * XP: only when damage > 0 (misses and 0-damage rolls grant nothing).
 * One training step per successful hit to Attack + Strength (not scaled by damage).
 */
function processHeroAttackTick(world: World, hero: Hero, target: Enemy): void {
  hero.attackTimer = hero.attackTicks;
  hero.combatTimer = 0;

  const hit = rollHeroHit(world, hero, target);
  if (hit.damage <= 0) {
    world.spawnFloatText(target.x, target.y, '0', '#58a6ff');
    return;
  }
  target.hp -= hit.damage;
  world.spawnFloatText(target.x, target.y, `-${hit.damage}`, '#f85149');
  grantXp(world, hero, 'attack', XP_PER_HIT);
  grantXp(world, hero, 'strength', XP_PER_HIT);
}

function processEnemyAttackTick(world: World, enemy: Enemy, hero: Hero): void {
  if (enemy.fightRole !== 'front') return;
  enemy.attackTimer = enemy.attackTicks;
  hero.combatTimer = 0;

  const dmg = rollEnemyHit(world, hero, enemy);
  if (dmg <= 0) {
    world.spawnFloatText(hero.x, hero.y, '0', '#58a6ff');
    return;
  }
  hero.hp -= dmg;
  world.spawnFloatText(hero.x, hero.y, `-${dmg}`, '#ffa198');
  grantXp(world, hero, 'defense', XP_PER_HIT);

  if (hero.hp <= 0) {
    hero.hp = 0;
    hero.alive = false;
    clearHeroCombat(world, hero);
    world.message = 'You have been defeated.';
  }
}

function processDeaths(world: World): void {
  const hero = world.hero();
  let frontDied = false;
  let anyEnemyDied = false;

  for (const e of world.entities.values()) {
    if (e.kind === 'resourceNode' || e.kind === 'loot') continue;
    if (e.hp > 0 || !e.alive) continue;

    e.alive = false;
    e.hp = 0;

    if (e.kind === 'hero') {
      clearHeroCombat(world, e);
      world.message = 'You have been defeated.';
      continue;
    }

    if (e.kind === 'enemy') {
      spawnLootAt(world, e.x, e.y);
      if (hero && hero.alive) {
        grantKillXp(world, hero);
        if (hero.queuedTargetId === e.id) hero.queuedTargetId = null;
        const wasFront = hero.combatTargetId === e.id || hero.fightQueue[0] === e.id;
        const idx = hero.fightQueue.indexOf(e.id);
        if (idx >= 0) {
          hero.fightQueue.splice(idx, 1);
          anyEnemyDied = true;
          if (wasFront || idx === 0) frontDied = true;
        }
      }
    }
  }

  if (!hero || !hero.alive || !hero.combatEngaged) return;

  if (frontDied) {
    promoteNext(world, hero);
  } else if (anyEnemyDied) {
    assignRoles(world, hero);
    layoutFight(world, hero);
  }
}

function promoteNext(world: World, hero: Hero): void {
  if (!hero.combatEngaged) {
    clearHeroCombat(world, hero);
    return;
  }

  hero.fightQueue = hero.fightQueue.filter((id) => {
    const e = world.get(id);
    return e && e.alive && e.kind === 'enemy';
  });

  if (hero.fightQueue.length === 0) {
    if (hero.queuedTargetId != null) {
      const q = world.get(hero.queuedTargetId);
      hero.queuedTargetId = null;
      if (q && q.alive && q.kind === 'enemy') {
        beginFight(world, hero, q.id);
        return;
      }
    }
    clearHeroCombat(world, hero);
    return;
  }

  // Engage nearest remaining packmate first (less walk time between kills)
  hero.fightQueue.sort((a, b) => {
    const ea = world.get(a);
    const eb = world.get(b);
    if (!ea || !eb) return 0;
    return dist(hero.x, hero.y, ea.x, ea.y) - dist(hero.x, hero.y, eb.x, eb.y);
  });

  // Drop full weapon cooldown after a kill — swing again on the next game tick (~0.6s)
  // once in melee, instead of waiting the whole attackTicks (e.g. 4 × 0.6s).
  hero.combatTurn = 'hero';
  hero.attackTimer = 0;

  assignRoles(world, hero);
  const frontId = hero.combatTargetId;
  const front = frontId != null ? world.get(frontId) : null;

  // Already next to the new front: keep standing, no repath delay
  if (front && front.kind === 'enemy' && inMeleeRange(hero.x, hero.y, front.x, front.y)) {
    const hx = Math.floor(hero.x);
    const hy = Math.floor(hero.y);
    const fx = Math.floor(front.x);
    const fy = Math.floor(front.y);
    hero.x = hx + 0.5;
    hero.y = hy + 0.5;
    front.x = fx + 0.5;
    front.y = fy + 0.5;
    hero.combatStandX = hero.x;
    hero.combatStandY = hero.y;
    if (hero.order.type === 'move') hero.order = { type: 'none' };
    if (front.order.type === 'move') front.order = { type: 'none' };
    front.attackTimer = 0;
    issueAttack(hero, front.id);
    issueAttack(front, hero.id);
    // Still seat remaining waiters behind the new front
    layoutWaitingOnly(world, hero, front);
    return;
  }

  layoutFight(world, hero);
  if (front && front.kind === 'enemy') front.attackTimer = 0;
  // Preserve stand approach move; only force attack order when not walking
  if (hero.combatTargetId != null && hero.order.type !== 'move') {
    const f = world.get(hero.combatTargetId);
    if (f && f.kind === 'enemy' && inMeleeRange(hero.x, hero.y, f.x, f.y)) {
      issueAttack(hero, hero.combatTargetId);
    } else if (hero.combatStandX == null) {
      issueAttack(hero, hero.combatTargetId);
    }
  }
}

/** Re-seat waiters after a kill (same slot rules as layoutFight). */
function layoutWaitingOnly(world: World, hero: Hero, front: Enemy): void {
  const stand =
    hero.combatStandX != null && hero.combatStandY != null
      ? { x: Math.floor(hero.combatStandX), y: Math.floor(hero.combatStandY) }
      : null;
  placeWaiters(world, hero, front, stand);
}

function updateEnemyMovementAi(world: World, enemy: Enemy, hero: Hero | undefined): void {
  const fromCamp = dist(enemy.x, enemy.y, enemy.campX, enemy.campY);
  if ((enemy.aggressive || enemy.fightRole !== 'idle') && fromCamp > CONFIG.enemyLeashDistance) {
    if (hero) {
      const idx = hero.fightQueue.indexOf(enemy.id);
      if (idx >= 0) {
        hero.fightQueue.splice(idx, 1);
        if (hero.combatEngaged) {
          if (idx === 0) promoteNext(world, hero);
          else assignRoles(world, hero);
        }
      }
    }
    enemy.leashing = true;
    enemy.aggressive = false;
    enemy.fightRole = 'idle';
    enemy.queueIndex = -1;
    issueMove(world, enemy, enemy.campX, enemy.campY);
    return;
  }

  if (enemy.leashing) {
    const home = dist(enemy.x, enemy.y, enemy.campX, enemy.campY);
    if (home < 0.55) {
      enemy.leashing = false;
      enemy.x = enemy.campX;
      enemy.y = enemy.campY;
      enemy.order = { type: 'none' };
      enemy.hp = enemy.maxHp;
    } else if (enemy.order.type !== 'move') {
      issueMove(world, enemy, enemy.campX, enemy.campY);
    }
    return;
  }

  // Front: hold while hero approaches; chase if hero kites inside camp leash.
  // Outside leash → return-to-camp block above.

  if (enemy.fightRole === 'front' && hero && hero.combatEngaged) {
    if (!withinCampLeash(hero, enemy)) {
      return;
    }
    if (inMeleeRange(enemy.x, enemy.y, hero.x, hero.y)) {
      if (enemy.order.type === 'move') enemy.order = { type: 'none' };
      if (enemy.order.type !== 'attack' || enemy.order.targetId !== hero.id) {
        issueAttack(enemy, hero.id);
      }
    } else {
      const sx = hero.combatStandX;
      const sy = hero.combatStandY;
      const heroApproachingStand =
        hero.order.type === 'move' &&
        sx != null &&
        sy != null &&
        hero.order.tx === Math.floor(sx) &&
        hero.order.ty === Math.floor(sy);
      const heroKiting = hero.order.type === 'move' && !heroApproachingStand;

      if (heroKiting) {
        // Leash onto the player while they walk away (within 10 tiles of camp)
        if (enemy.order.type !== 'attack' || enemy.order.targetId !== hero.id) {
          issueAttack(enemy, hero.id);
        }
      } else {
        // Hero walking in or standing still — hold; hero resumes approach
        if (enemy.order.type === 'attack' || enemy.order.type === 'move') {
          enemy.order = { type: 'none' };
        }
      }
    }
  }

  if (enemy.fightRole === 'waiting') {
    // Lineup pathing OK; don't free-chase as a second attacker
    if (enemy.order.type === 'attack') enemy.order = { type: 'none' };
  }

  if (enemy.fightRole === 'idle' && enemy.aggressive && !hero?.combatEngaged) {
    // Was in a fight that ended — reset
    enemy.aggressive = false;
    enemy.order = { type: 'none' };
  }
}

/**
 * Probability a hit lands given attack roll A vs defence roll D.
 *
 *   if A > D:  1 − (D+2) / (2*(A+1))   // favored attacker
 *   else:      A / (2*(D+1))           // underdog still has a chance
 *
 * Separating accuracy from damage means Attack skill and Strength skill
 * matter differently (hit more often vs hit harder).
 */
function meleeHitChance(atkRoll: number, defRoll: number): number {
  const A = Math.max(0, atkRoll);
  const D = Math.max(0, defRoll);
  if (A > D) return 1 - (D + 2) / (2 * (A + 1));
  return A / (2 * (D + 1));
}

/**
 * One hero swing: accuracy check, then flat roll 0..maxHit inclusive.
 * Returning { damage: 0 } is a miss or a 0-damage roll (UI shows "0"; no skill XP).
 */
function rollHeroHit(world: World, hero: Hero, target: Enemy): { damage: number } {
  const maxHit = estimateMaxHit(hero.skills, world.inventory);
  const aRoll = attackRoll(hero.skills, world.inventory);
  // NPCs skip gear: (defenseLevel + 9) * 64 mimics bare defence gear factor.
  const dRoll = (target.defenseLevel + 9) * 64;
  const chance = meleeHitChance(aRoll, dRoll);
  if (Math.random() > chance) return { damage: 0 };
  // Uniform 0..maxHit after a successful accuracy roll (0 still possible on a "hit").
  const dmg = Math.floor(Math.random() * (maxHit + 1));
  return { damage: dmg };
}

/** Monster swing at the hero — same accuracy model, damage capped at enemy.damage. */
function rollEnemyHit(world: World, hero: Hero, enemy: Enemy): number {
  // Use enemy.damage as a stand-in for "attack level" on the monster side.
  const aRoll = (enemy.damage + 8) * 64;
  const dRoll = defenceRoll(hero.skills, world.inventory);
  const chance = meleeHitChance(aRoll, dRoll);
  if (Math.random() > chance) return 0;
  return Math.floor(Math.random() * (enemy.damage + 1));
}

/** Add skill XP, announce multi-level-ups, refresh hero max hit / HP if leveled. */
function grantXp(
  world: World,
  hero: Hero,
  skill: 'attack' | 'strength' | 'defense',
  amount: number,
): void {
  const events = addSkillXp(hero.skills, skill, amount);
  for (const ev of events) announceLevelUp(world, hero, ev);
  if (events.length > 0) applyHeroStats(hero, world.inventory);
}

/** Small kill bonus (separate from per-hit training). */
function grantKillXp(world: World, hero: Hero): void {
  grantXp(world, hero, 'attack', XP_PER_HIT);
  grantXp(world, hero, 'strength', XP_PER_HIT);
  grantXp(world, hero, 'defense', XP_PER_HIT);
}

function announceLevelUp(world: World, hero: Hero, ev: LevelUpEvent): void {
  world.spawnFloatText(hero.x, hero.y, `${skillLabel(ev.skill)} ${ev.level}!`, '#e3b341');
  world.message = `Congratulations! Your ${skillLabel(ev.skill)} level is now ${ev.level}.`;
}
