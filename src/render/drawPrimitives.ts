import { CONFIG } from '../config';

export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Isometric block. (cx, cy) is the center of the ground diamond
 * (same anchor as tile diamonds), so models sit on the tile.
 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  depth: number,
  height: number,
  top: string,
  left: string,
  right: string,
): void {
  // Match tile diamond proportions when depth is close to tileH
  const hw = w / 2;
  const hd = depth / 2;

  // top diamond (raised by height)
  ctx.beginPath();
  ctx.moveTo(cx, cy - hd - height);
  ctx.lineTo(cx + hw, cy - height);
  ctx.lineTo(cx, cy + hd - height);
  ctx.lineTo(cx - hw, cy - height);
  ctx.closePath();
  ctx.fillStyle = top;
  ctx.fill();

  // left face
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy - height);
  ctx.lineTo(cx, cy + hd - height);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fillStyle = left;
  ctx.fill();

  // right face
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy - height);
  ctx.lineTo(cx, cy + hd - height);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx + hw, cy);
  ctx.closePath();
  ctx.fillStyle = right;
  ctx.fill();
}

export function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  value: number,
  max: number,
  fillColor: string,
  h = 4,
): void {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(x - w / 2, y, w, h);
  ctx.fillStyle = fillColor;
  ctx.fillRect(x - w / 2, y, w * ratio, h);
  ctx.strokeStyle = '#ffffff33';
  ctx.strokeRect(x - w / 2, y, w, h);
}

export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  hp: number,
  maxHp: number,
): void {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const fill = ratio > 0.4 ? '#3fb950' : ratio > 0.2 ? '#d29922' : '#f85149';
  drawBar(ctx, x, y, w, hp, maxHp, fill, 4);
}

export function tileSize(): { w: number; h: number } {
  return { w: CONFIG.tileW, h: CONFIG.tileH };
}
