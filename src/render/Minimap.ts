import type { Entity } from '../core/types';
import type { World } from '../world/World';
import { CONFIG } from '../config';

export type MapViewMode = 'local' | 'world';

/** Pan/zoom state for the full world map overlay. */
export interface WorldMapCamera {
  /** World tile at canvas center. */
  centerX: number;
  centerY: number;
  /** How many world tiles span the shorter canvas axis (zoom). */
  tilesAcross: number;
  /** Once true, auto-fit stops until reset. */
  userControlled: boolean;
}

export function defaultWorldMapCamera(): WorldMapCamera {
  return {
    centerX: CONFIG.chunkSize / 2,
    centerY: CONFIG.chunkSize / 2,
    tilesAcross: CONFIG.chunkSize * 1.15,
    userControlled: false,
  };
}

/**
 * Local minimap: current chunk fills the square (no black letterbox).
 * World map: soft overview with external pan/zoom camera.
 */
export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private softBuf: HTMLCanvasElement | null = null;
  private softCtx: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Minimap canvas 2D missing');
    this.ctx = ctx;
  }

  render(world: World, mode: MapViewMode = 'local', cam?: WorldMapCamera): void {
    if (mode === 'world') this.renderWorld(world, cam ?? defaultWorldMapCamera());
    else this.renderLocal(world);
  }

  /**
   * Current map-square (chunk) fills the entire canvas edge-to-edge.
   * At base: full starter home chunk, no black margins.
   */
  private renderLocal(world: World): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const hero = world.hero();
    const base = world.base();
    const px = hero?.alive ? hero.x : (base?.x ?? 0);
    const py = hero?.alive ? hero.y : (base?.y ?? 0);

    const cs = CONFIG.chunkSize;
    const cx = Math.floor(px / cs);
    const cy = Math.floor(py / cs);
    const ox = cx * cs;
    const oy = cy * cs;

    // Fill the square exactly with this chunk (edge to edge)
    const scale = Math.min(w / cs, h / cs);
    const mapW = cs * scale;
    const mapH = cs * scale;
    // Center if non-square canvas (shouldn't happen); no black gutters inside chunk
    const offX = (w - mapW) / 2;
    const offY = (h - mapH) / 2;

    const toPx = (gx: number, gy: number) => ({
      x: offX + (gx - ox) * scale,
      y: offY + (gy - oy) * scale,
    });

    // Base fill so the whole square is painted (no black)
    ctx.fillStyle = '#1a2330';
    ctx.fillRect(offX, offY, mapW, mapH);

    const cell = Math.max(1, scale);

    for (let ty = 0; ty < cs; ty++) {
      for (let tx = 0; tx < cs; tx++) {
        const gx = ox + tx;
        const gy = oy + ty;
        const tile = world.tileAt(gx, gy);
        const explored = world.isExplored(gx, gy);
        const p = toPx(gx, gy);

        if (tile && explored) {
          if (tile.terrain === 'water') ctx.fillStyle = '#1a5a9a';
          else if (tile.terrain === 'dirt') ctx.fillStyle = '#7a5a3d';
          else if (tile.terrain === 'sand') ctx.fillStyle = '#c2a46a';
          else if (tile.terrain === 'snow') ctx.fillStyle = '#d0dae6';
          else ctx.fillStyle = tile.biome === 'forest' ? '#1f5c40' : '#2f7a52';
        } else if (tile) {
          if (tile.terrain === 'water') ctx.fillStyle = '#0d2840';
          else if (tile.terrain === 'dirt') ctx.fillStyle = '#3a2e22';
          else if (tile.terrain === 'sand') ctx.fillStyle = '#6a5838';
          else if (tile.terrain === 'snow') ctx.fillStyle = '#6a7585';
          else ctx.fillStyle = '#1a3326';
        } else {
          // Unloaded cell of this chunk — rare; soft fill
          ctx.fillStyle = '#15202b';
        }
        ctx.fillRect(p.x, p.y, cell + 0.6, cell + 0.6);
      }
    }

    // Chunk border (inside edge)
    ctx.strokeStyle = cx === 0 && cy === 0 ? '#58a6ffaa' : '#ffffff33';
    ctx.lineWidth = 2;
    ctx.strokeRect(offX + 1, offY + 1, mapW - 2, mapH - 2);

    // Entities in this chunk
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      const egx = Math.floor(e.x);
      const egy = Math.floor(e.y);
      if (egx < ox || egx >= ox + cs || egy < oy || egy >= oy + cs) continue;
      if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'base' && e.kind !== 'npc') {
        if (!world.isExplored(egx, egy)) continue;
      }
      const p = toPx(e.x, e.y);
      this.drawEntityMarker(ctx, e.kind, p.x, p.y, Math.max(2.5, scale * 0.85), e);
    }

    // Frame
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.fillStyle = '#c9d1d9';
    ctx.textAlign = 'left';
    const label = cx === 0 && cy === 0 ? 'Home' : `Chunk ${cx},${cy}`;
    ctx.fillText(label, 6, h - 6);
  }

  /**
   * Detailed world overview with pan/zoom.
   * Zoomed-out: soft painted biomes. Zoomed-in: near-tile detail + features.
   */
  private renderWorld(world: World, cam: WorldMapCamera): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const voidGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w * 0.85);
    voidGrad.addColorStop(0, '#141c28');
    voidGrad.addColorStop(1, '#070b12');
    ctx.fillStyle = voidGrad;
    ctx.fillRect(0, 0, w, h);

    const tilesAcross = Math.max(8, cam.tilesAcross);
    const scale = Math.min(w, h) / tilesAcross;
    const toPx = (gx: number, gy: number) => ({
      x: w / 2 + (gx - cam.centerX) * scale,
      y: h / 2 + (gy - cam.centerY) * scale,
    });

    // Visible world rect (cover non-square canvas)
    const halfX = (tilesAcross * (w / Math.min(w, h))) / 2 + 2;
    const halfY = (tilesAcross * (h / Math.min(w, h))) / 2 + 2;
    const minG = Math.floor(cam.centerX - halfX);
    const maxG = Math.ceil(cam.centerX + halfX);
    const minGY = Math.floor(cam.centerY - halfY);
    const maxGY = Math.ceil(cam.centerY + halfY);

    // Detail level from zoom: more pixels/tile → finer sampling
    // scale ~2+ = almost per-tile; zoomed out uses softer paint
    const detail = scale >= 4 ? 'high' : scale >= 2 ? 'med' : 'low';
    const sample =
      detail === 'high' ? 1 : detail === 'med' ? Math.max(1, Math.round(2 / Math.max(0.5, scale))) : Math.max(2, Math.floor(tilesAcross / 100));

    const spanX = maxG - minG + 1;
    const spanY = maxGY - minGY + 1;
    const bufW = Math.ceil(spanX / sample) + 2;
    const bufH = Math.ceil(spanY / sample) + 2;
    if (!this.softBuf || this.softBuf.width !== bufW || this.softBuf.height !== bufH) {
      this.softBuf = document.createElement('canvas');
      this.softBuf.width = Math.max(1, bufW);
      this.softBuf.height = Math.max(1, bufH);
      this.softCtx = this.softBuf.getContext('2d');
    }
    const sctx = this.softCtx!;
    sctx.clearRect(0, 0, bufW, bufH);
    sctx.fillStyle = '#0a1018';
    sctx.fillRect(0, 0, bufW, bufH);

    for (let by = 0; by < bufH; by++) {
      for (let bx = 0; bx < bufW; bx++) {
        const gx0 = minG + bx * sample;
        const gy0 = minGY + by * sample;
        let water = 0;
        let dirt = 0;
        let grass = 0;
        let sand = 0;
        let snow = 0;
        let blocked = 0;
        let n = 0;
        let explored = 0;
        for (let dy = 0; dy < sample; dy++) {
          for (let dx = 0; dx < sample; dx++) {
            const gx = gx0 + dx;
            const gy = gy0 + dy;
            if (!world.isExplored(gx, gy)) continue;
            explored++;
            const t = world.tileAt(gx, gy);
            if (!t) continue;
            n++;
            if (t.blocked && t.terrain !== 'water') blocked++;
            if (t.terrain === 'water') water++;
            else if (t.terrain === 'dirt') dirt++;
            else if (t.terrain === 'sand') sand++;
            else if (t.terrain === 'snow') snow++;
            else grass++;
          }
        }
        if (explored === 0) continue;
        if (n === 0) {
          sctx.fillStyle = '#1a222e';
          sctx.fillRect(bx, by, 1, 1);
          continue;
        }
        let color: string;
        const landMax = Math.max(dirt, grass, sand, snow);
        if (water >= landMax) {
          color = water / n > 0.7 ? '#1560a0' : '#2a7ec4';
        } else if (snow === landMax) {
          color = '#c8d4e4';
        } else if (sand === landMax) {
          color = '#c2a46a';
        } else if (dirt === landMax) {
          color = blocked > n * 0.25 ? '#6a5038' : '#9a7550';
        } else {
          const v = ((gx0 * 17 + gy0 * 31) & 7) / 7;
          color = blocked > n * 0.3 ? '#2d6b45' : v > 0.55 ? '#3d9a5c' : '#348a52';
        }
        sctx.fillStyle = color;
        sctx.fillRect(bx, by, 1, 1);
      }
    }

    const topLeft = toPx(minG, minGY);
    const botRight = toPx(maxG + 1, maxGY + 1);
    const drawW = botRight.x - topLeft.x;
    const drawH = botRight.y - topLeft.y;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Light soften only when zoomed out; keep edges readable when zoomed in
    if (detail === 'low') {
      ctx.filter = 'blur(1.1px)';
      ctx.drawImage(this.softBuf, topLeft.x, topLeft.y, drawW, drawH);
      ctx.filter = 'none';
      ctx.globalAlpha = 0.88;
    } else if (detail === 'med') {
      ctx.filter = 'blur(0.45px)';
      ctx.drawImage(this.softBuf, topLeft.x, topLeft.y, drawW, drawH);
      ctx.filter = 'none';
      ctx.globalAlpha = 0.95;
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.softBuf, topLeft.x, topLeft.y, drawW, drawH);
    ctx.globalAlpha = 1;
    ctx.restore();

    // High zoom: overlay true tiles for crisp shores / rocks
    if (detail === 'high') {
      ctx.imageSmoothingEnabled = false;
      const cell = Math.max(1, scale);
      for (let gy = minGY; gy <= maxGY; gy++) {
        for (let gx = minG; gx <= maxG; gx++) {
          if (!world.isExplored(gx, gy)) continue;
          const t = world.tileAt(gx, gy);
          if (!t) continue;
          const p = toPx(gx, gy);
          if (t.terrain === 'water') ctx.fillStyle = '#1a6eb0';
          else if (t.terrain === 'dirt') ctx.fillStyle = t.blocked ? '#6e533c' : '#a07d56';
          else if (t.terrain === 'sand') ctx.fillStyle = '#d4b87a';
          else if (t.terrain === 'snow') ctx.fillStyle = '#e8eef6';
          else ctx.fillStyle = t.blocked ? '#2a6540' : t.biome === 'forest' ? '#2a7a4c' : '#3d9a5c';
          ctx.fillRect(p.x, p.y, cell + 0.4, cell + 0.4);
          if (t.decoration === 'tree' || t.decoration === 'fallenTree' || t.decoration === 'bush') {
            ctx.fillStyle = '#1f4d2e';
            ctx.fillRect(p.x + cell * 0.25, p.y + cell * 0.2, cell * 0.5, cell * 0.55);
          } else if (t.decoration === 'stone' || t.decoration === 'rock') {
            ctx.fillStyle = '#8b949e';
            ctx.fillRect(p.x + cell * 0.3, p.y + cell * 0.3, cell * 0.4, cell * 0.4);
          }
        }
      }
    }

    // Chunk grid when zoomed enough to read
    if (tilesAcross <= CONFIG.chunkSize * 4.5) {
      const cs = CONFIG.chunkSize;
      const c0x = Math.floor(minG / cs);
      const c1x = Math.floor(maxG / cs);
      const c0y = Math.floor(minGY / cs);
      const c1y = Math.floor(maxGY / cs);
      ctx.lineWidth = 1;
      for (let ccy = c0y; ccy <= c1y; ccy++) {
        for (let ccx = c0x; ccx <= c1x; ccx++) {
          const a = toPx(ccx * cs, ccy * cs);
          const b = toPx((ccx + 1) * cs, (ccy + 1) * cs);
          const home = ccx === 0 && ccy === 0;
          ctx.strokeStyle = home ? '#58a6ff88' : '#ffffff14';
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        }
      }
    }

    // Home aura
    const home = toPx(CONFIG.chunkSize / 2, CONFIG.chunkSize / 2);
    const homeR = Math.max(10, CONFIG.chunkSize * scale * 0.48);
    const hg = ctx.createRadialGradient(home.x, home.y, 2, home.x, home.y, homeR);
    hg.addColorStop(0, '#58a6ff44');
    hg.addColorStop(0.5, '#58a6ff14');
    hg.addColorStop(1, '#58a6ff00');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(home.x, home.y, homeR, 0, Math.PI * 2);
    ctx.fill();

    // Features & entities
    ctx.imageSmoothingEnabled = false;
    const marginX = halfX + 4;
    const marginY = halfY + 4;
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      if (Math.abs(e.x - cam.centerX) > marginX || Math.abs(e.y - cam.centerY) > marginY) continue;
      const gx = Math.floor(e.x);
      const gy = Math.floor(e.y);
      if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'base' && e.kind !== 'npc') {
        if (!world.isExplored(gx, gy)) continue;
      }
      const p = toPx(e.x, e.y);

      // Resources visible at med/high zoom
      if (e.kind === 'resourceNode' && detail !== 'low') {
        const res = e.resource;
        const col =
          res === 'stone' ? '#c9d1d9' : res === 'wood' ? '#56d364' : res === 'fish' ? '#79c0ff' : '#e3b341';
        const rs = Math.max(2, scale * 0.35);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rs, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#00000066';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        continue;
      }

      if (e.kind === 'blacksmith' && detail !== 'low') {
        ctx.fillStyle = '#f0883e';
        const s = Math.max(3, scale * 0.45);
        ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
        if (detail === 'high') {
          ctx.fillStyle = '#e6edf3';
          ctx.font = 'bold 8px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('⚒', p.x, p.y - s - 2);
        }
        continue;
      }

      if (e.kind === 'loot' && detail === 'high') {
        ctx.fillStyle = '#e3b341';
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        continue;
      }

      const s =
        e.kind === 'base'
          ? Math.max(5, scale * 0.55)
          : e.kind === 'hero'
            ? Math.max(4, scale * 0.45)
            : e.kind === 'npc'
              ? Math.max(3.5, scale * 0.4)
              : e.kind === 'enemy'
                ? Math.max(2.5, scale * 0.32)
                : Math.max(2.5, scale * 0.3);
      this.drawEntityMarker(ctx, e.kind, p.x, p.y, s, e, true);

      // Labels when zoomed in
      if (detail === 'high') {
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e6edf3';
        if (e.kind === 'base') ctx.fillText('Base', p.x, p.y - s - 4);
        else if (e.kind === 'npc') ctx.fillText(e.name.slice(0, 12), p.x, p.y - s - 4);
      }
    }

    const hero = world.hero();
    if (hero?.alive) {
      const p = toPx(hero.x, hero.y);
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(7, scale * 0.55), 0, Math.PI * 2);
      ctx.stroke();
      // Direction tick
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - Math.max(7, scale * 0.55));
      ctx.lineTo(p.x, p.y - Math.max(11, scale * 0.85));
      ctx.stroke();
    }

    ctx.strokeStyle = '#58a6ff66';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.fillText('N', w / 2, 14);
    ctx.textAlign = 'left';
    ctx.fillText('Drag · Scroll zoom · Dbl-click fit', 8, h - 10);
    ctx.textAlign = 'right';
    const zoomLabel = detail === 'high' ? 'Detail' : detail === 'med' ? 'Region' : 'World';
    ctx.fillText(zoomLabel, w - 10, h - 10);
  }

  private drawEntityMarker(
    ctx: CanvasRenderingContext2D,
    kind: Entity['kind'],
    x: number,
    y: number,
    s: number,
    e: Entity,
    soft = false,
  ): void {
    if (kind === 'base') {
      ctx.fillStyle = '#58a6ff';
      if (soft) {
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y);
        ctx.lineTo(x, y + s);
        ctx.lineTo(x - s, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff88';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillRect(x - s, y - s, s * 2, s * 2);
      }
    } else if (kind === 'hero') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (kind === 'worker') {
      ctx.fillStyle = '#e3b341';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    } else if (kind === 'enemy') {
      ctx.fillStyle = '#f85149';
      ctx.beginPath();
      ctx.arc(x, y, s * 0.75, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'npc') {
      ctx.fillStyle = '#d2a8ff';
      ctx.beginPath();
      ctx.arc(x, y, s * 0.8, 0, Math.PI * 2);
      ctx.fill();
      if (soft) {
        ctx.fillStyle = '#e3b341';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('$', x, y - s - 2);
      }
    } else if (kind === 'resourceNode' && !soft) {
      const res = e.kind === 'resourceNode' ? e.resource : 'food';
      ctx.fillStyle =
        res === 'stone' ? '#8b949e' : res === 'wood' ? '#3fb950' : res === 'fish' ? '#79c0ff' : '#e3b341';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }
}

/** Fit camera to explored tiles (or home chunk if nothing explored). */
export function fitCameraToExplored(world: World, cam: WorldMapCamera, padding = 1.12): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of world.explored) {
    const [gx, gy] = key.split(',').map(Number) as [number, number];
    if (gx < minX) minX = gx;
    if (gy < minY) minY = gy;
    if (gx > maxX) maxX = gx;
    if (gy > maxY) maxY = gy;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = CONFIG.chunkSize - 1;
    maxY = CONFIG.chunkSize - 1;
  }
  cam.centerX = (minX + maxX) / 2;
  cam.centerY = (minY + maxY) / 2;
  const span = Math.max(maxX - minX + 1, maxY - minY + 1, CONFIG.chunkSize);
  cam.tilesAcross = span * padding;
  cam.userControlled = false;
}
