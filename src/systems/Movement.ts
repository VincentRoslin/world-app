import { CONFIG } from '../config';
import { DIRS4, findPath, nearestWalkableAdjacent } from '../core/grid';
import { dist, floorTile } from '../core/math';
import type { Entity, UnitOrder, Worker } from '../core/types';
import type { World } from '../world/World';

type Mover = Extract<Entity, { order: UnitOrder; speed: number }>;

/** How close to a tile center before we snap and take the next path cell. */
const TILE_ARRIVE = 0.06;

function walk(world: World) {
  return (gx: number, gy: number) => world.isWalkable(gx, gy);
}

function effectiveSpeed(unit: Mover): number {
  if (unit.kind === 'worker') {
    const w = unit as Worker;
    if (w.phase === 'toBase' && w.carried > 0) {
      return w.speed * CONFIG.workerCarrySpeedMult;
    }
  }
  return unit.speed;
}

/** Grid path: A* octile costs, prefer dirt roads, tile-center steps (no string-pull). */
function pathOnGrid(
  world: World,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): { x: number; y: number }[] {
  return findPath(walk(world), sx, sy, tx, ty, 6000, {
    smooth: false,
    cost: (x, y) => world.pathCost(x, y),
  });
}

function tileCenter(gx: number, gy: number): { x: number; y: number } {
  return { x: gx + 0.5, y: gy + 0.5 };
}

/**
 * Move toward a point, but only along the line to it (used for finishing a tile).
 * Prefer followPath for multi-tile routes.
 */
function stepToward(world: World, unit: Mover, tx: number, ty: number, step: number): void {
  const d = dist(unit.x, unit.y, tx, ty);
  if (d <= step || d < 1e-6) {
    applyPosition(world, unit, tx, ty);
    return;
  }
  const nx = unit.x + ((tx - unit.x) / d) * step;
  const ny = unit.y + ((ty - unit.y) / d) * step;
  applyPosition(world, unit, nx, ny);
}

function applyPosition(world: World, unit: Mover, nx: number, ny: number): void {
  const ox = unit.x;
  const oy = unit.y;

  if (world.isWalkable(Math.floor(nx), Math.floor(ny))) {
    unit.x = nx;
    unit.y = ny;
    return;
  }

  // Axis slide if diagonal step blocked
  if (world.isWalkable(Math.floor(nx), Math.floor(oy))) unit.x = nx;
  if (world.isWalkable(Math.floor(unit.x), Math.floor(ny))) unit.y = ny;

  if (!world.isWalkable(Math.floor(unit.x), Math.floor(unit.y))) {
    const c = world.clampEntityToWalkable(unit.x, unit.y);
    unit.x = c.x;
    unit.y = c.y;
  }

  if (
    !world.isWalkable(Math.floor(unit.x), Math.floor(unit.y)) &&
    world.isWalkable(Math.floor(ox), Math.floor(oy))
  ) {
    unit.x = ox;
    unit.y = oy;
  }
}

function setMoveOrder(world: World, unit: Mover, tx: number, ty: number): void {
  const from = floorTile(unit.x, unit.y);
  // Start every route from the current tile center so steps are pure center→center.
  const start = tileCenter(from.gx, from.gy);
  unit.x = start.x;
  unit.y = start.y;

  let goalX = tx;
  let goalY = ty;
  if (!world.isWalkable(tx, ty)) {
    const adj = nearestWalkableAdjacent(walk(world), tx, ty, from.gx, from.gy);
    goalX = adj.x;
    goalY = adj.y;
  }
  if (!world.isWalkable(goalX, goalY)) {
    unit.order = { type: 'none' };
    return;
  }
  if (from.gx === goalX && from.gy === goalY) {
    unit.order = { type: 'none' };
    return;
  }
  const path = pathOnGrid(world, from.gx, from.gy, goalX, goalY);
  unit.order = { type: 'move', tx: goalX, ty: goalY, path };
}

export function issueMove(world: World, unit: Mover, worldX: number, worldY: number): void {
  setMoveOrder(world, unit, Math.floor(worldX), Math.floor(worldY));
}

export function issueAttack(unit: Mover, targetId: number): void {
  unit.order = { type: 'attack', targetId, path: [] };
}

export function issueGather(unit: Mover, nodeId: number): void {
  unit.order = { type: 'gather', nodeId, path: [] };
}

