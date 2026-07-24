/**
 * Retro low-poly hero draw — rigid limb groups + tick-synced stepped poses.
 *
 * No tweening: angles snap from pose tables. Each body part is a solid
 * polygon rotated about a single hard pivot (shoulder / hip / elbow).
 * Default outfit matches docs/refs/male_reference.png (green shirt, dark pants).
 */

import { CONFIG } from '../config';
import { getItemDef } from '../items/catalog';
import type { Inventory, ItemDef } from '../items/types';

function defOf(inv: Inventory, key: keyof Inventory['equipped']): ItemDef | null {
  const it = inv.equipped[key];
  if (!it) return null;
  return getItemDef(it.defId) ?? null;
}

function mix(hex: string, toward: string, t: number): string {
  const parse = (h: string) => {
    const s = h.replace('#', '');
    if (s.length !== 6) return [88, 166, 255] as const;
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ] as const;
  };
  const a = parse(hex);
  const b = parse(toward);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function shade(hex: string, amount: number): string {
  return mix(hex, amount >= 0 ? '#ffffff' : '#000000', Math.abs(amount));
}

/** Snapshot from the hero entity (tick-advanced only). */
export type HeroAnimState = {
  clip: 'idle' | 'walk' | 'attack';
  frame: number;
  facing: 1 | -1;
};

const DEFAULT_ANIM: HeroAnimState = { clip: 'idle', frame: 0, facing: 1 };

/**
 * Rigid pose: angles in radians, 0 = straight down, + = forward (facing dir).
 * Single hard angles — no partial blends.
 */
type LimbPose = {
  /** Left leg at hip */
  legL: number;
  /** Right leg at hip */
  legR: number;
  /** Left arm at shoulder */
  armL: number;
  /** Right arm at shoulder (weapon arm) */
  armR: number;
  /** Extra forearm bend on weapon arm */
  forearmR: number;
};

/** Idle — reference A-stance, weight slightly forward. */
const POSE_IDLE: LimbPose = {
  legL: -0.14,
  legR: 0.14,
  armL: 0.22,
  armR: -0.08,
  forearmR: 0.06,
};

/**
 * Walk — 4 hard keyframes (one per game tick). Mechanical plant / swing,
 * not a smooth cycle. Matches discrete tile walking feel.
 * 0 plant left  · 1 pass  · 2 plant right  · 3 pass
 */
const POSE_WALK: LimbPose[] = [
  { legL: -0.72, legR: 0.55, armL: 0.55, armR: -0.62, forearmR: 0.12 },
  { legL: -0.22, legR: 0.18, armL: 0.2, armR: -0.18, forearmR: 0.08 },
  { legL: 0.55, legR: -0.72, armL: -0.55, armR: 0.62, forearmR: 0.12 },
  { legL: 0.18, legR: -0.22, armL: -0.18, armR: 0.2, forearmR: 0.08 },
];

/**
 * Attack — 3 stepped keyframes over 3 ticks:
 * 0 ready (weapon up) · 1 contact (slash apex) · 2 recover
 */
const POSE_ATTACK: LimbPose[] = [
  { legL: -0.28, legR: 0.32, armL: 0.4, armR: -1.55, forearmR: -0.55 },
  { legL: -0.2, legR: 0.42, armL: 0.65, armR: 1.35, forearmR: 0.45 },
  { legL: -0.14, legR: 0.18, armL: 0.28, armR: 0.35, forearmR: 0.2 },
];

function resolvePose(anim: HeroAnimState): LimbPose {
  if (anim.clip === 'attack') {
    const i = Math.max(0, Math.min(POSE_ATTACK.length - 1, anim.frame));
    return POSE_ATTACK[i]!;
  }
  if (anim.clip === 'walk') {
    const i = Math.abs(anim.frame) % POSE_WALK.length;
    return POSE_WALK[i]!;
  }
  return POSE_IDLE;
}

/**
 * Draw humanoid male hero with slot-tinted armor.
 * (cx, cy) = ground foot anchor.
 */
