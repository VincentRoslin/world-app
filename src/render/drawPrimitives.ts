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
 * Soft oval under standing units — grounds sprites on the tile (tactical feel).
 * Draw before the body so it sits “on” the floor.
 */
export function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx = 11,
  ry = 5,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Yellow destination flag/tile for the hero’s current move goal.
 * Readable pathing feedback without cluttering every step.
 */
export function drawDestinationMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileW: number,
  tileH: number,
): void {
  const w = tileW * 0.72;
  const h = tileH * 0.72;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#e3b341';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  ctx.stroke();
  // Small X in the middle
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  const s = 5;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s * 0.45);
  ctx.lineTo(cx + s, cy + s * 0.45);
  ctx.moveTo(cx + s, cy - s * 0.45);
  ctx.lineTo(cx - s, cy + s * 0.45);
  ctx.stroke();
  ctx.restore();
}

/**
 * Combat hitsplat box — damage number in a solid square (miss = blue).
 */
export function drawHitsplat(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  kind: 'hit' | 'miss',
  alpha: number,
): void {
  const bg = kind === 'miss' ? '#3d7ead' : '#c43c3c';
  const edge = kind === 'miss' ? '#79c0ff' : '#f85149';
  const size = 22;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = bg;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(sx - size / 2, sy - size / 2, size, size, 3);
  ctx.fill();
  ctx.stroke();
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, sx, sy + 0.5);
  ctx.restore();
}

/**
 * Soft “you can interact with this” ground ring for a single footprint.
 * Drawn under the entity — low alpha, gentle pulse, not a hard select look.
 */
