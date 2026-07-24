import { CONFIG, ENEMY_SPECIES } from '../config';
import { dist } from '../core/math';
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
import { startHeroAttackContact } from './CharacterAnim';

/**
 * Grid-based, tick-synced combat (CONFIG.gameTickSec ≈ 0.6s per tick).
 *
 * Each game tick (GameTick → onGameTickCombat):
 * 1. Combat lock countdown (logout block) + fight layout / leash AI.
 * 2. Aggressive NPCs pathfind to the player; weapon wind-ups only in melee.
 * 3. Accuracy / damage rolls; XP only on damage > 0.
 * 4. Group-hostile packs join only after the hero’s first swing.
 * 5. Leash: if an aggressive NPC is pulled > enemyLeashDistance tiles from spawn,
 *    it instantly loses target, ignores proximity, and walks to exact camp.
 *    Re-aggro only if the player attacks while retreating, or touch occurs
 *    still inside the leash radius (e.g. pathing blockage).
 *
 * Melee is orthogonal adjacency only (no diagonal) so positioning stays readable.
 */

function isGroupHostile(species: Enemy['species']): boolean {
  return ENEMY_SPECIES[species]?.groupHostile === true;
}

/** True when A and B share an edge (N/E/S/W). Diagonal does not count. */
function inMeleeRange(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(Math.floor(ax) - Math.floor(bx));
  const dy = Math.abs(Math.floor(ay) - Math.floor(by));
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

/** Same tile or any adjacent tile (incl. diagonal) — “touch” for leash re-aggro. */
function tilesTouch(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(Math.floor(ax) - Math.floor(bx));
  const dy = Math.abs(Math.floor(ay) - Math.floor(by));
  return Math.max(dx, dy) <= 1;
}

function distFromSpawn(enemy: Enemy): number {
  return dist(enemy.x, enemy.y, enemy.campX, enemy.campY);
}

function withinSpawnLeash(enemy: Enemy): boolean {
  return distFromSpawn(enemy) <= CONFIG.enemyLeashDistance;
}

/** Refresh 16-tick combat lock on real damage dealt or taken. */
function applyCombatLock(hero: Hero): void {
  hero.combatLockTicks = CONFIG.combatLockTicks;
  hero.combatTimer = 0;
}

/** True while combat lock ticks remain — logout must be blocked. */
export function isCombatLocked(hero: Hero): boolean {
  return hero.combatLockTicks > 0;
}

/** Session leave / load as logout surrogate while combat-locked. */
export function canLogout(world: World): boolean {
  const hero = world.hero();
  if (!hero || !hero.alive) return true;
  return hero.combatLockTicks <= 0;
}

export function setHeroCombatTarget(world: World, enemyId: EntityId, queueIfBusy: boolean): void {
  const hero = world.hero();
  const enemy = world.get(enemyId);
  if (!hero || !hero.alive || !enemy || enemy.kind !== 'enemy' || !enemy.alive) return;

  // Attacking a retreating NPC → immediate re-aggro, reset leash, resume attack cycle
  if (enemy.leashing) {
    reaggroFromLeash(world, hero, enemy, true);
    return;
  }

  hero.combatEngaged = true;

  const inQueue = hero.fightQueue.includes(enemyId);
  const fighting = hero.combatEngaged && hero.fightQueue.length > 0 && hero.combatTargetId != null;

  if (queueIfBusy && fighting && hero.combatTargetId !== enemyId) {
    if (inQueue) {
      promoteToFront(world, hero, enemyId);
      world.message = `Fighting ${speciesName(enemy)}.`;
      return;
    }
    // Manual click on a same-pack group-hostile — only after the fight has opened
    // (first swing). Before that, treat as “next target” queue.
    const front = hero.combatTargetId != null ? world.get(hero.combatTargetId) : null;
    if (
      hero.combatSwingLanded &&
      front &&
      front.kind === 'enemy' &&
      isGroupHostile(front.species) &&
      isGroupHostile(enemy.species) &&
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

/**
 * Cancel walk-home, re-enter combat, full weapon wind-up.
 * Used when the player hits a retreating NPC or touch re-aggro fires inside leash.
 */
function reaggroFromLeash(
  world: World,
  hero: Hero,
  enemy: Enemy,
  playerInitiated: boolean,
): void {
  enemy.leashing = false;
  enemy.aggressive = true;
  enemy.attackTimer = enemy.attackTicks;
  enemy.order = { type: 'none' };

  if (playerInitiated || !hero.combatEngaged || hero.fightQueue.length === 0) {
    beginFight(world, hero, enemy.id);
    world.message = playerInitiated
      ? `${speciesName(enemy)} re-engages!`
      : `${speciesName(enemy)} catches you — fight resumes!`;
    return;
  }

  if (!hero.fightQueue.includes(enemy.id)) {
    hero.fightQueue.unshift(enemy.id);
  } else {
    promoteToFront(world, hero, enemy.id);
  }
  assignRoles(world, hero);
  layoutFight(world, hero);
  world.message = `${speciesName(enemy)} re-engages!`;
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
  hero.combatSwingLanded = false;
  hero.combatInMelee = false;
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
  hero.combatSwingLanded = false;
  hero.combatInMelee = false;
  // Full weapon wind-up once melee starts (countdown pauses while walking in)
  hero.attackTimer = hero.attackTicks;
  primary.attackTimer = primary.attackTicks;

  // 1v1 at fight start — packmates join later only if group-hostile + first swing
  hero.fightQueue = [primaryId];

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
  const packHint =
    isGroupHostile(primary.species) && primary.packId !== 0
      ? ' (pack joins after first hit)'
      : '';
  world.message = `Fighting ${speciesName(primary)}.${packHint}`;
}

/**
 * After the hero’s first swing this fight: pull same-pack group-hostile allies
 * into the queue (goblins/humans). Cows never pull packmates.
 */
function pullGroupHostilesAfterFirstHit(world: World, hero: Hero, primary: Enemy): void {
  if (!isGroupHostile(primary.species)) return;
  if (primary.packId === 0) return;

  let added = 0;
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'enemy') continue;
    if (e.id === primary.id) continue;
    if (e.packId !== primary.packId) continue;
    if (!isGroupHostile(e.species)) continue;
    if (dist(e.x, e.y, primary.x, primary.y) > CONFIG.fightGroupRadius) continue;
    if (hero.fightQueue.includes(e.id)) continue;
    hero.fightQueue.push(e.id);
    added++;
  }
  if (added <= 0) return;

  assignRoles(world, hero);
  layoutFight(world, hero);
  world.message =
    added === 1
      ? `${speciesName(primary)} packmate joins the fight!`
      : `${added} packmates join the fight!`;
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
    return e && e.alive && e.kind === 'enemy' && !e.leashing;
  });

  for (let i = 0; i < hero.fightQueue.length; i++) {
    const e = world.get(hero.fightQueue[i]!);
    if (!e || e.kind !== 'enemy') continue;
    e.queueIndex = i;
    e.fightRole = i === 0 ? 'front' : 'waiting';
    e.aggressive = true;
    e.leashing = false;
    if (i === 0) {
      // Front: pathfind toward the player and attack (aggressive chase)
      if (e.order.type !== 'attack' || e.order.targetId !== hero.id) {
        issueAttack(e, hero.id);
      }
    } else {
      // Waiters: lineup pathing only; never free-chase as a second attacker
      if (e.order.type === 'attack') e.order = { type: 'none' };
    }
  }
  hero.combatTargetId = hero.fightQueue[0] ?? null;
}

