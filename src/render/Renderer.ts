import { CONFIG, ENEMY_SPECIES } from '../config';
import { isoProject } from '../core/math';
import type { BaseBuilding, Entity } from '../core/types';
import type { World } from '../world/World';
import {
  drawBar,
  drawBlock,
  drawDiamond,
  drawFootprintFloor,
  drawHpBar,
} from './drawPrimitives';
import { drawHeroWithGear } from './drawGear';
import {
  HL,
  HoverEase,
  affordanceFor,
  drawGroundHighlight,
  drawHoverLabel,
  drawUnitSelectRing,
  labelAnchorY,
  outerForEntity,
  shouldShowTileHover,
} from './highlights';

/**
 * Canvas 2D isometric renderer.
 *
 * Highlights (see highlights.ts):
 *   A) Affordance hover — footprint for buildings/nodes, action label for all
 *   B) Selection — stable blue ring
 *   C) Combat — red/gold rings only (drawn before entities)
 */
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cameraX = 0;
  cameraY = 0;
  zoom: number = CONFIG.defaultZoom;
  /** 0–1 progress through the current game tick (for position lerp). */
  tickAlpha = 0;
  /** Hover ease-in (no looping pulse). */
  private hoverEase = new HoverEase(160);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
  }

  /** Interpolated draw position between last tick and current sim pos. */
  private drawPos(e: Entity): { x: number; y: number } {
    const a = this.tickAlpha;
    const px = e.prevX ?? e.x;
    const py = e.prevY ?? e.y;
    return {
      x: px + (e.x - px) * a,
      y: py + (e.y - py) * a,
    };
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  centerOn(gx: number, gy: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const p = isoProject(gx, gy, 0, 0);
    // screen = project * zoom + camera  →  camera = screenCenter - project * zoom
    this.cameraX = w / 2 - p.x * this.zoom;
    this.cameraY = h / 2 - p.y * this.zoom;
  }

  origin(): { x: number; y: number } {
    return { x: this.cameraX / this.zoom, y: this.cameraY / this.zoom };
  }

  /**
   * Canvas CSS pixel → world (tile) coords.
   * Inverse of: screen = isoProject(world, 0, 0) * zoom + camera
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const { tileW, tileH } = CONFIG;
    const dx = (sx - this.cameraX) / this.zoom;
    const dy = (sy - this.cameraY) / this.zoom;
    const gx = dx / tileW + dy / tileH;
    const gy = dy / tileH - dx / tileW;
    return { x: gx, y: gy };
  }

  /** World → canvas CSS pixels (matches render transform). */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const p = isoProject(wx, wy, 0, 0);
    return {
      x: p.x * this.zoom + this.cameraX,
      y: p.y * this.zoom + this.cameraY,
    };
  }

  /** Zoom while keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, newZoom: number): void {
    const world = this.screenToWorld(sx, sy);
    const z = Math.min(2.2, Math.max(0.45, newZoom));
    const p = isoProject(world.x, world.y, 0, 0);
    this.zoom = z;
    this.cameraX = sx - p.x * z;
    this.cameraY = sy - p.y * z;
  }

  render(world: World): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0d1b2a');
    grad.addColorStop(1, '#1b263b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);

    const o = this.origin();
    const { tileW, tileH } = CONFIG;

    // Only draw roughly on-screen tiles among loaded+explored
    const corners = [
      this.screenToWorld(0, 0),
      this.screenToWorld(w, 0),
      this.screenToWorld(0, h),
      this.screenToWorld(w, h),
    ];
    const minX = Math.floor(Math.min(...corners.map((c) => c.x))) - 2;
    const maxX = Math.ceil(Math.max(...corners.map((c) => c.x))) + 2;
    const minY = Math.floor(Math.min(...corners.map((c) => c.y))) - 2;
    const maxY = Math.ceil(Math.max(...corners.map((c) => c.y))) + 2;

    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const tile = world.tileAt(gx, gy);
        if (!tile) continue;
        const explored = world.isExplored(gx, gy);
        const c = isoProject(gx + 0.5, gy + 0.5, o.x, o.y);

        if (!explored) {
          drawDiamond(ctx, c.x, c.y, tileW, tileH, '#0a0e14', '#12161c');
          continue;
        }

        // Uniform terrain colors make large regions read as a cohesive biome.
        let fill = '#347a5c';
        if (tile.terrain === 'dirt') fill = '#66503b';
        if (tile.terrain === 'water') fill = '#1a4a7a';
        let stroke = '#ffffff0c';
        if (tile.blocked && tile.terrain !== 'water') {
          fill = '#3a3f52';
          stroke = '#00000055';
        }

        drawDiamond(ctx, c.x, c.y, tileW, tileH, fill, stroke);

        // A small highlight makes connected water read as a stream rather than
        // as dark, disconnected terrain squares.
        if (tile.terrain === 'water') {
          const ripple = (gx * 13 + gy * 7) % 3;
          ctx.strokeStyle = ripple === 0 ? '#79c0ff55' : '#58a6ff38';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(c.x - tileW * 0.16, c.y - tileH * 0.05);
          ctx.lineTo(c.x + tileW * 0.12, c.y + tileH * 0.02);
          ctx.stroke();
        } else if (tile.terrain === 'grass' && !tile.blocked && (gx * 17 + gy * 31) % 11 === 0) {
          // Sparse tufts break up large grass fields without adding new terrain colors.
          ctx.strokeStyle = '#56a56d88';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y + 3);
          ctx.lineTo(c.x - 2, c.y - 3);
          ctx.moveTo(c.x + 1, c.y + 3);
          ctx.lineTo(c.x + 4, c.y - 2);
          ctx.stroke();
        }

        if (tile.decoration && !tile.blocked) {
          this.drawDecoration(tile.decoration, c.x, c.y, tileW, tileH);
        }

        // Empty-ground tile hover only (entities use affordance layer instead)
        if (
          shouldShowTileHover(world) &&
          world.hoverTile &&
          world.hoverTile.gx === gx &&
          world.hoverTile.gy === gy
        ) {
          drawDiamond(ctx, c.x, c.y, tileW, tileH, '#ffffff14', '#ffffff66');
        }
      }
    }

    if (world.buildingPlacement && world.hoverTile) {
      const { gx, gy } = world.hoverTile;
      const valid = world.canPlaceBlacksmith(gx, gy);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const c = isoProject(gx + dx + 0.5, gy + dy + 0.5, o.x, o.y);
        drawDiamond(ctx, c.x, c.y, tileW, tileH, valid ? '#3fb95055' : '#f8514955', valid ? '#3fb950' : '#f85149');
      }
    }

    const list = [...world.entities.values()].filter((e) => {
      if (e.kind === 'loot') return e.items.length > 0;
      if (!e.alive) return false;
      if (e.kind === 'hero' || e.kind === 'worker' || e.kind === 'base' || e.kind === 'npc') return true;
      return world.isExplored(Math.floor(e.x), Math.floor(e.y));
    });
    list.sort((a, b) => {
      const pa = this.drawPos(a);
      const pb = this.drawPos(b);
      return pa.x + pa.y - (pb.x + pb.y);
    });

    // Layer C — combat / intent rings (never used for shop/base hover)
    const hero = world.hero();
    if (hero?.combatTargetId != null) {
      const t = world.get(hero.combatTargetId);
      if (t && t.alive) {
        const dp = this.drawPos(t);
        const tp = isoProject(dp.x, dp.y, o.x, o.y);
        drawDiamond(ctx, tp.x, tp.y, tileW * 0.85, tileH * 0.85, '#ffffff00', HL.combat);
      }
    }
    if (hero?.queuedTargetId != null) {
      const t = world.get(hero.queuedTargetId);
      if (t && t.alive) {
        const dp = this.drawPos(t);
        const tp = isoProject(dp.x, dp.y, o.x, o.y);
        drawDiamond(ctx, tp.x, tp.y, tileW * 0.75, tileH * 0.75, '#ffffff00', HL.combatPending);
      }
    }
    if (world.pendingAttackId != null) {
      const t = world.get(world.pendingAttackId);
      if (t && t.alive) {
        const dp = this.drawPos(t);
        const tp = isoProject(dp.x, dp.y, o.x, o.y);
        drawDiamond(ctx, tp.x, tp.y, tileW * 0.9, tileH * 0.9, '#ffffff00', HL.combatPending);
      }
    }

    const hoverAlpha = this.hoverEase.alpha(world.hoverEntityId);

    for (const e of list) {
      this.drawEntity(world, e, o.x, o.y, hoverAlpha);
    }

    // Affordance labels on top of everything (readable over sprites)
    this.drawHoverAffordanceLabel(world, o.x, o.y, hoverAlpha);

    // Floating +N texts (after units so they draw on top)
    this.drawFloatTexts(world, o.x, o.y);

    ctx.restore();
  }

  /** Layer A label chip for the entity under the cursor (not when selected). */
  private drawHoverAffordanceLabel(
    world: World,
    ox: number,
    oy: number,
    hoverAlpha: number,
  ): void {
    if (world.hoverEntityId == null || hoverAlpha <= 0) return;
    if (world.hoverEntityId === world.selectedId) return;
    const e = world.get(world.hoverEntityId);
    if (!e || (!e.alive && e.kind !== 'loot')) return;
    const aff = affordanceFor(e);
    if (!aff) return;
    const pos = this.drawPos(e);
    const foot = isoProject(pos.x, pos.y, ox, oy);
    const bodyY = foot.y + CONFIG.entityDrawYOffset;
    drawHoverLabel(
      this.ctx,
      foot.x,
      labelAnchorY(e, bodyY),
      aff.label,
      aff.accent,
      hoverAlpha,
    );
  }

  private drawFloatTexts(world: World, ox: number, oy: number): void {
    const ctx = this.ctx;
    for (const f of world.floatTexts) {
      const p = isoProject(f.x, f.y, ox, oy);
      const t = f.age / f.lifetime;
      const rise = t * 36;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.fillStyle = f.color;
      const sx = p.x;
      const sy = p.y - 28 - rise;
      ctx.strokeText(f.text, sx, sy);
      ctx.fillText(f.text, sx, sy);
      ctx.restore();
    }
  }

  /** Lightweight visual-only scenery. Gameplay remains readable and walkable. */
  private drawDecoration(
    decoration: 'tree' | 'fallenTree' | 'stone',
    x: number,
    y: number,
    tileW: number,
    tileH: number,
  ): void {
    const ctx = this.ctx;
    if (decoration === 'tree') {
      ctx.fillStyle = '#6e4b2a';
      ctx.fillRect(x - 3, y - 22, 6, 22);
      ctx.beginPath();
      ctx.arc(x, y - 31, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#238636';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 8, y - 24, 10, 0, Math.PI * 2);
      ctx.arc(x + 9, y - 25, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#2ea043';
      ctx.fill();
      return;
    }
    if (decoration === 'fallenTree') {
      ctx.strokeStyle = '#79512e';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - tileW * 0.18, y - 3);
      ctx.lineTo(x + tileW * 0.18, y + 3);
      ctx.stroke();
      ctx.strokeStyle = '#9a6a3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - tileW * 0.1, y - 5);
      ctx.lineTo(x + tileW * 0.08, y - 1);
      ctx.stroke();
      return;
    }
    drawBlock(ctx, x, y + 2, tileW * 0.2, tileH * 0.22, 7, '#8b949e', '#586069', '#6e7681');
  }

  /**
   * Oat field flush with the terrain diamond (same center/size as a map tile).
   * Crops are clipped so nothing spills outside the square.
   */
  private drawOatField(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tileW: number,
    tileH: number,
  ): void {
    // Match terrain tile diamonds exactly, slight inset so edges read cleanly
    const w = tileW * 0.96;
    const h = tileH * 0.96;
    const hw = w / 2;
    const hh = h / 2;

    // Tilled soil base — centered on tile
    drawDiamond(ctx, cx, cy, w, h, '#6b4f32', '#3d2b1f');
    drawDiamond(ctx, cx, cy, w * 0.9, h * 0.9, '#7a5a38', undefined);

    ctx.save();
    // Clip all crop detail to the tile diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.clip();

    // Dark furrows (iso-aligned)
    ctx.strokeStyle = '#4a3420';
    ctx.lineWidth = 1.2;
    for (let i = -4; i <= 4; i++) {
      const t = i / 5;
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.85 + t * hw * 0.35, cy - hh * 0.15 + t * hh * 0.9);
      ctx.lineTo(cx + hw * 0.15 + t * hw * 0.55, cy + hh * 0.55 + t * hh * 0.35);
      ctx.stroke();
    }

    // Golden oat heads on an iso lattice; short so they stay inside the square
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        if (Math.abs(row) + Math.abs(col) > 5) continue;
        const u = col / 4.2;
        const v = row / 4.2;
        const px = cx + (u - v) * hw * 0.7;
        const py = cy + (u + v) * hh * 0.7;
        const nx = (px - cx) / hw;
        const ny = (py - cy) / hh;
        if (Math.abs(nx) + Math.abs(ny) > 0.82) continue;

        const tall = 3 + ((row * 3 + col * 5 + 11) % 3);
        ctx.strokeStyle = '#8a9a3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py + 1);
        ctx.lineTo(px, py - tall + 1);
        ctx.stroke();
        ctx.fillStyle = row % 2 === 0 ? '#e3b341' : '#d4a017';
        ctx.beginPath();
        ctx.ellipse(px, py - tall + 0.5, 2.1, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0d060';
        ctx.beginPath();
        ctx.ellipse(px - 0.4, py - tall - 0.2, 1.1, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Edge ring aligned with the soil diamond
    ctx.strokeStyle = '#9a7b3a88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Fishing spot: water diamond + ripples, flush with the water tile center.
   */
  private drawFishingSpot(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tileW: number,
    tileH: number,
  ): void {
    const w = tileW * 0.88;
    const h = tileH * 0.88;
    // Pool sits centered on the tile diamond (same projection as terrain water)
    drawDiamond(ctx, cx, cy, w, h, '#163d66', '#0f2a48');
    drawDiamond(ctx, cx, cy, w * 0.72, h * 0.72, '#1a4a7a', undefined);

    // Concentric iso ripples, centered (preserve caller alpha, e.g. regenerating fade)
    const baseAlpha = ctx.globalAlpha;
    ctx.strokeStyle = '#79c0ff';
    ctx.lineWidth = 1.25;
    for (let i = 0; i < 3; i++) {
      const s = 0.55 - i * 0.14;
      ctx.globalAlpha = baseAlpha * (0.85 - i * 0.18);
      ctx.beginPath();
      ctx.moveTo(cx, cy - (h * s) / 2);
      ctx.lineTo(cx + (w * s) / 2, cy);
      ctx.lineTo(cx, cy + (h * s) / 2);
      ctx.lineTo(cx - (w * s) / 2, cy);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;

    // Small bright highlight at true center
    ctx.fillStyle = '#79c0ffaa';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, 3.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEntity(
    world: World,
    e: Entity,
    ox: number,
    oy: number,
    hoverAlpha: number,
  ): void {
    const ctx = this.ctx;
    const pos = this.drawPos(e);
    // True tile/footprint center in screen space (matches terrain diamonds).
    const foot = isoProject(pos.x, pos.y, ox, oy);
    // Standing models: nudge south so 3D mass reads as sitting on the diamond.
    const p = { x: foot.x, y: foot.y + CONFIG.entityDrawYOffset };
    const selected = world.selectedId === e.id;
    const hovered = world.hoverEntityId === e.id && !selected;
    const { tileW, tileH } = CONFIG;
    const aff = affordanceFor(e);
    const footprintOuter = outerForEntity(e, pos, ox, oy);

    // Layer A — ground affordance only for buildings / nodes / loot (not units)
    if (hovered && aff && aff.footprint !== 'none') {
      drawGroundHighlight(ctx, aff.footprint, foot, footprintOuter, aff.accent, hoverAlpha);
    }

    // Layer B — selection (stable blue; no pulse, no double hover)
    if (selected) {
      if (aff?.footprint === '2x2' || e.kind === 'base' || e.kind === 'blacksmith') {
        drawGroundHighlight(ctx, '2x2', foot, footprintOuter, HL.select, 1, {
          strokeWidth: 3.5,
        });
      } else if (aff?.footprint === 'tile' || e.kind === 'resourceNode' || e.kind === 'loot') {
        drawGroundHighlight(ctx, 'tile', foot, footprintOuter, HL.select, 1, {
          strokeWidth: 3.25,
        });
      } else {
        drawUnitSelectRing(ctx, foot);
      }
    }

    switch (e.kind) {
      case 'base': {
        const base = e as BaseBuilding;
        const lv = base.upgradeLevel;
        const floorFill = lv >= 1 ? '#4a3f35' : '#3d4450';
        const floorStroke = lv >= 1 ? '#5a4a3a' : '#30363d';
        const pillarFill = lv >= 1 ? '#a08060' : '#6e7681';
        const pillarHi = lv >= 1 ? '#c0a080' : '#8b949e';
        // One solid 2×2 platform
        if (footprintOuter) {
          drawFootprintFloor(ctx, footprintOuter, floorFill, floorStroke);
        }
        const corners = [
          { x: pos.x - 0.5, y: pos.y - 0.5 },
          { x: pos.x + 0.5, y: pos.y - 0.5 },
          { x: pos.x - 0.5, y: pos.y + 0.5 },
          { x: pos.x + 0.5, y: pos.y + 0.5 },
        ];
        for (const t of corners) {
          const c = isoProject(t.x, t.y, ox, oy);
          const cy = c.y + CONFIG.entityDrawYOffset;
          drawBlock(ctx, c.x, cy, tileW * 0.38, tileH * 0.42, 10, pillarFill, '#484f58', pillarHi);
        }
        const keepH = 26 + lv * 6;
        drawBlock(ctx, p.x, p.y, tileW * 0.75, tileH * 0.85, keepH, '#8b949e', '#484f58', '#6e7681');
        drawBlock(ctx, p.x, p.y - 14, tileW * 0.5, tileH * 0.55, 18, '#58a6ff', '#1f6feb', '#388bfd');
        ctx.fillStyle = '#f85149';
        ctx.fillRect(p.x + 12, p.y - 48, 3, 22);
        ctx.beginPath();
        ctx.moveTo(p.x + 15, p.y - 48);
        ctx.lineTo(p.x + 30, p.y - 42);
        ctx.lineTo(p.x + 15, p.y - 36);
        ctx.closePath();
        ctx.fill();
        drawHpBar(ctx, p.x, p.y - 58, 52, e.hp, e.maxHp);
        if (lv >= 1) {
          const accentH = 10 + lv * 3;
          drawBlock(ctx, p.x - 16, p.y + 4, tileW * 0.28, tileH * 0.32, accentH, '#c9a96e', '#7a6540', '#d4b87a');
          drawBlock(ctx, p.x + 16, p.y + 4, tileW * 0.28, tileH * 0.32, accentH, '#c9a96e', '#7a6540', '#d4b87a');
        }
        if (lv >= 2) {
          drawBlock(ctx, p.x, p.y + 12, tileW * 0.35, tileH * 0.38, 12, '#d4a050', '#8a6530', '#e8c080');
        }
        if (base.upgrading) drawBar(ctx, p.x, p.y - 70, 52, base.upgradeProgress, base.upgradeSeconds, '#58a6ff');
        break;
      }
      case 'blacksmith': {
        // One solid 2×2 platform
        if (footprintOuter) {
          drawFootprintFloor(
            ctx,
            footprintOuter,
            e.completed ? '#4a3a2a' : '#4a4a4a',
            '#1f2933',
          );
        }
        const progress = e.buildProgress / e.buildSeconds;
        drawBlock(ctx, p.x, p.y, tileW * 0.82, tileH * 0.9, e.completed ? 30 : 10 + progress * 16, e.completed ? '#a65f2e' : '#6e7681', '#3d2b1f', '#8b5a2b');
        if (!e.completed) drawBar(ctx, p.x, p.y - 38, 52, e.buildProgress, e.buildSeconds, '#e3b341');
        break;
      }
      case 'resourceNode': {
        // Ground textures use the true tile center (`foot`) — same as terrain diamonds.
        // Unit Y-offset (`p`) is only for standing models (hero/worker), not flat tiles.
        const tile = foot;
        const regenerating = e.replenishTimer > 0;
        const alpha = regenerating ? 0.4 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (e.resource === 'stone') {
          // Rock centered on the work tile diamond
          drawBlock(ctx, tile.x, tile.y, tileW * 0.4, tileH * 0.48, 14, '#8b949e', '#484f58', '#6e7681');
        } else if (e.resource === 'wood') {
          // Trunk planted on tile center; canopy keeps overall mass over the square
          ctx.fillStyle = '#6e4b2a';
          ctx.fillRect(tile.x - 3, tile.y - 18, 6, 18);
          ctx.beginPath();
          ctx.arc(tile.x, tile.y - 24, 12, 0, Math.PI * 2);
          ctx.fillStyle = '#238636';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(tile.x - 6, tile.y - 18, 8, 0, Math.PI * 2);
          ctx.arc(tile.x + 6, tile.y - 19, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = '#2ea043';
          ctx.fill();
        } else if (e.resource === 'fish') {
          this.drawFishingSpot(ctx, tile.x, tile.y, tileW, tileH);
        } else {
          this.drawOatField(ctx, tile.x, tile.y, tileW, tileH);
        }
        ctx.restore();

        const barY = tile.y - 30;
        if (regenerating) {
          const maxT = e.resource === 'fish' ? CONFIG.fishRespawnDelay : CONFIG.nodeReplenishSeconds;
          const left = Math.max(0, e.replenishTimer);
          drawBar(ctx, tile.x, barY, 32, maxT - left, maxT, '#8b949e', 4);
          ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#8b949e';
          const label =
            left >= 60
              ? `${Math.floor(left / 60)}:${String(Math.ceil(left % 60)).padStart(2, '0')}`
              : `${Math.ceil(left)}s`;
          ctx.fillText(label, tile.x, barY - 3);
        } else {
          const fill =
            e.resource === 'stone' ? '#8b949e' : e.resource === 'wood' ? '#3fb950' : e.resource === 'fish' ? '#79c0ff' : '#e3b341';
          const max = e.maxRemaining > 0 ? e.maxRemaining : CONFIG.nodeCapacity;
          drawBar(ctx, tile.x, barY, 32, e.remaining, max, fill, 4);
        }
        break;
      }
      case 'hero': {
        // No body glow on hover — label + cursor only (see drawHoverAffordanceLabel)
        drawHeroWithGear(ctx, p.x, p.y, world.inventory, { tileW, tileH });
        drawHpBar(ctx, p.x, p.y - 34, 28, e.hp, e.maxHp);
        break;
      }
      case 'npc': {
        // Ebbe Greyho — gold/purple merchant look
        drawBlock(ctx, p.x, p.y, tileW * 0.32, tileH * 0.38, 13, '#a371f7', '#6e40c9', '#d2a8ff');
        ctx.beginPath();
        ctx.arc(p.x, p.y - 18, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f0d5b0';
        ctx.fill();
        // Coin pouch
        ctx.fillStyle = '#e3b341';
        ctx.beginPath();
        ctx.ellipse(p.x + 8, p.y - 2, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e3b341';
        ctx.fillText('$', p.x, p.y - 30);
        break;
      }
      case 'worker': {
        const jobColor =
          e.job === 'mine'
            ? '#8b949e'
            : e.job === 'log'
              ? '#3fb950'
              : e.job === 'farm'
                ? '#e3b341'
                : '#8b949e';
        drawBlock(ctx, p.x, p.y, tileW * 0.26, tileH * 0.32, 10, jobColor, '#484f58', '#6e7681');
        ctx.beginPath();
        ctx.arc(p.x, p.y - 13, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#f0d5b0';
        ctx.fill();
        if (e.carried > 0 && e.carriedResource) {
          const pip =
            e.carriedResource === 'stone'
              ? '#8b949e'
              : e.carriedResource === 'wood'
                ? '#3fb950'
                : '#e3b341';
          ctx.fillStyle = pip;
          ctx.beginPath();
          ctx.arc(p.x + 7, p.y - 9, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (e.phase === 'gathering' && e.job !== 'idle') {
          const ratio = Math.min(1, e.gatherTimer / CONFIG.resourceTickInterval);
          const bw = 22;
          const bh = 3;
          const bx = p.x - bw / 2;
          const by = p.y - 26;
          ctx.fillStyle = '#000000aa';
          ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = jobColor;
          ctx.fillRect(bx, by, bw * ratio, bh);
        }
        if (e.phase === 'waiting') {
          // Job still mine/log/farm but every node is empty — visual feedback only.
          // Logic lives in Production.enterWaiting / updateWorkerCycle.
          const t = performance.now() / 1000;
          const cycle = t % 2.4;
          ctx.save();
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#c9d1d9';
          if (cycle < 0.8) {
            ctx.globalAlpha = 0.55 + cycle * 0.4;
            ctx.fillText('z', p.x + 6, p.y - 22 - cycle * 6);
          } else if (cycle < 1.6) {
            const u = cycle - 0.8;
            ctx.globalAlpha = 0.65 + u * 0.3;
            ctx.fillText('z', p.x + 4, p.y - 24 - u * 4);
            ctx.font = 'bold 12px system-ui, sans-serif';
            ctx.fillText('z', p.x + 10, p.y - 30 - u * 5);
          } else {
            const u = cycle - 1.6;
            ctx.globalAlpha = 0.75 + u * 0.25;
            ctx.fillText('z', p.x + 3, p.y - 23 - u * 3);
            ctx.font = 'bold 12px system-ui, sans-serif';
            ctx.fillText('z', p.x + 9, p.y - 29 - u * 4);
            ctx.font = 'bold 13px system-ui, sans-serif';
            ctx.fillText('Z', p.x + 14, p.y - 36 - u * 5);
          }
          ctx.restore();
        }
        drawHpBar(ctx, p.x, p.y - 22, 20, e.hp, e.maxHp);
        break;
      }
      case 'enemy': {
        const sp = ENEMY_SPECIES[e.species] ?? ENEMY_SPECIES.goblin;
        const col = sp.color;
        // No body hover glow — combat rings + "Attack" label carry intent
        if (e.species === 'cow') {
          // Simple cow: oval body
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - 4, 12, 8, 0, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.strokeStyle = '#8b949e';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x + 10, p.y - 8, 5, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
        } else if (e.species === 'human') {
          drawBlock(ctx, p.x, p.y, tileW * 0.28, tileH * 0.34, 12, col, '#6e4b2a', '#8b5a2b');
          ctx.beginPath();
          ctx.arc(p.x, p.y - 16, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#f0d5b0';
          ctx.fill();
        } else {
          // Goblin — angular green
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 16);
          ctx.lineTo(p.x + 10, p.y - 4);
          ctx.lineTo(p.x + 6, p.y + 5);
          ctx.lineTo(p.x - 6, p.y + 5);
          ctx.lineTo(p.x - 10, p.y - 4);
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
          ctx.strokeStyle = '#1a7f37';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.fillRect(p.x - 4, p.y - 10, 3, 3);
          ctx.fillRect(p.x + 1, p.y - 10, 3, 3);
        }
        // Role pip
        if (e.fightRole === 'front') {
          ctx.fillStyle = '#f85149';
          ctx.fillRect(p.x - 3, p.y + 8, 6, 3);
        } else if (e.fightRole === 'waiting') {
          ctx.fillStyle = '#e3b341';
          ctx.fillRect(p.x - 3, p.y + 8, 6, 3);
        }
        drawHpBar(ctx, p.x, p.y - 26, 24, e.hp, e.maxHp);
        break;
      }
      case 'loot': {
        // Glowing pouch
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 2, 10, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#e3b341';
        ctx.fill();
        ctx.strokeStyle = '#bf8700';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 6, p.y - 2);
        ctx.lineTo(p.x, p.y - 12);
        ctx.lineTo(p.x + 6, p.y - 2);
        ctx.closePath();
        ctx.fillStyle = '#f0c14b';
        ctx.fill();
        // Item count pip
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0d1117';
        ctx.fillText(String(e.items.length), p.x, p.y + 5);
        break;
      }
    }
  }
}
