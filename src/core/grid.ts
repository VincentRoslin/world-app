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

/** Step length: ortho = 1, diagonal = √2 (octile metric). */
function stepLen(dx: number, dy: number): number {
  return dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
}

/** Octile distance heuristic (consistent with 8-dir movement). */
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

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

export type PathCostFn = (x: number, y: number) => number;

/**
 * 8-direction A* (orthogonal + diagonal, no corner-cutting).
 * Returns path excluding start, including goal — **one entry per tile**.
 *
 * - Uses octile costs so diagonals are preferred when they actually shorten travel.
 * - Optional per-tile cost multiplier (e.g. prefer dirt paths over rough ground).
 * - Default does not string-pull (tile-center → tile-center movement).
 */
export function findPath(
  walkable: WalkFn,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxNodes = 4000,
  opts?: { smooth?: boolean; cost?: PathCostFn },
): { x: number; y: number }[] {
  if (!walkable(sx, sy)) return [];
  if (sx === tx && sy === ty) return [];

  const goalWalkable = walkable(tx, ty);
  const costAt = opts?.cost ?? (() => 1);

  const startKey = `${sx},${sy}`;
  const goalKey = `${tx},${ty}`;

  // gScore / fScore
  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  // Simple binary min-heap on f
  const openX: number[] = [sx];
  const openY: number[] = [sy];
  const openF: number[] = [octile(sx, sy, tx, ty)];
  const inOpen = new Set<string>([startKey]);
  const came = new Map<string, string | null>();
  came.set(startKey, null);
  const closed = new Set<string>();

  const heapPush = (x: number, y: number, f: number) => {
    openX.push(x);
    openY.push(y);
    openF.push(f);
    let i = openF.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (openF[p]! <= openF[i]!) break;
      const tf = openF[p]!;
      openF[p] = openF[i]!;
      openF[i] = tf;
      const tx0 = openX[p]!;
      openX[p] = openX[i]!;
      openX[i] = tx0;
      const ty0 = openY[p]!;
      openY[p] = openY[i]!;
      openY[i] = ty0;
      i = p;
    }
  };

  const heapPop = (): { x: number; y: number } | null => {
    const n = openF.length;
    if (n === 0) return null;
    const x = openX[0]!;
    const y = openY[0]!;
    const lx = openX.pop()!;
    const ly = openY.pop()!;
    const lf = openF.pop()!;
    if (openF.length > 0) {
      openX[0] = lx;
      openY[0] = ly;
      openF[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < openF.length && openF[l]! < openF[smallest]!) smallest = l;
        if (r < openF.length && openF[r]! < openF[smallest]!) smallest = r;
        if (smallest === i) break;
        const tf = openF[i]!;
        openF[i] = openF[smallest]!;
        openF[smallest] = tf;
        const tx0 = openX[i]!;
        openX[i] = openX[smallest]!;
        openX[smallest] = tx0;
        const ty0 = openY[i]!;
        openY[i] = openY[smallest]!;
        openY[smallest] = ty0;
        i = smallest;
      }
    }
    return { x, y };
  };

  let endKey: string | null = null;
  let visited = 0;

  while (openF.length > 0 && visited < maxNodes) {
    const cur = heapPop()!;
    const key = `${cur.x},${cur.y}`;
    if (closed.has(key)) continue;
    closed.add(key);
    inOpen.delete(key);
    visited++;

    if (goalWalkable && key === goalKey) {
      endKey = key;
      break;
    }

    const gCur = gScore.get(key) ?? Infinity;

    for (const d of DIRS8) {
      if (!canStep(walkable, cur.x, cur.y, d.x, d.y)) continue;
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      const nKey = `${nx},${ny}`;
      if (closed.has(nKey)) continue;

      const terrain = costAt(nx, ny);
      if (!(terrain > 0) || !Number.isFinite(terrain)) continue;

      const stepCost = stepLen(d.x, d.y) * terrain;
      const tentative = gCur + stepCost;
      const prevG = gScore.get(nKey);
      if (prevG !== undefined && tentative >= prevG) continue;

      came.set(nKey, key);
      gScore.set(nKey, tentative);
      const f = tentative + octile(nx, ny, tx, ty);
      heapPush(nx, ny, f);
      inOpen.add(nKey);
    }
  }

  // If goal blocked / unreachable, approach nearest explored cell to goal
  if (!endKey) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const k of came.keys()) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      const d = octile(x, y, tx, ty);
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
  if (opts?.smooth) return smoothPath(walkable, path, sx, sy);
  return path;
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
