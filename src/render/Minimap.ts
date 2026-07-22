import type { World } from '../world/World';
import { CONFIG } from '../config';

export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Minimap canvas 2D missing');
    this.ctx = ctx;
  }

  render(world: World): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, w, h);

    const pad = 4;
    const spanX = Math.max(1, world.maxGx - world.minGx + 1);
    const spanY = Math.max(1, world.maxGy - world.minGy + 1);
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const ox = pad + ((w - pad * 2) - spanX * scale) / 2;
    const oy = pad + ((h - pad * 2) - spanY * scale) / 2;

    const toPx = (gx: number, gy: number) => ({
      x: ox + (gx - world.minGx) * scale,
      y: oy + (gy - world.minGy) * scale,
    });

    // Explored tiles
    for (const key of world.explored) {
      const [gsx, gsy] = key.split(',').map(Number) as [number, number];
      const tile = world.tileAt(gsx, gsy);
      if (!tile) continue;
      const p = toPx(gsx, gsy);
      if (tile.terrain === 'water') ctx.fillStyle = '#1d4e89';
      else if (tile.terrain === 'dirt') ctx.fillStyle = '#6b4f3a';
      else ctx.fillStyle = '#2d6a4f';
      ctx.fillRect(p.x, p.y, Math.max(1, scale), Math.max(1, scale));
    }

    // Unexplored but loaded (dim)
    for (const [key, tile] of world.tiles) {
      if (world.explored.has(key)) continue;
      const [gsx, gsy] = key.split(',').map(Number) as [number, number];
      const p = toPx(gsx, gsy);
      ctx.fillStyle = tile.terrain === 'water' ? '#0a1628' : '#12151a';
      ctx.fillRect(p.x, p.y, Math.max(1, scale), Math.max(1, scale));
    }

    // Entities on explored tiles
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      const gx = Math.floor(e.x);
      const gy = Math.floor(e.y);
      if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'base') {
        if (!world.isExplored(gx, gy)) continue;
      }
      const p = toPx(e.x, e.y);
      const s = Math.max(2, scale * 0.8);
      if (e.kind === 'base') {
        ctx.fillStyle = '#58a6ff';
        ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
      } else if (e.kind === 'hero') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'worker') {
        ctx.fillStyle = '#e3b341';
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      } else if (e.kind === 'enemy') {
        ctx.fillStyle = '#f85149';
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'resourceNode') {
        ctx.fillStyle =
          e.resource === 'stone' ? '#8b949e' : e.resource === 'wood' ? '#3fb950' : e.resource === 'fish' ? '#79c0ff' : '#a371f7';
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }

    // Border
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // Home chunk outline
    const home = toPx(0, 0);
    ctx.strokeStyle = '#58a6ff88';
    ctx.lineWidth = 1;
    ctx.strokeRect(home.x, home.y, CONFIG.chunkSize * scale, CONFIG.chunkSize * scale);
  }
}
