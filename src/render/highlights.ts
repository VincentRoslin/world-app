/**
 * Central highlight policy for the game UI.
 *
 * Three layers (never mix meanings):
 *   A) Affordance (hover)  — quiet “you can interact”
 *   B) Selection           — stable “this is selected” (blue)
 *   C) Combat / intent     — red/gold rings only for fight state
 *
 * Visual rules:
 * - Ground footprint: buildings, resource nodes, loot only
 * - Units / NPCs: no body glow, no ground disc — cursor + action label
 * - No continuous pulse; short ease-in when hover target changes
 */

import type { Entity, EntityId } from '../core/types';
import type { World } from '../world/World';
import { isoProject } from '../core/math';
import { CONFIG } from '../config';
import { footprintOuterTips, type FootprintOuter } from './drawPrimitives';

/** Action-family colors — few, consistent. */
export const HL = {
  /** Selection (always the same). */
  select: '#58a6ff',
  /** Friendly / UI affordance (base, worker, hero, vendor, blacksmith). */
  friendly: '#9eb1c7',
  /** Hostile affordance (enemy under cursor). */
  hostile: '#f85149',
  /** Combat: current fight target. */
  combat: '#f85149',
  /** Combat: queued / pending. */
  combatPending: '#e3b341',
  /** Resources by material (only on nodes). */
  stone: '#c9d1d9',
  wood: '#56d364',
  food: '#e3b341',
  fish: '#79c0ff',
  loot: '#e3b341',
} as const;

export type FootprintKind = 'none' | 'tile' | '2x2';

export interface Affordance {
  /** Ground wash under buildings / nodes / loot. */
  footprint: FootprintKind;
  accent: string;
  /** Short action label drawn above the entity. */
  label: string;
}

/** What the player can do / what this thing is — drives hover label + accent. */
export function affordanceFor(e: Entity): Affordance | null {
  if (!e.alive && e.kind !== 'loot') return null;

  switch (e.kind) {
    case 'hero':
      return { footprint: 'none', accent: HL.friendly, label: 'Select' };
    case 'worker':
      return { footprint: 'none', accent: HL.friendly, label: 'Select' };
    case 'base':
      return { footprint: '2x2', accent: HL.friendly, label: 'Base' };
    case 'blacksmith':
      return {
        footprint: '2x2',
        accent: HL.friendly,
        label: e.completed ? 'Blacksmith' : 'Building…',
      };
    case 'npc':
      return {
        footprint: 'none',
        accent: HL.friendly,
        label: e.role === 'shop' ? 'Shop' : e.name,
      };
    case 'enemy':
      return { footprint: 'none', accent: HL.hostile, label: 'Attack' };
    case 'resourceNode': {
      if (e.resource === 'stone')
        return { footprint: 'tile', accent: HL.stone, label: 'Stone' };
      if (e.resource === 'wood')
        return { footprint: 'tile', accent: HL.wood, label: 'Wood' };
      if (e.resource === 'food')
        return { footprint: 'tile', accent: HL.food, label: 'Farm' };
      if (e.resource === 'fish') {
        const ready = e.remaining > 0 && e.replenishTimer <= 0;
        return {
          footprint: 'tile',
          accent: HL.fish,
          label: ready ? 'Fish' : 'Empty',
        };
      }
      return { footprint: 'tile', accent: HL.friendly, label: 'Resource' };
    }
    case 'loot':
      if (e.items.length === 0) return null;
      return { footprint: 'tile', accent: HL.loot, label: 'Loot' };
    default:
      return null;
  }
}

export function footprint2x2Centers(pos: { x: number; y: number }): { x: number; y: number }[] {
  return [
    { x: pos.x - 0.5, y: pos.y - 0.5 },
    { x: pos.x + 0.5, y: pos.y - 0.5 },
    { x: pos.x - 0.5, y: pos.y + 0.5 },
    { x: pos.x + 0.5, y: pos.y + 0.5 },
  ];
}

export function outerForEntity(
  e: Entity,
  pos: { x: number; y: number },
  ox: number,
  oy: number,
): FootprintOuter | null {
  if (e.kind !== 'base' && e.kind !== 'blacksmith') return null;
  const { tileW, tileH } = CONFIG;
  return footprintOuterTips(
    footprint2x2Centers(pos),
    (wx, wy) => isoProject(wx, wy, ox, oy),
    tileW,
    tileH,
  );
}

/** Ease 0→1 over `ms` after hover target changes (no looping pulse). */
export class HoverEase {
  private id: EntityId | null = null;
  private startedAt = 0;
  private readonly ms: number;