/**
 * Tile-locked movement for hero, workers, and enemies.
 *
 * - A* / BFS builds a chain of tiles (8-dir, diagonal OK as one tile step).
 * - Units walk center → center; snap when arriving so they never drift off-grid.
 * - No path string-pull (that was the “fluid free glide” look).
 * - Separation is light and skipped while mid-path so it doesn’t shove units off tiles.
 */
export function updateMovement(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (!e.alive) continue;
    if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'enemy') continue;
    if (e.prevX === undefined) e.prevX = e.x;
    if (e.prevY === undefined) e.prevY = e.y;
    stepUnit(world, e, dt);
    if (!world.isWalkable(Math.floor(e.x), Math.floor(e.y))) {
      const c = world.clampEntityToWalkable(e.x, e.y);
      e.x = c.x;
      e.y = c.y;
    }
  }
  applySeparation(world, dt);
}

function heroMoveDir(hero: Extract<Entity, { kind: 'hero' }>): { x: number; y: number } {
  const o = hero.order;
  let tx = hero.x;
  let ty = hero.y;
  if (o.type === 'move') {
    if (o.path.length > 0) {
      tx = o.path[0]!.x + 0.5;
      ty = o.path[0]!.y + 0.5;
    } else {
      tx = o.tx + 0.5;
      ty = o.ty + 0.5;
    }
  } else if (o.type === 'attack' && o.path && o.path.length > 0) {
    tx = o.path[0]!.x + 0.5;
    ty = o.path[0]!.y + 0.5;
  } else {
    return { x: 0, y: 0 };
  }
  const dx = tx - hero.x;
  const dy = ty - hero.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-5) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

function isActivelyPathing(unit: Mover): boolean {
  const o = unit.order;
  if (o.type === 'move' && o.path.length > 0) return true;
  if (o.type === 'gather' && o.path && o.path.length > 0) return true;
  if (o.type === 'attack' && o.path && o.path.length > 0) return true;
  return false;
}

/**
 * Soft separation — skipped for units mid tile-path so they stay on rails.
 * Gathering / waiting / starving workers stay planted.
 */
function applySeparation(world: World, dt: number): void {
  const units: Mover[] = [];
  for (const e of world.entities.values()) {
    if (!e.alive) continue;
    if (e.kind === 'enemy' && e.fightRole !== 'idle') continue;
    if (e.kind === 'hero' && e.fightQueue.length > 0) continue;
    if (e.kind === 'hero' || e.kind === 'worker' || e.kind === 'enemy') units.push(e);
  }
  const r = CONFIG.unitRadius;
  const r2 = (r * 2) ** 2;
  const strength = CONFIG.separationStrength * dt * 0.55; // lighter — less drift off tiles
  const maxStep = CONFIG.separationMaxSpeed * dt * 0.55;
  const lateralBias = CONFIG.separationLateralBias;

  for (let i = 0; i < units.length; i++) {
    const a = units[i]!;
    if (a.kind === 'hero') continue;
    if (a.kind === 'worker' && a.phase === 'gathering') continue;
    if (
      a.kind === 'worker' &&
      (a.phase === 'waiting' || a.phase === 'starving' || a.phase === 'building')
    )
      continue;
    // Stay on tile path — don't shove pathing units sideways off-center
    if (isActivelyPathing(a)) continue;

    let fx = 0;
    let fy = 0;
    let fromHeroX = 0;
    let fromHeroY = 0;
    let heroVx = 0;
    let heroVy = 0;
    let pushedByHero = false;

    for (let j = 0; j < units.length; j++) {
      if (i === j) continue;
      const b = units[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-8 || d2 > r2) continue;
      const d = Math.sqrt(d2);
      const push = ((r * 2 - d) / (r * 2)) * strength;
      const px = (dx / d) * push;
      const py = (dy / d) * push;
      fx += px;
      fy += py;
      if (b.kind === 'hero') {
        pushedByHero = true;
        fromHeroX += px;
        fromHeroY += py;
        const dir = heroMoveDir(b);
        heroVx = dir.x;
        heroVy = dir.y;
      }
    }

    if (fx === 0 && fy === 0) continue;

    if (pushedByHero && a.kind === 'worker') {
      const hspd = Math.hypot(heroVx, heroVy);
      if (hspd > 1e-5) {
        const fxN = heroVx / hspd;
        const fyN = heroVy / hspd;
        let lx = -fyN;
        let ly = fxN;
        if (fromHeroX * lx + fromHeroY * ly < 0) {
          lx = -lx;
          ly = -ly;
        }
        const along = fromHeroX * fxN + fromHeroY * fyN;
        const back = Math.max(0, along) * (1 - lateralBias);
        const side = Math.hypot(fromHeroX, fromHeroY) * lateralBias + Math.abs(along) * lateralBias;
        fx = fx - fromHeroX + fxN * (-back * 0.35) + lx * side;
        fy = fy - fromHeroY + fyN * (-back * 0.35) + ly * side;
      }
    }

    const mag = Math.hypot(fx, fy);
    if (mag > maxStep && mag > 1e-8) {
      fx = (fx / mag) * maxStep;
      fy = (fy / mag) * maxStep;
    }

    applyPosition(world, a, a.x + fx, a.y + fy);
  }
}