export function drawHoverHighlight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  accent: string,
  pulse = 0.5,
): void {
  const aFill = 0.08 + pulse * 0.1;
  const aStroke = 0.4 + pulse * 0.28;
  ctx.save();
  ctx.globalAlpha = aFill;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = aStroke;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.globalAlpha = aStroke * 0.45;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.36);
  ctx.lineTo(cx + w * 0.36, cy);
  ctx.lineTo(cx, cy + h * 0.36);
  ctx.lineTo(cx - w * 0.36, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Outer iso contour of a multi-tile footprint (e.g. 2×2 base).
 * Computes N/E/S/W extremes from every tile diamond tip so the outline
 * is one continuous ring, not N separate tile highlights.
 */
export type FootprintOuter = {
  N: { x: number; y: number };
  E: { x: number; y: number };
  S: { x: number; y: number };
  W: { x: number; y: number };
};

export function footprintOuterTips(
  tileCenters: { x: number; y: number }[],
  project: (wx: number, wy: number) => { x: number; y: number },
  tileW: number,
  tileH: number,
): FootprintOuter {
  const tips: { x: number; y: number }[] = [];
  for (const c of tileCenters) {
    const p = project(c.x, c.y);
    tips.push({ x: p.x, y: p.y - tileH / 2 });
    tips.push({ x: p.x + tileW / 2, y: p.y });
    tips.push({ x: p.x, y: p.y + tileH / 2 });
    tips.push({ x: p.x - tileW / 2, y: p.y });
  }
  let N = tips[0]!;
  let E = tips[0]!;
  let S = tips[0]!;
  let W = tips[0]!;
  for (const t of tips) {
    if (t.y < N.y) N = t;
    if (t.x > E.x) E = t;
    if (t.y > S.y) S = t;
    if (t.x < W.x) W = t;
  }
  return { N, E, S, W };
}

/** Fill a multi-tile footprint as one solid iso diamond (building floor). */
export function drawFootprintFloor(
  ctx: CanvasRenderingContext2D,
  outer: ReturnType<typeof footprintOuterTips>,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.moveTo(outer.N.x, outer.N.y);
  ctx.lineTo(outer.E.x, outer.E.y);
  ctx.lineTo(outer.S.x, outer.S.y);
  ctx.lineTo(outer.W.x, outer.W.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
}

/**
 * One soft hover outline around a multi-tile footprint (single ring).
 */
export function drawFootprintHover(
  ctx: CanvasRenderingContext2D,
  outer: ReturnType<typeof footprintOuterTips>,
  accent: string,
  pulse = 0.5,
): void {
  const aFill = 0.1 + pulse * 0.1;
  const aStroke = 0.45 + pulse * 0.3;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(outer.N.x, outer.N.y);
  ctx.lineTo(outer.E.x, outer.E.y);
  ctx.lineTo(outer.S.x, outer.S.y);
  ctx.lineTo(outer.W.x, outer.W.y);
  ctx.closePath();
  ctx.globalAlpha = aFill;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = aStroke;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // Slight inset hairline
  ctx.globalAlpha = aStroke * 0.4;
  ctx.lineWidth = 1.5;
  const mid = {
    x: (outer.N.x + outer.S.x) * 0.5,
    y: (outer.N.y + outer.S.y) * 0.5,
  };
  const inset = (p: { x: number; y: number }, t: number) => ({
    x: mid.x + (p.x - mid.x) * t,
    y: mid.y + (p.y - mid.y) * t,
  });
  const n = inset(outer.N, 0.9);
  const e = inset(outer.E, 0.9);
  const s = inset(outer.S, 0.9);
  const w = inset(outer.W, 0.9);
  ctx.beginPath();
  ctx.moveTo(n.x, n.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(s.x, s.y);
  ctx.lineTo(w.x, w.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Outer silhouette of an iso prism (matches drawBlock geometry).
 */
export function pathIsoBlockSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  depth: number,
  height: number,
): void {
  const hw = w / 2;
  const hd = depth / 2;
  ctx.moveTo(cx, cy - hd - height);
  ctx.lineTo(cx + hw, cy - height);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx - hw, cy);
  ctx.lineTo(cx - hw, cy - height);
  ctx.closePath();
}

/**
 * Fill the compound character shape (body prism + head [+ optional pouch]).
 * Used as a backdrop under the sprite so the hover rim is continuous —
 * no separate circle/rectangle strokes fighting at the neck.
 */
function fillCharacterSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bodyW: number,
  bodyD: number,
  bodyH: number,
  headR: number,
  headY: number,
  pouch?: { x: number; y: number; rx: number; ry: number },
): void {
  ctx.beginPath();
  pathIsoBlockSilhouette(ctx, cx, cy, bodyW, bodyD, bodyH);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  if (pouch) {
    ctx.beginPath();
    ctx.ellipse(pouch.x, pouch.y, pouch.rx, pouch.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Classic “outline behind sprite” hover:
 * 1) paint a slightly larger filled silhouette in the accent color
 * 2) caller draws the real sprite on top, covering the interior
 *
 * Result: a clean rim around the whole figure without clashing neck lines
 * where the circle meets the iso block.
 *
 * Must be called *before* drawing the sprite.
 */
export function drawCharacterHoverBackdrop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bodyW: number,
  bodyD: number,
  bodyH: number,
  headR: number,
  headY: number,
  accent: string,
  pulse = 0.5,
  pouch?: { x: number; y: number; rx: number; ry: number },
): void {
  const a = 0.55 + pulse * 0.25;
  // Pivot near mid-torso so scale expands evenly around the figure
  const pivotY = (cy + headY) * 0.5;

  ctx.save();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.globalAlpha = a * 0.9;

  // Outer glow pad (a bit larger)
  ctx.translate(cx, pivotY);
  ctx.scale(1.18, 1.18);
  ctx.translate(-cx, -pivotY);
  fillCharacterSilhouette(ctx, cx, cy, bodyW, bodyD, bodyH, headR, headY, pouch);
  ctx.restore();

  // Solid rim layer (slightly tighter than glow)
  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = a;
  ctx.translate(cx, pivotY);
  ctx.scale(1.1, 1.1);
  ctx.translate(-cx, -pivotY);
  fillCharacterSilhouette(ctx, cx, cy, bodyW, bodyD, bodyH, headR, headY, pouch);
  ctx.restore();
}

/** Vendor-specific backdrop (matches Renderer npc dimensions). */
export function drawNpcHoverBackdrop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileW: number,
  tileH: number,
  accent: string,
  pulse = 0.5,
): void {
  drawCharacterHoverBackdrop(
    ctx,
    cx,
    cy,
    tileW * 0.32,
    tileH * 0.38,
    13,
    5.5,
    cy - 18,
    accent,
    pulse,
    { x: cx + 8, y: cy - 2, rx: 5, ry: 4 },
  );
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
