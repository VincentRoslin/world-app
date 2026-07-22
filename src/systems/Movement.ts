import { CONFIG } from '../config';
import { DIRS4, findPath, nearestWalkableAdjacent } from '../core/grid';
import { dist, floorTile } from '../core/math';
import type { Entity, UnitOrder, Worker } from '../core/types';
import type { World } from '../world/World';

type Mover = Extract<Entity, { order: UnitOrder; speed: number }>;

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

function stepToward(world: World, unit: Mover, tx: number, ty: number, step: number): void {
  const d = dist(unit.x, unit.y, tx, ty);
  let nx = unit.x;
  let ny = unit.y;
  if (d <= step || d < 1e-6) {
    nx = tx;
    ny = ty;
  } else {
    nx = unit.x + ((tx - unit.x) / d) * step;
    ny = unit.y + ((ty - unit.y) / d) * step;
  }
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
  const path = findPath(walk(world), from.gx, from.gy, goalX, goalY);
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
 * Continuous movement every frame (smooth travel).
 * Speed matches OSRS run for the hero (~2 tiles / 0.6s tick).
 * Combat/intents still resolve on the game tick.
 */
export function updateMovement(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (!e.alive) continue;
    if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'enemy') continue;
    // Keep prev for light visual smoothing when not mid-lerp from ticks
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
  const strength = CONFIG.separationStrength * dt;

  for (let i = 0; i < units.length; i++) {
    const a = units[i]!;
    // A worker at a claimed gathering slot is an obstacle, not something that
    // can be displaced: moving it resets its work cycle.
    if (a.kind === 'worker' && a.phase === 'gathering') continue;
    let fx = 0;
    let fy = 0;
    for (let j = 0; j < units.length; j++) {
      if (i === j) continue;
      const b = units[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-8 || d2 > r2) continue;
      const d = Math.sqrt(d2);
      const push = ((r * 2 - d) / (r * 2)) * strength;
      fx += (dx / d) * push;
      fy += (dy / d) * push;
    }
    if (fx !== 0 || fy !== 0) {
      applyPosition(world, a, a.x + fx, a.y + fy);
    }
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
      unit.x = from.gx + 0.5;
      unit.y = from.gy + 0.5;
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
    // Repath only when start tile or goal tile changed (or path empty/blocked)
    const needRepath =
      !order.path ||
      order.path.length === 0 ||
      order.pathGoalX !== goalX ||
      order.pathGoalY !== goalY ||
      order.pathFromX !== from.gx ||
      order.pathFromY !== from.gy ||
      (order.path[0] != null && !w(order.path[0].x, order.path[0].y));
    if (needRepath) {
      order.path = findPath(w, from.gx, from.gy, goalX, goalY);
      order.pathGoalX = goalX;
      order.pathGoalY = goalY;
      order.pathFromX = from.gx;
      order.pathFromY = from.gy;
    }
    if (order.path && order.path.length > 0) {
      followPath(world, unit, order.path, dt, speed);
      // Update from key after step so we repath when tile changes
      const nf = floorTile(unit.x, unit.y);
      order.pathFromX = nf.gx;
      order.pathFromY = nf.gy;
    } else {
      stepToward(world, unit, goalX + 0.5, goalY + 0.5, speed * dt);
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

    const dSlot = dist(unit.x, unit.y, tx, ty);
    if (dSlot <= CONFIG.gatherReach) {
      applyPosition(world, unit, tx, ty);
      return;
    }

    const step = speed * dt;
    if (dSlot <= CONFIG.gatherApproach) {
      stepToward(world, unit, tx, ty, step);
      return;
    }

    const from = floorTile(unit.x, unit.y);
    const goalX = Math.floor(tx);
    const goalY = Math.floor(ty);
    const path = findPath(w, from.gx, from.gy, goalX, goalY);
    if (path.length > 0) {
      followPath(world, unit, path, dt, speed);
    } else {
      stepToward(world, unit, tx, ty, step);
    }
    return;
  }

  if (order.type === 'move') {
    if (order.path.length === 0) {
      const from = floorTile(unit.x, unit.y);
      if (from.gx === order.tx && from.gy === order.ty) {
        const cx = order.tx + 0.5;
        const cy = order.ty + 0.5;
        if (dist(unit.x, unit.y, cx, cy) > 0.08) {
          stepToward(world, unit, cx, cy, speed * dt);
        } else {
          unit.order = { type: 'none' };
        }
        return;
      }
      if (!world.isWalkable(order.tx, order.ty)) {
        unit.order = { type: 'none' };
        return;
      }
      const path = findPath(w, from.gx, from.gy, order.tx, order.ty);
      if (path.length > 0) {
        order.path = path;
      } else {
        const goalX = order.tx + 0.5;
        const goalY = order.ty + 0.5;
        if (dist(unit.x, unit.y, goalX, goalY) > 0.12) {
          stepToward(world, unit, goalX, goalY, speed * dt);
        } else {
          unit.order = { type: 'none' };
        }
        return;
      }
    } else {
      const next = order.path[0]!;
      if (!world.isWalkable(next.x, next.y)) {
        const from = floorTile(unit.x, unit.y);
        order.path = findPath(w, from.gx, from.gy, order.tx, order.ty);
      }
    }
    followPath(world, unit, order.path, dt, speed);
  }
}

function followPath(
  world: World,
  unit: Mover,
  path: { x: number; y: number }[],
  dt: number,
  speed: number,
): void {
  if (path.length === 0) return;

  while (path.length > 0 && !world.isWalkable(path[0]!.x, path[0]!.y)) {
    path.shift();
  }
  if (path.length === 0) return;

  const waypoint = path[0]!;
  const tx = waypoint.x + 0.5;
  const ty = waypoint.y + 0.5;
  const d = dist(unit.x, unit.y, tx, ty);
  const step = speed * dt;

  if (d < 0.22 && path.length > 1) {
    path.shift();
    return;
  }

  if (d <= step) {
    applyPosition(world, unit, tx, ty);
    path.shift();
  } else {
    const nx = unit.x + ((tx - unit.x) / d) * step;
    const ny = unit.y + ((ty - unit.y) / d) * step;
    applyPosition(world, unit, nx, ny);
  }
}