function stepUnit(world: World, unit: Mover, dt: number): void {
  const order = unit.order;
  const w = walk(world);
  const speed = effectiveSpeed(unit);

  if (order.type === 'attack') {
    const target = world.get(order.targetId);
    if (!target || !target.alive) {
      unit.order = { type: 'none' };
      return;
    }
    const from = floorTile(unit.x, unit.y);
    const to = floorTile(target.x, target.y);
    const dx = Math.abs(from.gx - to.gx);
    const dy = Math.abs(from.gy - to.gy);
    const inMelee = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
    if (inMelee) {
      const c = tileCenter(from.gx, from.gy);
      unit.x = c.x;
      unit.y = c.y;
      order.path = [];
      return;
    }
    let goalX: number;
    let goalY: number;
    if (dx === 0 && dy === 0) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const d of DIRS4) {
        const x = to.gx + d.x;
        const y = to.gy + d.y;
        if (!w(x, y)) continue;
        const dMan = Math.abs(x - from.gx) + Math.abs(y - from.gy);
        if (dMan < bestD) {
          bestD = dMan;
          best = { x, y };
        }
      }
      if (!best) return;
      goalX = best.x;
      goalY = best.y;
    } else {
      let adj: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const d of DIRS4) {
        const x = to.gx + d.x;
        const y = to.gy + d.y;
        if (!w(x, y)) continue;
        const dMan = Math.abs(x - from.gx) + Math.abs(y - from.gy);
        if (dMan < bestD) {
          bestD = dMan;
          adj = { x, y };
        }
      }
      if (!adj) adj = nearestWalkableAdjacent(w, to.gx, to.gy, from.gx, from.gy);
      goalX = adj.x;
      goalY = adj.y;
    }
    const needRepath =
      !order.path ||
      order.path.length === 0 ||
      order.pathGoalX !== goalX ||
      order.pathGoalY !== goalY ||
      order.pathFromX !== from.gx ||
      order.pathFromY !== from.gy ||
      (order.path[0] != null && !w(order.path[0].x, order.path[0].y));
    if (needRepath) {
      order.path = pathOnGrid(world, from.gx, from.gy, goalX, goalY);
      order.pathGoalX = goalX;
      order.pathGoalY = goalY;
      order.pathFromX = from.gx;
      order.pathFromY = from.gy;
    }
    if (order.path && order.path.length > 0) {
      followPath(world, unit, order.path, dt, speed);
      const nf = floorTile(unit.x, unit.y);
      order.pathFromX = nf.gx;
      order.pathFromY = nf.gy;
    } else {
      const c = tileCenter(goalX, goalY);
      stepToward(world, unit, c.x, c.y, speed * dt);
    }
    return;
  }

  if (order.type === 'gather') {
    const node = world.get(order.nodeId);
    if (!node || !node.alive || node.kind !== 'resourceNode') {
      unit.order = { type: 'none' };
      return;
    }

    let tx = node.x + 1;
    let ty = node.y;
    if (unit.kind === 'worker') {
      const worker = unit as Worker;
      if (worker.slotIndex >= 0) {
        const slot = world.slotWorldPos(node, worker.slotIndex);
        tx = slot.x;
        ty = slot.y;
      } else {
        const stands = world.standPositions(node);
        if (stands[0]) {
          tx = stands[0].x;
          ty = stands[0].y;
        }
      }
    }

    if (!world.isWalkable(Math.floor(tx), Math.floor(ty))) {
      const adj = nearestWalkableAdjacent(
        w,
        Math.floor(node.x),
        Math.floor(node.y),
        Math.floor(unit.x),
        Math.floor(unit.y),
      );
      tx = adj.x + 0.5;
      ty = adj.y + 0.5;
    }

    const goalX = Math.floor(tx);
    const goalY = Math.floor(ty);
    const from = floorTile(unit.x, unit.y);

    // On the stand tile — snap to exact stand point (tile center / slot)
    if (from.gx === goalX && from.gy === goalY) {
      if (dist(unit.x, unit.y, tx, ty) <= CONFIG.gatherReach) {
        unit.x = tx;
        unit.y = ty;
        return;
      }
      stepToward(world, unit, tx, ty, speed * dt);
      return;
    }

    const needRepath =
      !order.path ||
      order.path.length === 0 ||
      order.pathGoalX !== goalX ||
      order.pathGoalY !== goalY ||
      order.pathFromX !== from.gx ||
      order.pathFromY !== from.gy ||
      (order.path[0] != null && !w(order.path[0].x, order.path[0].y));
    if (needRepath) {
      order.path = pathOnGrid(world, from.gx, from.gy, goalX, goalY);
      order.pathGoalX = goalX;
      order.pathGoalY = goalY;
      order.pathFromX = from.gx;
      order.pathFromY = from.gy;
    }
    if (order.path && order.path.length > 0) {
      followPath(world, unit, order.path, dt, speed);
      const nf = floorTile(unit.x, unit.y);
      order.pathFromX = nf.gx;
      order.pathFromY = nf.gy;
    } else {
      const c = tileCenter(goalX, goalY);
      stepToward(world, unit, c.x, c.y, speed * dt);
    }
    return;
  }

  if (order.type === 'move') {
    if (order.path.length === 0) {
      const from = floorTile(unit.x, unit.y);
      if (from.gx === order.tx && from.gy === order.ty) {
        const c = tileCenter(order.tx, order.ty);
        if (dist(unit.x, unit.y, c.x, c.y) > TILE_ARRIVE) {
          stepToward(world, unit, c.x, c.y, speed * dt);
        } else {
          unit.x = c.x;
          unit.y = c.y;
          unit.order = { type: 'none' };
        }
        return;
      }
      if (!world.isWalkable(order.tx, order.ty)) {
        unit.order = { type: 'none' };
        return;
      }
      const path = pathOnGrid(world, from.gx, from.gy, order.tx, order.ty);
      if (path.length > 0) {
        order.path = path;
      } else {
        const c = tileCenter(order.tx, order.ty);
        if (dist(unit.x, unit.y, c.x, c.y) > TILE_ARRIVE) {
          stepToward(world, unit, c.x, c.y, speed * dt);
        } else {
          unit.x = c.x;
          unit.y = c.y;
          unit.order = { type: 'none' };
        }
        return;
      }
    } else {
      const next = order.path[0]!;
      if (!world.isWalkable(next.x, next.y)) {
        const from = floorTile(unit.x, unit.y);
        order.path = pathOnGrid(world, from.gx, from.gy, order.tx, order.ty);
      }
    }
    followPath(world, unit, order.path, dt, speed);
  }
}