export function drawHeroWithGear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  inv: Inventory,
  opts?: { tileW?: number; tileH?: number; anim?: HeroAnimState },
): void {
  const anim = opts?.anim ?? DEFAULT_ANIM;
  const pose = resolvePose(anim);
  const face = anim.facing;

  const head = defOf(inv, 'head');
  const chest = defOf(inv, 'chest');
  const shoulders = defOf(inv, 'shoulders');
  const cloak = defOf(inv, 'cloak');
  const legsDef = defOf(inv, 'legs');
  const feet = defOf(inv, 'feet');
  const main = defOf(inv, 'mainHand');
  const off = defOf(inv, 'offHand');
  const neck = defOf(inv, 'neck');
  const wrists = defOf(inv, 'wrist');
  const belt = defOf(inv, 'belt');

  // Reference defaults (male_reference.png): green shirt, dark pants, brown belt
  const skin = '#c9a07a';
  const skinDark = '#b08968';
  const hair = '#a89050';
  const shirt = '#3d9e5a';
  const pants = '#2c2c2e';
  const beltDef = '#8b3a2a';
  const bootDef = '#3a3a3c';

  const chestCol = chest?.iconColor ?? shirt;
  const chestDark = shade(chestCol, -0.22);
  const chestLite = shade(chestCol, 0.1);
  const legCol = legsDef?.iconColor ?? pants;
  const legDark = shade(legCol, -0.18);
  const bootCol = feet?.iconColor ?? bootDef;
  const shCol = shoulders?.iconColor ?? chestCol;
  const armCol = wrists?.iconColor ?? skin;
  const armShirt = chest ? shade(chestCol, -0.05) : shirt;
  const beltCol = belt?.iconColor ?? beltDef;

  // Body layout (screen px from foot)
  const hipY = cy - 11;
  const shoulderY = hipY - 12;
  const headCY = shoulderY - 7;

  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(face, 1);
  // Local +x = character right

  // ── Cloak (behind all) ─────────────────────────────────────
  if (cloak) {
    const cc = cloak.iconColor;
    flatPoly(ctx, [
      [-6, shoulderY + 1],
      [6, shoulderY + 1],
      [9, cy - 1],
      [0, cy + 2],
      [-9, cy - 1],
    ], cc, shade(cc, -0.35));
  }

  // ── Back leg (left) ────────────────────────────────────────
  drawRigidLeg(ctx, -3, hipY, pose.legL, legCol, legDark, bootCol, skinDark);

  // ── Back arm (left) ────────────────────────────────────────
  drawRigidArm(ctx, -6.5, shoulderY + 1, pose.armL, 0.08, armShirt, armCol, skin, false, null);

  // ── Torso vertex group (flat-shaded iso faces) ─────────────
  // Left face
  flatPoly(
    ctx,
    [
      [-7, shoulderY],
      [-6.5, hipY],
      [-1, hipY + 1],
      [-1.5, shoulderY + 1],
    ],
    chestDark,
  );
  // Front
  flatPoly(
    ctx,
    [
      [-6.5, shoulderY],
      [6.5, shoulderY],
      [6, hipY],
      [-6, hipY],
    ],
    chestCol,
  );
  // Right face
  flatPoly(
    ctx,
    [
      [6.5, shoulderY],
      [7.2, shoulderY + 1],
      [6.5, hipY],
      [6, hipY],
    ],
    chestLite,
  );

  // Belt (rigid strip)
  flatPoly(
    ctx,
    [
      [-6.2, hipY - 2],
      [6.2, hipY - 2],
      [6, hipY + 0.5],
      [-6, hipY + 0.5],
    ],
    beltCol,
    shade(beltCol, -0.3),
  );

  // ── Front leg (right) ──────────────────────────────────────
  drawRigidLeg(ctx, 3, hipY, pose.legR, legCol, legDark, bootCol, skinDark);

  // ── Shoulders ──────────────────────────────────────────────
  if (shoulders) {
    flatEllipse(ctx, -7, shoulderY + 1, 4.5, 3.2, shCol, shade(shCol, -0.35));
    flatEllipse(ctx, 7, shoulderY + 1, 4.5, 3.2, shCol, shade(shCol, -0.35));
  } else {
    // Short sleeves like reference
    flatEllipse(ctx, -7, shoulderY + 2, 3.2, 2.6, armShirt);
    flatEllipse(ctx, 7, shoulderY + 2, 3.2, 2.6, armShirt);
  }

  // ── Weapon arm (right / front) ─────────────────────────────
  const weapon =
    main != null
      ? {
          color: main.iconColor,
          kind:
            main.weaponType === 'axe' || main.icon === 'axe'
              ? ('axe' as const)
              : main.weaponType === 'dagger' || main.icon === 'dagger'
                ? ('dagger' as const)
                : ('sword' as const),
        }
      : null;
  drawRigidArm(
    ctx,
    6.5,
    shoulderY + 1,
    pose.armR,
    pose.forearmR,
    armShirt,
    armCol,
    skin,
    true,
    weapon,
  );

  // Off-hand at left hand
  if (off) {
    const hand = handPos(-6.5, shoulderY + 1, pose.armL, 0.08, 12);
    if (off.weaponType === 'shield' || off.icon === 'shield') {
      drawShield(ctx, hand.x - 1, hand.y, off.iconColor);
    } else if (off.weaponType === 'dagger' || off.icon === 'dagger') {
      drawDagger(ctx, hand.x, hand.y, off.iconColor, -1);
    }
  }

  // Amulet
  if (neck) {
    ctx.strokeStyle = '#c9d1d9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2.5, headCY + 5);
    ctx.lineTo(2.5, headCY + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, headCY + 7.5, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = neck.iconColor;
    ctx.fill();
  }

  // ── Head vertex group ──────────────────────────────────────
  // Neck
  flatPoly(ctx, [[-1.8, headCY + 3], [1.8, headCY + 3], [1.5, shoulderY], [-1.5, shoulderY]], skinDark);

  // Cranium (flat-shaded circle-ish poly)
  ctx.beginPath();
  ctx.ellipse(0, headCY, 5.4, 6.0, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  // Flat shadow face (no gradient)
  ctx.beginPath();
  ctx.ellipse(-1.5, headCY + 0.5, 3.2, 4.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = skinDark;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Hair (short male bowl) unless helm
  if (!head) {
    ctx.beginPath();
    ctx.ellipse(0, headCY - 2.4, 5.2, 3.8, 0, Math.PI, 0);
    ctx.fillStyle = hair;
    ctx.fill();
    flatPoly(ctx, [[-5, headCY - 1], [-3.5, headCY + 2.5], [-5.2, headCY + 2.5]], hair);
    flatPoly(ctx, [[5, headCY - 1], [3.5, headCY + 2.5], [5.2, headCY + 2.5]], hair);
  }

  // Eyes (dark diamonds — reference style)
  ctx.fillStyle = '#1a1410';
  flatPoly(ctx, [[-2.8, headCY - 0.2], [-1.2, headCY - 1], [-1.2, headCY + 1], [-2.8, headCY + 0.5]], '#1a1410');
  flatPoly(ctx, [[1.2, headCY - 1], [2.8, headCY - 0.2], [2.8, headCY + 0.5], [1.2, headCY + 1]], '#1a1410');

  // Nose wedge
  flatPoly(ctx, [[0, headCY], [1.2, headCY + 2.5], [-0.4, headCY + 2.2]], skinDark);

  if (head) {
    drawHelm(ctx, 0, headCY, head.iconColor);
  }

  ctx.restore();

  // Silence unused CONFIG read for tree-shaking / document link
  void CONFIG.charWalkFrames;
}

/** Solid polygon fill (+ optional edge) — flat per-face shading. */
function flatPoly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  fill: string,
  stroke?: string,
): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function flatEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

/**
 * Rigid leg: thigh + shin as solid capsules rotated about hip (then knee).
 * No stretch — hard affine rotation only.
 */
function drawRigidLeg(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  angle: number,
  legCol: string,
  legDark: string,
  bootCol: string,
  skinCol: string,
): void {
  const thighLen = 7.5;
  const shinLen = 7;
  const kneeX = hipX + Math.sin(angle) * thighLen;
  const kneeY = hipY + Math.cos(angle) * thighLen;
  const shinA = angle * 0.45; // fixed ratio, not blended over time
  const footX = kneeX + Math.sin(shinA) * shinLen;
  const footY = kneeY + Math.cos(shinA) * shinLen;

  // Thigh block
  drawBone(ctx, hipX, hipY, kneeX, kneeY, 4.4, legDark, legCol);
  // Shin block
  drawBone(ctx, kneeX, kneeY, footX, footY, 3.8, legDark, legCol);
  // Knee plate
  flatEllipse(ctx, kneeX, kneeY, 1.8, 1.8, shade(legCol, 0.08));
  // Boot block
  const bootFwd = Math.sin(shinA);
  flatPoly(
    ctx,
    [
      [footX - 2, footY - 1],
      [footX + 4.5 + bootFwd, footY],
      [footX + 4 + bootFwd, footY + 2.5],
      [footX - 2.5, footY + 2],
    ],
    bootCol,
    shade(bootCol, -0.35),
  );
  flatEllipse(ctx, footX, footY - 0.5, 1.3, 1.3, skinCol);
}

function handPos(
  sx: number,
  sy: number,
  upperA: number,
  foreExtra: number,
  totalLen: number,
): { x: number; y: number } {
  const upper = totalLen * 0.52;
  const lower = totalLen * 0.48;
  const elX = sx + Math.sin(upperA) * upper;
  const elY = sy + Math.cos(upperA) * upper;
  const foreA = upperA + foreExtra;
  return {
    x: elX + Math.sin(foreA) * lower,
    y: elY + Math.cos(foreA) * lower,
  };
}

function drawRigidArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  upperA: number,
  foreExtra: number,
  sleeveCol: string,
  armCol: string,
  skin: string,
  isWeapon: boolean,
  weapon: { color: string; kind: 'sword' | 'axe' | 'dagger' } | null,
): void {
  const upper = 6.8;
  const lower = 6.2;
  const elX = sx + Math.sin(upperA) * upper;
  const elY = sy + Math.cos(upperA) * upper;
  const foreA = upperA + foreExtra;
  const hx = elX + Math.sin(foreA) * lower;
  const hy = elY + Math.cos(foreA) * lower;

  // Upper arm (sleeve / skin)
  drawBone(ctx, sx, sy, elX, elY, 3.6, shade(sleeveCol, -0.15), sleeveCol);
  // Forearm
  drawBone(ctx, elX, elY, hx, hy, 3.2, shade(armCol, -0.15), armCol);
  // Elbow
  flatEllipse(ctx, elX, elY, 1.5, 1.5, shade(armCol, -0.05));
  // Fist
  flatEllipse(ctx, hx, hy, 2.0, 2.0, skin, shade(skin, -0.25));

  if (isWeapon && weapon) {
    if (weapon.kind === 'axe') drawAxe(ctx, hx, hy, weapon.color, upperA);
    else if (weapon.kind === 'dagger') drawDagger(ctx, hx, hy, weapon.color, 1);
    else drawSword(ctx, hx, hy, weapon.color, upperA);
  }
}

/** Rigid bone: thick line segment with two flat shade strokes. */
function drawBone(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  dark: string,
  light: string,
): void {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = dark;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.lineWidth = width * 0.62;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawSword(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  armAngle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  // Snap weapon angle with the arm — no extra smooth offset
  ctx.rotate(armAngle * 0.55 + 0.5);
  flatPoly(ctx, [[0, -15], [2, -12], [1.1, 3], [-1.1, 3]], '#e6edf3', '#8b949e');
  ctx.fillStyle = accent;
  ctx.fillRect(-3.8, 2.5, 7.6, 2);
  ctx.fillStyle = '#6e4b2a';
  ctx.fillRect(-1.0, 4.5, 2.0, 5);
  ctx.restore();
}

function drawAxe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  headColor: string,
  armAngle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(armAngle * 0.45 + 0.35);
  ctx.strokeStyle = '#6e4b2a';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(0, 8);
  ctx.stroke();
  flatPoly(ctx, [[0, -11], [11, -8], [11, -2], [0, -4]], headColor, '#0d1117');
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
  flatPoly(ctx, [[0, -9], [1.4, -7], [0.8, 2], [-0.8, 2]], '#e6edf3');
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
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawHelm(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - 1.5, 6.2, 5.2, 0, Math.PI, 0);
  ctx.lineTo(x + 6.2, y + 3.5);
  ctx.lineTo(x - 6.2, y + 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = shade(color, -0.15);
  ctx.fillRect(x - 1.1, y - 1, 2.2, 5);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(x - 4.6, y - 0.5, 2.8, 1.8);
  ctx.fillRect(x + 1.8, y - 0.5, 2.8, 1.8);
}
