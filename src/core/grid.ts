import type { WalkFn } from './types';

export const DIRS4: readonly { x: number; y: number }[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const DIRS8: readonly { x: number; y: number }[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
];

function canStep(walkable: WalkFn, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (!walkable(nx, ny)) return false;
  // No corner-cutting through solids on diagonals
  if (dx !== 0 && dy !== 0) {
    if (!walkable(x + dx, y) || !walkable(x, y + dy)) return false;
  }
  return true;
}

/** Grid LOS: cells along Bresenham segment must be walkable; no diagonal corner cut. */
export function hasLineOfSight(
  walkable: WalkFn,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (!walkable(x, y)) return false;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    const stepX = e2 > -dy;
    const stepY = e2 < dx;
    if (stepX && stepY) {
      if (!walkable(x + sx, y) || !walkable(x, y + sy)) return false;
    }
    if (stepX) {
      err -= dy;
      x += sx;
    }
    if (stepY) {
      err += dx;
      y += sy;
    }
  }
  return true;
}

/** String-pull: drop intermediate waypoints when LOS is clear. */
export function smoothPath(
  walkable: WalkFn,
  path: { x: number; y: number }[],
  startX: number,
  startY: number,
): { x: number; y: number }[] {
  if (path.length <= 1) return path.slice();
  const pts = [{ x: startX, y: startY }, ...path];
  const out: { x: number; y: number }[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    for (let j = pts.length - 1; j > i + 1; j--) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (hasLineOfSight(walkable, a.x, a.y, b.x, b.y)) {
        best = j;
        break;
      }
    }
    out.push(pts[best]!);
    i = best;
  }
  return out;
}

/**
 * 8-direction BFS with corner rules + string-pull smooth.
 * Returns path excluding start, including goal.
 */
export function findPath(
  walkable: WalkFn,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxNodes = 4000,
): { x: number; y: number }[] {
  if (!walkable(sx, sy)) return [];
  if (sx === tx && sy === ty) return [];
  // If goal not walkable, path to nearest approach via adjacent search at end
  const goalWalkable = walkable(tx, ty);

  const startKey = `${sx},${sy}`;
  const goalKey = `${tx},${ty}`;
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
  let head = 0;
  const came = new Map<string, string | null>();
  came.set(startKey, null);

  let endKey: string | null = null;
  let visited = 0;

  while (head < queue.length && visited < maxNodes) {
    const cur = queue[head]!;
    head++;
    visited++;
    const key = `${cur.x},${cur.y}`;
    if (goalWalkable && key === goalKey) {
      endKey = key;
      break;
    }

    for (const d of DIRS8) {
      if (!canStep(walkable, cur.x, cur.y, d.x, d.y)) continue;
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      const nKey = `${nx},${ny}`;
      if (came.has(nKey)) continue;
      came.set(nKey, key);
      queue.push({ x: nx, y: ny });
    }
  }

  if (!endKey) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const k of came.keys()) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    endKey = best;
  }

  if (!endKey || endKey === startKey) return [];

  const path: { x: number; y: number }[] = [];
  let cur: string | null = endKey;
  while (cur && cur !== startKey) {
    const [x, y] = cur.split(',').map(Number) as [number, number];
    path.push({ x, y });
    cur = came.get(cur) ?? null;
  }
  path.reverse();
  return smoothPath(walkable, path, sx, sy);
}

/** Prefer orthogonal stand tiles. */
export function nearestWalkableAdjacent(
  walkable: WalkFn,
  nx: number,
  ny: number,
  fromX: number,
  fromY: number,
): { x: number; y: number } {
  const pick = (dirs: readonly { x: number; y: number }[]): { x: number; y: number } | null => {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const d of dirs) {
      const x = nx + d.x;
      const y = ny + d.y;
      if (!walkable(x, y)) continue;
      const dMan = Math.abs(x - fromX) + Math.abs(y - fromY);
      if (dMan < bestD) {
        bestD = dMan;
        best = { x, y };
      }
    }
    return best;
  };

  const ortho = pick(DIRS4);
  if (ortho) return ortho;

  const diag = pick(DIRS8);
  if (diag) return diag;

  let best = { x: fromX, y: fromY };
  let bestD = Infinity;
  for (let r = 2; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = nx + dx;
        const y = ny + dy;
        if (!walkable(x, y)) continue;
        const dMan = Math.abs(x - fromX) + Math.abs(y - fromY);
        if (dMan < bestD) {
          bestD = dMan;
          best = { x, y };
        }
      }
    }
    if (bestD < Infinity) break;
  }
  return best;
}