  constructor(ms = 160) {
    this.ms = ms;
  }

  /** Call each frame with current hover id; returns alpha scale for hover FX. */
  alpha(hoverId: EntityId | null): number {
    if (hoverId !== this.id) {
      this.id = hoverId;
      this.startedAt = performance.now();
    }
    if (hoverId == null) return 0;
    return Math.min(1, (performance.now() - this.startedAt) / this.ms);
  }
}

/**
 * Static ground footprint wash + stroke (affordance or selection).
 * `alpha` 0–1 from ease-in; selection should pass 1.
 */
export function drawGroundHighlight(
  ctx: CanvasRenderingContext2D,
  kind: FootprintKind,
  foot: { x: number; y: number },
  outer: FootprintOuter | null,
  accent: string,
  alpha: number,
  opts?: { fillOnly?: boolean; strokeWidth?: number },
): void {
  if (kind === 'none' || alpha <= 0.01) return;
  const { tileW, tileH } = CONFIG;
  const a = Math.max(0, Math.min(1, alpha));
  const sw = opts?.strokeWidth ?? 3.25;

  ctx.save();
  if (kind === '2x2' && outer) {
    ctx.beginPath();
    ctx.moveTo(outer.N.x, outer.N.y);
    ctx.lineTo(outer.E.x, outer.E.y);
    ctx.lineTo(outer.S.x, outer.S.y);
    ctx.lineTo(outer.W.x, outer.W.y);
    ctx.closePath();
    ctx.globalAlpha = 0.12 * a;
    ctx.fillStyle = accent;
    ctx.fill();
    if (!opts?.fillOnly) {
      ctx.globalAlpha = 0.75 * a;
      ctx.strokeStyle = accent;
      ctx.lineWidth = sw;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  } else if (kind === 'tile') {
    const w = tileW * 0.94;
    const h = tileH * 0.94;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y - h / 2);
    ctx.lineTo(foot.x + w / 2, foot.y);
    ctx.lineTo(foot.x, foot.y + h / 2);
    ctx.lineTo(foot.x - w / 2, foot.y);
    ctx.closePath();
    ctx.globalAlpha = 0.14 * a;
    ctx.fillStyle = accent;
    ctx.fill();
    if (!opts?.fillOnly) {
      ctx.globalAlpha = 0.8 * a;
      ctx.strokeStyle = accent;
      ctx.lineWidth = sw;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Unit selection: small stable ring under feet (not a hover glow). */
export function drawUnitSelectRing(
  ctx: CanvasRenderingContext2D,
  foot: { x: number; y: number },
): void {
  const { tileW, tileH } = CONFIG;
  const w = tileW * 0.7;
  const h = tileH * 0.7;
  ctx.save();
  ctx.strokeStyle = HL.select;
  ctx.lineWidth = 2.75;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y - h / 2);
  ctx.lineTo(foot.x + w / 2, foot.y);
  ctx.lineTo(foot.x, foot.y + h / 2);
  ctx.lineTo(foot.x - w / 2, foot.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Compact action chip above the entity (affordance layer).
 * Drawn after sprites so it stays readable.
 */
export function drawHoverLabel(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  text: string,
  accent: string,
  alpha: number,
): void {
  if (alpha <= 0.02 || !text) return;
  const a = Math.max(0, Math.min(1, alpha));
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = 8;
  const tw = ctx.measureText(text).width;
  const bw = tw + padX * 2;
  const bh = 18;
  const x = screenX;
  const y = screenY - 8;
  const left = x - bw / 2;
  const top = y - bh / 2;

  ctx.globalAlpha = 0.88 * a;
  ctx.fillStyle = 'rgba(13, 17, 23, 0.88)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  roundRect(ctx, left, top, bw, bh, 6);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = a;
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Label vertical offset above sprite (screen space, pre-zoom world units converted by caller). */
export function labelAnchorY(e: Entity, bodyY: number): number {
  if (e.kind === 'base' || e.kind === 'blacksmith') return bodyY - 52;
  if (e.kind === 'npc' || e.kind === 'hero') return bodyY - 36;
  if (e.kind === 'enemy') return bodyY - 32;
  if (e.kind === 'worker') return bodyY - 28;
  if (e.kind === 'resourceNode') return bodyY - 36;
  if (e.kind === 'loot') return bodyY - 18;
  return bodyY - 28;
}

/** Whether empty-ground white tile hover should draw (no entity under cursor). */
export function shouldShowTileHover(world: World): boolean {
  return world.hoverEntityId == null && world.buildingPlacement == null;
}
