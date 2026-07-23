import { getItemDef } from '../items/catalog';
import type { Inventory, ItemDef } from '../items/types';

function defOf(inv: Inventory, key: keyof Inventory['equipped']): ItemDef | null {
  const it = inv.equipped[key];
  if (!it) return null;
  return getItemDef(it.defId) ?? null;
}

function mix(hex: string, toward: string, t: number): string {
  // Tiny hex lerp for canvas tints (expects #rrggbb)
  const parse = (h: string) => {
    const s = h.replace('#', '');
    if (s.length !== 6) return [88, 166, 255] as const;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] as const;
  };
  const a = parse(hex);
  const b = parse(toward);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/**
 * Draw the hero with equipped weapon/armor overlays.
 * (cx, cy) = ground anchor (foot), same as drawBlock.
 */
export function drawHeroWithGear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  inv: Inventory,
  opts?: { tileW?: number; tileH?: number },
): void {
  const tileW = opts?.tileW ?? 64;
  const tileH = opts?.tileH ?? 28;

  const head = defOf(inv, 'head');
  const chest = defOf(inv, 'chest');
  const shoulders = defOf(inv, 'shoulders');
  const cloak = defOf(inv, 'cloak');
  const legs = defOf(inv, 'legs');
  const feet = defOf(inv, 'feet');
  const main = defOf(inv, 'mainHand');
  const off = defOf(inv, 'offHand');
  const neck = defOf(inv, 'neck');

  const bodyTop = chest?.iconColor ?? '#58a6ff';
  const bodyLeft = mix(bodyTop, '#000000', 0.35);
  const bodyRight = mix(bodyTop, '#ffffff', 0.12);
  const legColor = legs?.iconColor ?? mix(bodyTop, '#1f6feb', 0.25);
  const bootColor = feet?.iconColor ?? '#3d444d';
  const skin = '#f0d5b0';

  // Cloak / cape behind the body
  if (cloak) {
    const cc = cloak.iconColor;
    ctx.fillStyle = cc;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 16);
    ctx.quadraticCurveTo(cx - 16, cy - 4, cx - 12, cy + 4);
    ctx.quadraticCurveTo(cx, cy + 8, cx + 12, cy + 4);
    ctx.quadraticCurveTo(cx + 16, cy - 4, cx + 10, cy - 16);
    ctx.quadraticCurveTo(cx, cy - 12, cx - 10, cy - 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mix(cc, '#000000', 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Legs / lower body
  ctx.fillStyle = legColor;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 6);
  ctx.lineTo(cx - 2, cy - 6);
  ctx.lineTo(cx - 3, cy + 2);
  ctx.lineTo(cx - 7, cy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy - 6);
  ctx.lineTo(cx + 6, cy - 6);
  ctx.lineTo(cx + 7, cy + 2);
  ctx.lineTo(cx + 3, cy + 2);
  ctx.closePath();
  ctx.fill();

  // Boots
  ctx.fillStyle = bootColor;
  ctx.fillRect(cx - 8, cy + 1, 6, 3.5);
  ctx.fillRect(cx + 2, cy + 1, 6, 3.5);

  // Torso (iso block, armor-tinted)
  drawMiniBlock(ctx, cx, cy - 2, tileW * 0.32, tileH * 0.36, 12, bodyTop, bodyLeft, bodyRight);

  // Shoulder pads
  if (shoulders) {
    const sc = shoulders.iconColor;
    ctx.fillStyle = sc;
    ctx.beginPath();
    ctx.ellipse(cx - 9, cy - 12, 4.5, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 9, cy - 12, 4.5, 3, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mix(sc, '#000000', 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Head
  ctx.beginPath();
  ctx.arc(cx, cy - 18, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.strokeStyle = '#00000033';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Amulet (small gem under chin)
  if (neck) {
    ctx.strokeStyle = '#c9d1d9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy - 14);
    ctx.quadraticCurveTo(cx, cy - 11, cx + 3, cy - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 10.5, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = neck.iconColor;
    ctx.fill();
  }

  // Helm over head
  if (head) {
    drawHelm(ctx, cx, cy - 18, head.iconColor);
  }

  // Off-hand (left of hero in screen space — drawn before weapon so sword can overlap)
  if (off) {
    if (off.weaponType === 'shield' || off.icon === 'shield') {
      drawShield(ctx, cx - 11, cy - 6, off.iconColor);
    } else if (off.weaponType === 'dagger' || off.icon === 'dagger') {
      drawDagger(ctx, cx - 10, cy - 4, off.iconColor, -1);
    }
  }

  // Main hand weapon (right side)
  if (main) {
    const wt = main.weaponType ?? 'sword';
    if (wt === 'axe' || main.icon === 'axe') {
      drawAxe(ctx, cx + 10, cy - 8, main.iconColor);
    } else if (wt === 'dagger' || main.icon === 'dagger') {
      drawDagger(ctx, cx + 9, cy - 5, main.iconColor, 1);
    } else {
      drawSword(ctx, cx + 10, cy - 8, main.iconColor);
    }
  } else {
    // Unarmed accent — small white chevron (legacy silhouette cue)
    ctx.fillStyle = '#ffffffaa';
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - 2);
    ctx.lineTo(cx + 7, cy + 3);
    ctx.lineTo(cx + 1, cy + 4);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMiniBlock(
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
  const hw = w / 2;
  const hd = depth / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hd - height);
  ctx.lineTo(cx + hw, cy - height);
  ctx.lineTo(cx, cy + hd - height);
  ctx.lineTo(cx - hw, cy - height);
  ctx.closePath();
  ctx.fillStyle = top;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - hw, cy - height);
  ctx.lineTo(cx, cy + hd - height);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fillStyle = left;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + hw, cy - height);
  ctx.lineTo(cx, cy + hd - height);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx + hw, cy);
  ctx.closePath();
  ctx.fillStyle = right;
  ctx.fill();
}

function drawSword(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.45);
  // blade
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(2.2, -12);
  ctx.lineTo(1.2, 4);
  ctx.lineTo(-1.2, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8b949e';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // guard
  ctx.fillStyle = accent;
  ctx.fillRect(-4, 3.5, 8, 2);
  // grip
  ctx.fillStyle = '#6e4b2a';
  ctx.fillRect(-1.1, 5.5, 2.2, 5);
  ctx.restore();
}

function drawAxe(ctx: CanvasRenderingContext2D, x: number, y: number, headColor: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);
  ctx.strokeStyle = '#6e4b2a';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(0, 8);
  ctx.stroke();
  ctx.fillStyle = headColor;
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.quadraticCurveTo(10, -10, 11, -3);
  ctx.quadraticCurveTo(8, -1, 0, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
}

function drawDagger(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  side: 1 | -1,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.5 * side);
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(1.4, -7);
  ctx.lineTo(0.8, 2);
  ctx.lineTo(-0.8, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(-2.5, 1.5, 5, 1.5);
  ctx.fillStyle = '#484f58';
  ctx.fillRect(-0.7, 3, 1.4, 4);
  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.bezierCurveTo(7, -5, 7, 2, 0, 8);
  ctx.bezierCurveTo(-7, 2, -7, -5, 0, -7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = mix(color, '#000000', 0.45);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = '#e6edf355';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(0, 4);
  ctx.moveTo(-3, 0);
  ctx.lineTo(3, 0);
  ctx.stroke();
  ctx.restore();
}

function drawHelm(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - 1, 6.5, 5.5, 0, Math.PI, 0);
  ctx.lineTo(x + 6.5, y + 3);
  ctx.lineTo(x - 6.5, y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = mix(color, '#000000', 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  // visor slit
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(x - 4.5, y - 1, 3.2, 2);
  ctx.fillRect(x + 1.3, y - 1, 3.2, 2);
}
