import { CONFIG, ENEMY_SPECIES } from '../config';
import { isoProject } from '../core/math';
import type { BaseBuilding, Entity } from '../core/types';
import type { World } from '../world/World';
import { drawBar, drawBlock, drawDiamond, drawHpBar } from './drawPrimitives';

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cameraX = 0;
  cameraY = 0;
  zoom: number = CONFIG.defaultZoom;
  /** 0–1 progress through the current game tick (for position lerp). */
  tickAlpha = 0;

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

        if (world.hoverTile && world.hoverTile.gx === gx && world.hoverTile.gy === gy) {
          drawDiamond(ctx, c.x, c.y, tileW, tileH, '#ffffff18', '#ffffff99');
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

    // Combat target ring under current target
    const hero = world.hero();
    if (hero?.combatTargetId != null) {
      const t = world.get(hero.combatTargetId);
      if (t && t.alive) {
        const dp = this.drawPos(t);
        const tp = isoProject(dp.x, dp.y, o.x, o.y);
        drawDiamond(ctx, tp.x, tp.y, tileW * 0.85, tileH * 0.85, '#ffffff00', '#f85149');
      }
    }
    if (hero?.queuedTargetId != null) {
      const t = world.get(hero.queuedTargetId);
      if (t && t.alive) {
        const dp = this.drawPos(t);
        const tp = isoProject(dp.x, dp.y, o.x, o.y);
        drawDiamond(ctx, tp.x, tp.y, tileW * 0.75, tileH * 0.75, '#ffffff00', '#e3b341');
      }
    }
    // Pending attack intent (queued until next tick)
    if (world.pendingAttackId != null) {
      const t = world.get(world.pendingAttackId);
      if (t && t.alive) {
        const dp = this.drawPos(t);
        const tp = isoProject(dp.x, dp.y, o.x, o.y);
        drawDiamond(ctx, tp.x, tp.y, tileW * 0.9, tileH * 0.9, '#ffffff00', '#58a6ff');
      }
    }

    for (const e of list) {
      this.drawEntity(world, e, o.x, o.y);
    }

    // Floating +N texts (after units so they draw on top)
    this.drawFloatTexts(world, o.x, o.y);

    ctx.restore();
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

  private drawEntity(world: World, e: Entity, ox: number, oy: number): void {
    const ctx = this.ctx;
    const pos = this.drawPos(e);
    const foot = isoProject(pos.x, pos.y, ox, oy);
    // Nudge so 3D mass sits over the tile diamond (same anchor as tiles)
    const p = { x: foot.x, y: foot.y + CONFIG.entityDrawYOffset };
    const selected = world.selectedId === e.id;
    const { tileW, tileH } = CONFIG;

    if (selected && e.kind !== 'resourceNode') {
      // Selection on the true tile center (foot), not offset up into the model
      drawDiamond(ctx, foot.x, foot.y, tileW * 0.72, tileH * 0.72, '#ffffff00', '#58a6ff');
    }

    switch (e.kind) {
      case 'base': {
        const base = e as BaseBuilding;
        const lv = base.upgradeLevel;
        const tileCenters = [
          { x: pos.x - 0.5, y: pos.y - 0.5 },
          { x: pos.x + 0.5, y: pos.y - 0.5 },
          { x: pos.x - 0.5, y: pos.y + 0.5 },
          { x: pos.x + 0.5, y: pos.y + 0.5 },
        ];
        const floorFill = lv >= 1 ? '#4a3f35' : '#3d4450';
        const floorStroke = lv >= 1 ? '#5a4a3a' : '#30363d';
        const pillarFill = lv >= 1 ? '#a08060' : '#6e7681';
        const pillarHi = lv >= 1 ? '#c0a080' : '#8b949e';
        for (const t of tileCenters) {
          const c = isoProject(t.x, t.y, ox, oy);
          const cy = c.y + CONFIG.entityDrawYOffset;
          drawDiamond(ctx, c.x, c.y, tileW * 0.95, tileH * 0.95, floorFill, floorStroke);
          drawBlock(ctx, c.x, cy, tileW * 0.45, tileH * 0.5, 10, pillarFill, '#484f58', pillarHi);
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
        const tiles = [
          { x: pos.x - 0.5, y: pos.y - 0.5 }, { x: pos.x + 0.5, y: pos.y - 0.5 },
          { x: pos.x - 0.5, y: pos.y + 0.5 }, { x: pos.x + 0.5, y: pos.y + 0.5 },
        ];
        for (const t of tiles) {
          const c = isoProject(t.x, t.y, ox, oy);
          drawDiamond(ctx, c.x, c.y, tileW * 0.95, tileH * 0.95, e.completed ? '#4a3a2a' : '#4a4a4a', '#1f2933');
        }
        const progress = e.buildProgress / e.buildSeconds;
        drawBlock(ctx, p.x, p.y, tileW * 0.82, tileH * 0.9, e.completed ? 30 : 10 + progress * 16, e.completed ? '#a65f2e' : '#6e7681', '#3d2b1f', '#8b5a2b');
        if (!e.completed) drawBar(ctx, p.x, p.y - 38, 52, e.buildProgress, e.buildSeconds, '#e3b341');
        break;
      }
      case 'resourceNode': {
        const regenerating = e.replenishTimer > 0;
        const alpha = regenerating ? 0.4 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (e.resource === 'stone') {
          drawBlock(ctx, p.x, p.y, tileW * 0.42, tileH * 0.5, 16, '#8b949e', '#484f58', '#6e7681');
        } else if (e.resource === 'wood') {
          ctx.fillStyle = '#6e4b2a';
          ctx.fillRect(p.x - 3, p.y - 16, 6, 16);
          ctx.beginPath();
          ctx.arc(p.x, p.y - 22, 13, 0, Math.PI * 2);
          ctx.fillStyle = '#238636';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x - 5, p.y - 16, 9, 0, Math.PI * 2);
          ctx.fillStyle = '#2ea043';
          ctx.fill();
        } else if (e.resource === 'fish') {
          // Fishing spot: blue ripples on water
          ctx.fillStyle = '#1a4a7a';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 2, tileW * 0.28, tileH * 0.32, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#79c0ff';
          ctx.lineWidth = 1.5;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 2 - i * 4, tileW * 0.18 - i * 3, tileH * 0.12, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          drawDiamond(ctx, p.x, p.y, tileW * 0.55, tileH * 0.55, '#3d2b1f', '#00000033');
          ctx.fillStyle = '#3fb950';
          for (let i = 0; i < 4; i++) {
            ctx.fillRect(p.x - 11 + i * 6, p.y - 5, 4, 7);
          }
        }
        ctx.restore();

        const barY = p.y - 32;
        if (regenerating) {
          const maxT = e.resource === 'fish' ? CONFIG.fishRespawnDelay : CONFIG.nodeReplenishSeconds;
          const left = Math.max(0, e.replenishTimer);
          drawBar(ctx, p.x, barY, 32, maxT - left, maxT, '#8b949e', 4);
          ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#8b949e';
          const label =
            left >= 60
              ? `${Math.floor(left / 60)}:${String(Math.ceil(left % 60)).padStart(2, '0')}`
              : `${Math.ceil(left)}s`;
          ctx.fillText(label, p.x, barY - 3);
        } else {
          const fill =
            e.resource === 'stone' ? '#8b949e' : e.resource === 'wood' ? '#3fb950' : e.resource === 'fish' ? '#79c0ff' : '#a371f7';
          const max = e.maxRemaining > 0 ? e.maxRemaining : CONFIG.nodeCapacity;
          drawBar(ctx, p.x, barY, 32, e.remaining, max, fill, 4);
        }
        break;
      }
      case 'hero': {
        drawBlock(ctx, p.x, p.y, tileW * 0.34, tileH * 0.4, 14, '#58a6ff', '#1f6feb', '#388bfd');
        ctx.beginPath();
        ctx.arc(p.x, p.y - 20, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#f0d5b0';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 2);
        ctx.lineTo(p.x + 7, p.y + 3);
        ctx.lineTo(p.x, p.y + 4);
        ctx.closePath();
        ctx.fill();
        drawHpBar(ctx, p.x, p.y - 32, 28, e.hp, e.maxHp);
        break;
      }
      case 'npc': {
        // Test vendor — gold/purple merchant look
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
                ? '#a371f7'
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
                : '#a371f7';
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
        drawHpBar(ctx, p.x, p.y - 22, 20, e.hp, e.maxHp);
        break;
      }
      case 'enemy': {
        const sp = ENEMY_SPECIES[e.species] ?? ENEMY_SPECIES.goblin;
        const col = sp.color;
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