/**
 * Seat waiters + ensure the front chases the player.
 *
 * Important: never path the *hero* back onto the mob. After the initial player
 * attack order, the mob closes the gap; swings only when adjacent.
 */
function layoutFight(world: World, hero: Hero): void {
  if (!hero.combatEngaged) return;
  const frontId = hero.fightQueue[0];
  if (frontId == null) return;
  const front = world.get(frontId);
  if (!front || front.kind !== 'enemy' || front.leashing) return;

  // Front always pathfinds to the hero (aggressive chase)
  if (front.order.type !== 'attack' || front.order.targetId !== hero.id) {
    issueAttack(front, hero.id);
  }

  // Waiter lineup relative to where the hero actually is (no forced hero walk)
  const stand = { x: Math.floor(hero.x), y: Math.floor(hero.y) };
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
    // Combat lock: 1 tick per game tick until 0 (logout unblocked)
    if (hero.combatLockTicks > 0) hero.combatLockTicks -= 1;
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
    // Regen only when combat lock is clear and grace has elapsed
    if (
      hero.combatLockTicks <= 0 &&
      hero.combatTimer >= CONFIG.heroCombatGrace &&
      hero.hp < hero.maxHp
    ) {
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

function maintainCombatMovement(world: World, hero: Hero): void {
  if (!hero.combatEngaged || hero.fightQueue.length === 0) return;

  // Drop dead / retreating mobs — leash return is owned by enemy AI
  const prevFront = hero.combatTargetId;
  hero.fightQueue = hero.fightQueue.filter((id) => {
    const e = world.get(id);
    return e && e.alive && e.kind === 'enemy' && !e.leashing;
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
  if (!front || front.kind !== 'enemy' || !front.alive || front.leashing) {
    promoteNext(world, hero);
    return;
  }
  hero.combatTargetId = frontId;

  // Ensure the front is always chasing the player while engaged
  if (front.order.type !== 'attack' || front.order.targetId !== hero.id) {
    issueAttack(front, hero.id);
  }

  // Player walk / kite: never rewrite the hero's path back to the mob
  if (hero.order.type === 'move') {
    hero.combatStandX = null;
    hero.combatStandY = null;
    return;
  }

  const inMelee = inMeleeRange(hero.x, hero.y, front.x, front.y);

  // Adjacent → plant and swing. Out of melee the mob closes; hero only walks in
  // if they still have a player-issued attack order (initial engage / re-click).
  if (inMelee) {
    hero.combatStandX = Math.floor(hero.x) + 0.5;
    hero.combatStandY = Math.floor(hero.y) + 0.5;
    hero.x = hero.combatStandX;
    hero.y = hero.combatStandY;
    if (hero.order.type !== 'attack' || hero.order.targetId !== front.id) {
      issueAttack(hero, front.id);
    }
    return;
  }

  // Not adjacent: do not path the hero to a stand tile.
  // Keep attack order if the player is still walking in; otherwise idle and wait.
  hero.combatStandX = null;
  hero.combatStandY = null;
  if (hero.order.type === 'attack' && hero.order.targetId === front.id) {
    return; // Movement follows attack → tile next to target
  }
  // Standing still / finished flee: stay put until the mob reaches ortho adjacency
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

  // Must be ortho-adjacent for either side to swing / wind up.
  // Do NOT layoutFight here — that used to path the hero back to the mob.
  const inMelee = inMeleeRange(hero.x, hero.y, front.x, front.y);
  if (!inMelee) {
    hero.combatInMelee = false;
    return;
  }

  // Entering melee: start a full weapon wind-up if not already counting
  if (!hero.combatInMelee) {
    hero.combatInMelee = true;
    if (hero.attackTimer <= 0) hero.attackTimer = hero.attackTicks;
    if (front.attackTimer <= 0) front.attackTimer = front.attackTicks;
  }

  // Both weapons tick down independently while in range (true N-tick weapon speed).
  // Old alternating logic zeroed the other side’s timer every swing → felt like 1–2 tick attacks.
  if (hero.attackTimer > 0) hero.attackTimer -= 1;
  if (front.attackTimer > 0) front.attackTimer -= 1;

  const heroReady = hero.attackTimer <= 0;
  const enemyReady = front.attackTimer <= 0;

  // Prefer hero opening when both ready the same tick
  if (heroReady && enemyReady) {
    if (hero.combatTurn === 'enemy') {
      processEnemyAttackTick(world, front, hero);
      if (!hero.alive || front.hp <= 0) return;
      processHeroAttackTick(world, hero, front);
    } else {
      processHeroAttackTick(world, hero, front);
      if (!hero.alive || front.hp <= 0) return;
      processEnemyAttackTick(world, front, hero);
    }
    return;
  }

  if (heroReady) {
    processHeroAttackTick(world, hero, front);
    return;
  }
  if (enemyReady && front.hp > 0) {
    processEnemyAttackTick(world, front, hero);
  }
}

/**
 * Resolve one hero weapon swing. Resets attackTimer to weapon speed (ticks).
 * XP: only when damage > 0 (misses and 0-damage rolls grant nothing).
 * One training step per successful hit to Attack + Strength (not scaled by damage).
 * First swing this fight pulls group-hostile packmates into the queue.
 */
function processHeroAttackTick(world: World, hero: Hero, target: Enemy): void {
  hero.attackTimer = hero.attackTicks;
  hero.combatTurn = 'enemy';
  // Contact keyframe (stepped attack clip) — holds until next game tick
  startHeroAttackContact(hero);

  const firstSwing = !hero.combatSwingLanded;
  hero.combatSwingLanded = true;

  const hit = rollHeroHit(world, hero, target);
  if (hit.damage <= 0) {
    world.spawnFloatText(target.x, target.y, '0', '#58a6ff', 'miss');
  } else {
    target.hp -= hit.damage;
    world.spawnFloatText(target.x, target.y, String(hit.damage), '#ffffff', 'hitsplat');
    applyCombatLock(hero); // dealing damage → 16-tick lock (refresh)
    grantXp(world, hero, 'attack', XP_PER_HIT);
    grantXp(world, hero, 'strength', XP_PER_HIT);
  }

  // Pack joins after the first completed swing (miss or hit) — not on click/walk-in
  if (firstSwing) {
    pullGroupHostilesAfterFirstHit(world, hero, target);
  }
}

function processEnemyAttackTick(world: World, enemy: Enemy, hero: Hero): void {
  if (enemy.fightRole !== 'front') return;
  enemy.attackTimer = enemy.attackTicks;
  hero.combatTurn = 'hero';

  const dmg = rollEnemyHit(world, hero, enemy);
  if (dmg <= 0) {
    world.spawnFloatText(hero.x, hero.y, '0', '#58a6ff', 'miss');
    return;
  }
  hero.hp -= dmg;
  world.spawnFloatText(hero.x, hero.y, String(dmg), '#ffffff', 'hitsplat');
  applyCombatLock(hero); // taking damage → 16-tick lock (refresh)
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

  // Keep full weapon wind-up between kills (heroAttackTicks / enemy attackTicks)
  hero.combatTurn = 'hero';
  hero.attackTimer = hero.attackTicks;
  hero.combatInMelee = false;

  assignRoles(world, hero);
  const frontId = hero.combatTargetId;
  const front = frontId != null ? world.get(frontId) : null;
  if (front && front.kind === 'enemy') {
    front.attackTimer = front.attackTicks;
  }

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
    hero.combatInMelee = true;
    if (hero.order.type === 'move') hero.order = { type: 'none' };
    if (front.order.type === 'move') front.order = { type: 'none' };
    issueAttack(hero, front.id);
    issueAttack(front, hero.id);
    // Still seat remaining waiters behind the new front
    layoutWaitingOnly(world, hero, front);
    return;
  }

  layoutFight(world, hero);
  // Only auto-engage the hero if already adjacent — otherwise the next front walks to us
  if (hero.combatTargetId != null && hero.order.type !== 'move') {
    const f = world.get(hero.combatTargetId);
    if (f && f.kind === 'enemy' && inMeleeRange(hero.x, hero.y, f.x, f.y)) {
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

/**
 * Per-enemy leash + chase AI (tick-synced decisions; continuous movement follows orders).
 *
 * States:
 * - leashing: walk exact spawn; ignore player proximity; touch inside leash → re-aggro
 * - aggressive / front: pathfind to player; if pulled past leash → instant leash return
 * - waiting: lineup only
 */
function updateEnemyMovementAi(world: World, enemy: Enemy, hero: Hero | undefined): void {
  // --- Retreating to spawn ---
  if (enemy.leashing) {
    // Pathing blockage / catch-up: touch player still inside spawn boundary → re-aggro
    if (
      hero &&
      hero.alive &&
      withinSpawnLeash(enemy) &&
      tilesTouch(enemy.x, enemy.y, hero.x, hero.y)
    ) {
      reaggroFromLeash(world, hero, enemy, false);
      return;
    }

    // Ignore player proximity otherwise — keep walking home
    const home = distFromSpawn(enemy);
    if (home < 0.4) {
      enemy.leashing = false;
      enemy.x = enemy.campX;
      enemy.y = enemy.campY;
      enemy.order = { type: 'none' };
      enemy.hp = enemy.maxHp;
      enemy.aggressive = false;
      enemy.fightRole = 'idle';
      enemy.queueIndex = -1;
    } else {
      const gx = Math.floor(enemy.campX);
      const gy = Math.floor(enemy.campY);
      if (
        enemy.order.type !== 'move' ||
        enemy.order.tx !== gx ||
        enemy.order.ty !== gy
      ) {
        issueMove(world, enemy, enemy.campX, enemy.campY);
      }
    }
    return;
  }

  // --- Leash break: pulled past spawn boundary ---
  const inFight = enemy.aggressive || enemy.fightRole !== 'idle';
  if (inFight && !withinSpawnLeash(enemy)) {
    beginLeashReturn(world, enemy, hero);
    return;
  }

  // --- Aggressive front: pathfind toward player and attack ---
  if (enemy.fightRole === 'front' && hero && hero.alive && hero.combatEngaged) {
    if (inMeleeRange(enemy.x, enemy.y, hero.x, hero.y)) {
      if (enemy.order.type === 'move') enemy.order = { type: 'none' };
      if (enemy.order.type !== 'attack' || enemy.order.targetId !== hero.id) {
        issueAttack(enemy, hero.id);
      }
    } else if (enemy.order.type !== 'attack' || enemy.order.targetId !== hero.id) {
      issueAttack(enemy, hero.id);
    }
    return;
  }

  if (enemy.fightRole === 'waiting') {
    if (enemy.order.type === 'attack') enemy.order = { type: 'none' };
    return;
  }

  if (enemy.aggressive && hero && hero.alive && hero.combatEngaged) {
    if (enemy.order.type !== 'attack' || enemy.order.targetId !== hero.id) {
      issueAttack(enemy, hero.id);
    }
    return;
  }

  if (enemy.fightRole === 'idle' && enemy.aggressive && !hero?.combatEngaged) {
    enemy.aggressive = false;
    enemy.order = { type: 'none' };
  }
}

/** Instantly drop target and walk back to exact spawn. */
function beginLeashReturn(world: World, enemy: Enemy, hero: Hero | undefined): void {
  let wasFront = false;
  let hadFight = false;

  if (hero) {
    hadFight = hero.combatEngaged;
    const idx = hero.fightQueue.indexOf(enemy.id);
    wasFront = idx === 0 || hero.combatTargetId === enemy.id;
    if (idx >= 0) {
      hero.fightQueue.splice(idx, 1);
    }
    if (hero.combatTargetId === enemy.id) {
      hero.combatTargetId = hero.fightQueue[0] ?? null;
    }
  }

  enemy.leashing = true;
  enemy.aggressive = false;
  enemy.fightRole = 'idle';
  enemy.queueIndex = -1;
  enemy.order = { type: 'none' };
  issueMove(world, enemy, enemy.campX, enemy.campY);

  if (hero && hadFight) {
    if (hero.fightQueue.length === 0) {
      const fleeOrder = hero.order.type === 'move' ? hero.order : null;
      clearHeroCombat(world, hero);
      if (fleeOrder) hero.order = fleeOrder;
      world.message = 'The enemy retreats to its spawn.';
    } else if (wasFront) {
      promoteNext(world, hero);
      world.message = `${speciesName(enemy)} breaks leash.`;
    } else {
      assignRoles(world, hero);
      world.message = `${speciesName(enemy)} breaks leash.`;
    }
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