/**
 * Walk path tile-by-tile: always aim at the **center** of the next path cell.
 * Snap on arrive so the unit sits on the grid before the next step (incl. diagonals).
 * Leftover move budget carries into the next tile so speed stays honest without free gliding.
 */
function followPath(
  world: World,
  unit: Mover,
  path: { x: number; y: number }[],
  dt: number,
  speed: number,
): void {
  if (path.length === 0) return;

  let budget = speed * dt;
  // Cap how many tiles we can clear in one frame (avoids teleporting on lag spikes).
  let hops = 0;
  const maxHops = 4;

  while (path.length > 0 && budget > 0 && hops < maxHops) {
    while (path.length > 0 && !world.isWalkable(path[0]!.x, path[0]!.y)) {
      path.shift();
    }
    if (path.length === 0) return;

    const waypoint = path[0]!;
    const tx = waypoint.x + 0.5;
    const ty = waypoint.y + 0.5;
    const d = dist(unit.x, unit.y, tx, ty);

    if (d <= budget || d <= TILE_ARRIVE) {
      // Hard snap to tile center — locked to the grid (ortho or diagonal step).
      unit.x = tx;
      unit.y = ty;
      path.shift();
      budget = Math.max(0, budget - d);
      hops++;
      continue;
    }

    // Move only toward this tile’s center (no free cut toward a far goal).
    const nx = unit.x + ((tx - unit.x) / d) * budget;
    const ny = unit.y + ((ty - unit.y) / d) * budget;
    applyPosition(world, unit, nx, ny);
    return;
  }
}
