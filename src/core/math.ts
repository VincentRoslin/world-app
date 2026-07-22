import { CONFIG } from '../config';

export interface Vec2 {
  x: number;
  y: number;
}

/** Grid/world → screen (isometric diamond projection). */
export function isoProject(gx: number, gy: number, originX: number, originY: number): Vec2 {
  const { tileW, tileH } = CONFIG;
  return {
    x: (gx - gy) * (tileW / 2) + originX,
    y: (gx + gy) * (tileH / 2) + originY,
  };
}

/** Screen → continuous grid coords (inverse iso). */
export function isoUnproject(sx: number, sy: number, originX: number, originY: number): Vec2 {
  const { tileW, tileH } = CONFIG;
  const dx = sx - originX;
  const dy = sy - originY;
  const gx = dx / tileW + dy / tileH;
  const gy = dy / tileH - dx / tileW;
  return { x: gx, y: gy };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

export function tileCenter(gx: number, gy: number): Vec2 {
  return { x: gx + 0.5, y: gy + 0.5 };
}

export function floorTile(x: number, y: number): { gx: number; gy: number } {
  return { gx: Math.floor(x), gy: Math.floor(y) };
}
