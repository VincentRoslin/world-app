import { CONFIG } from '../config';
import {
  defaultWorldMapCamera,
  fitCameraToExplored,
  Minimap,
  type WorldMapCamera,
} from '../render/Minimap';
import type { World } from '../world/World';

export type MinimapDisplay = 'normal' | 'minimized' | 'expanded';

/**
 * Minimap chrome: minimize to tray, restore, full map with drag pan + wheel zoom.
 */
export class MapChrome {
  private world: World;
  private mini: Minimap;
  private full: Minimap;
  private wrap: HTMLElement;
  private tray: HTMLElement;
  private overlay: HTMLElement;
  private fullCanvas: HTMLCanvasElement;
  private mode: MinimapDisplay = 'normal';
  private cam: WorldMapCamera = defaultWorldMapCamera();

  private dragging = false;
  private lastPtrX = 0;
  private lastPtrY = 0;
  private coordsEl: HTMLElement | null = null;

  constructor(world: World, miniCanvas: HTMLCanvasElement, fullCanvas: HTMLCanvasElement) {
    this.world = world;
    this.mini = new Minimap(miniCanvas);
    this.full = new Minimap(fullCanvas);
    this.fullCanvas = fullCanvas;
    this.wrap = document.getElementById('minimap-wrap')!;
    this.tray = document.getElementById('minimap-tray')!;
    this.overlay = document.getElementById('map-overlay')!;
    this.coordsEl = document.getElementById('map-tile-coords');

    document.getElementById('btn-minimap-min')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMode('minimized');
    });
    document.getElementById('btn-minimap-expand')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMode('expanded');
    });
    document.getElementById('btn-minimap-restore')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMode('normal');
    });
    document.getElementById('btn-minimap-tray-expand')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMode('expanded');
    });
    document.getElementById('btn-map-overlay-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeExpanded();
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.closeExpanded();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode === 'expanded') {
        this.closeExpanded();
      }
    });

    this.bindWorldMapInteraction(fullCanvas);
    this.applyChrome();
  }

  getMode(): MinimapDisplay {
    return this.mode;
  }

  setMode(mode: MinimapDisplay): void {
    if (mode === 'expanded' && this.mode !== 'expanded') {
      this.wrap.dataset.wasMinimized = this.mode === 'minimized' ? '1' : '0';
      // Fresh open: fit explored land so the square is full of content
      fitCameraToExplored(this.world, this.cam);
    }
    this.mode = mode;
    this.applyChrome();
  }

  private closeExpanded(): void {
    this.dragging = false;
    if (this.wrap.dataset.wasMinimized === '1') {
      this.setMode('minimized');
    } else {
      this.setMode('normal');
    }
  }

  private applyChrome(): void {
    if (this.mode === 'minimized') {
      this.wrap.classList.add('hidden');
      this.tray.classList.remove('hidden');
      this.overlay.classList.add('hidden');
      this.overlay.setAttribute('aria-hidden', 'true');
      return;
    }

    if (this.mode === 'expanded') {
      this.wrap.classList.add('hidden');
      this.tray.classList.add('hidden');
      this.overlay.classList.remove('hidden');
      this.overlay.setAttribute('aria-hidden', 'false');
      this.syncFullCanvasSize();
      return;
    }

    this.wrap.classList.remove('hidden');
    this.tray.classList.add('hidden');
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  private syncFullCanvasSize(): void {
    const c = this.fullCanvas;
    const css = Math.min(
      560,
      Math.floor(window.innerWidth * 0.94 - 28),
      Math.floor(window.innerHeight * 0.6),
    );
    const size = Math.max(280, css);
    if (c.width !== size || c.height !== size) {
      c.width = size;
      c.height = size;
    }
  }

  private bindWorldMapInteraction(canvas: HTMLCanvasElement): void {
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'expanded' || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.dragging = true;
      this.lastPtrX = e.clientX;
      this.lastPtrY = e.clientY;
      this.cam.userControlled = true;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.mode !== 'expanded') return;
      e.preventDefault();
      const dx = e.clientX - this.lastPtrX;
      const dy = e.clientY - this.lastPtrY;
      this.lastPtrX = e.clientX;
      this.lastPtrY = e.clientY;

      const size = Math.min(canvas.width, canvas.height);
      const tilesPerPx = this.cam.tilesAcross / size;
      // Drag map content with the pointer (grab-and-drag)
      this.cam.centerX -= dx * tilesPerPx;
      this.cam.centerY -= dy * tilesPerPx;
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'expanded') return;
        e.preventDefault();
        e.stopPropagation();
        this.cam.userControlled = true;

        const size = Math.min(canvas.width, canvas.height);
        const rect = canvas.getBoundingClientRect();
        // CSS pixel → canvas pixel
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;

        const tilesPerPx = this.cam.tilesAcross / size;
        // World under cursor before zoom
        const worldX = this.cam.centerX + (mx - canvas.width / 2) * tilesPerPx;
        const worldY = this.cam.centerY + (my - canvas.height / 2) * tilesPerPx;

        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const minAcross = 12;
        const maxAcross = CONFIG_MAX_WORLD_SPAN();
        this.cam.tilesAcross = Math.min(maxAcross, Math.max(minAcross, this.cam.tilesAcross * factor));

        const tilesPerPx2 = this.cam.tilesAcross / size;
        // Keep world under cursor stable
        this.cam.centerX = worldX - (mx - canvas.width / 2) * tilesPerPx2;
        this.cam.centerY = worldY - (my - canvas.height / 2) * tilesPerPx2;
      },
      { passive: false },
    );

    // Double-click resets to fit explored
    canvas.addEventListener('dblclick', (e) => {
      if (this.mode !== 'expanded') return;
      e.preventDefault();
      e.stopPropagation();
      fitCameraToExplored(this.world, this.cam);
    });
  }

  render(): void {
    this.updateTileCoords();
    if (this.mode === 'normal') {
      this.mini.render(this.world, 'local');
    } else if (this.mode === 'expanded') {
      this.syncFullCanvasSize();
      // Auto-fit only until the player pans/zooms
      if (!this.cam.userControlled) {
        fitCameraToExplored(this.world, this.cam);
      }
      this.full.render(this.world, 'world', this.cam);
    }
  }

  /** Live world tile under cursor — handy for debugging map fixes. */
  private updateTileCoords(): void {
    if (!this.coordsEl) return;
    const h = this.world.hoverTile;
    if (!h) {
      this.coordsEl.textContent = '—';
      this.coordsEl.title = 'Tile under cursor (world X, Y)';
      return;
    }
    this.coordsEl.textContent = `${h.gx}, ${h.gy}`;
    const tile = this.world.tileAt(h.gx, h.gy);
    const biome = tile?.biome ? ` · ${tile.biome}` : '';
    const terr = tile?.terrain ? ` · ${tile.terrain}` : '';
    this.coordsEl.title = `Tile ${h.gx}, ${h.gy}${terr}${biome}`;
  }
}

function CONFIG_MAX_WORLD_SPAN(): number {
  return (CONFIG.maxChunkRadius + 1) * CONFIG.chunkSize * 2.2;
}
