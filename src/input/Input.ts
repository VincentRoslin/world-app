import type { Renderer } from '../render/Renderer';
import type { World } from '../world/World';
import type { Entity } from '../core/types';
import { commandAt, queueFish, queueHeroAttack, queueShopInteract } from '../systems/Commands';
import { CONFIG } from '../config';
import { placeBlacksmith } from '../systems/Production';

export class Input {
  private keys = new Set<string>();
  private panning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private canvas: HTMLCanvasElement;
  private world: World;
  private renderer: Renderer;
  private onToggleCharacter: () => void;
  private onToggleBags: () => void;

  private uiKeyHeld = new Set<string>();
  /**
   * Soft lock: when true, camera centers on the hero each frame.
   * WASD / arrows / middle-drag pan unlocks; F re-locks on the hero.
   */
  private cameraFollow = true;
  /** Dev: ignore camera leash so you can survey the whole loaded map. */
  private devCameraUnlocked = false;

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    renderer: Renderer,
    opts?: {
      onToggleCharacter?: () => void;
      onToggleBags?: () => void;
    },
  ) {
    this.canvas = canvas;
    this.world = world;
    this.renderer = renderer;
    this.onToggleCharacter = opts?.onToggleCharacter ?? (() => undefined);
    this.onToggleBags = opts?.onToggleBags ?? (() => undefined);

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mouseleave', () => {
      this.world.hoverTile = null;
      this.world.hoverEntityId = null;
      this.canvas.style.cursor = 'default';
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      // Ignore keybinds while typing in inputs (none currently) or when repeating
      if (e.repeat) return;
      if (k === 'c' && !this.uiKeyHeld.has('c')) {
        this.uiKeyHeld.add('c');
        this.onToggleCharacter();
      }
      if (k === 'b' && !this.uiKeyHeld.has('b')) {
        this.uiKeyHeld.add('b');
        this.onToggleBags();
      }
      // F = re-lock soft camera follow on the hero
      if (k === 'f' && !this.uiKeyHeld.has('f')) {
        this.uiKeyHeld.add('f');
        this.lockCameraOnHero();
      }
      if (k === 'escape') {
        this.world.buildingPlacement = null;
        this.world.inventoryOpen = false;
        document.getElementById('character-panel')?.classList.add('hidden');
        document.getElementById('shop-panel')?.classList.add('hidden');
        document.getElementById('help-modal')?.classList.add('hidden');
        // Full map overlay close is handled in MapChrome
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      this.uiKeyHeld.delete(k);
    });
  }

  /** Soft lock on (default after restart / F). */
  isCameraFollow(): boolean {
    return this.cameraFollow;
  }

  /** Enable follow and snap to hero (or base if no hero). */
  lockCameraOnHero(): void {
    this.cameraFollow = true;
    this.snapFollowTarget();
    this.world.message = 'Camera following hero (WASD unlocks).';
  }

  /** Reset soft lock without a toast (restart / load). */
  resetCameraFollow(): void {
    this.cameraFollow = true;
  }

  private unlockCamera(): void {
    this.cameraFollow = false;
  }

  private snapFollowTarget(): void {
    const hero = this.world.hero();
    if (hero && hero.alive) {
      this.renderer.centerOn(hero.x, hero.y);
      return;
    }
    const base = this.world.base();
    if (base) this.renderer.centerOn(base.x, base.y);
  }

  /**
   * Apply soft-lock: center on hero when follow is on.
   * Call after movement so the camera tracks the current position.
   */
  applyCameraFollow(): void {
    if (!this.cameraFollow) return;
    const hero = this.world.hero();
    if (hero && hero.alive) {
      this.renderer.centerOn(hero.x, hero.y);
      return;
    }
    // Dead / missing hero: hold on base rather than freezing mid-map
    const base = this.world.base();
    if (base) this.renderer.centerOn(base.x, base.y);
  }

  /** Dev toggle: free roam past camera leash (for map review). */
  toggleDevCameraUnlock(): boolean {
    this.devCameraUnlocked = !this.devCameraUnlocked;
    if (this.devCameraUnlocked) {
      this.unlockCamera();
      this.world.message = 'Dev cam ON — leash off, map streams under camera';
    } else {
      this.clampCameraToHero();
      this.world.message = 'Dev cam OFF — leash restored';
    }
    return this.devCameraUnlocked;
  }

  isDevCameraUnlocked(): boolean {
    return this.devCameraUnlocked;
  }

  /** Pull free-look camera back if it strays too far from the hero. */
  private clampCameraToHero(): void {
    if (this.devCameraUnlocked) return;
    const hero = this.world.hero();
    if (hero && hero.alive) {
      this.renderer.clampNear(hero.x, hero.y, CONFIG.cameraLeashTiles);
      return;
    }
    const base = this.world.base();
    if (base) this.renderer.clampNear(base.x, base.y, CONFIG.cameraLeashTiles);
  }

  update(dt: number): void {
    // The inventory is an overlay, not a modal game state. Keep camera controls
    // available while comparing equipment or managing bags.
    const panSpeed = 320 / Math.max(0.4, this.renderer.zoom);
    const panUp = this.keys.has('w') || this.keys.has('arrowup');
    const panDown = this.keys.has('s') || this.keys.has('arrowdown');
    const panLeft = this.keys.has('a') || this.keys.has('arrowleft');
    const panRight = this.keys.has('d') || this.keys.has('arrowright');
    if (panUp || panDown || panLeft || panRight) {
      this.unlockCamera();
      let dx = 0;
      let dy = 0;
      // Screen-space pan (same axes as mouse drag)
      if (panLeft) dx -= panSpeed * dt;
      if (panRight) dx += panSpeed * dt;
      if (panUp) dy -= panSpeed * dt;
      if (panDown) dy += panSpeed * dt;
      this.renderer.panScreen(dx, dy);
    }
    if (!this.cameraFollow) this.clampCameraToHero();
  }

  private eventToCanvas(e: MouseEvent): { sx: number; sy: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  private eventToWorld(e: MouseEvent): { x: number; y: number } {
    const { sx, sy } = this.eventToCanvas(e);
    return this.renderer.screenToWorld(sx, sy);
  }

  /**
   * 3D-aware pick: ray hits the ground, so prefer **world footprint** over huge
   * screen boxes (those made the base steal clicks from neighboring tiles).
   *
   * Priority:
   * 1) Buildings / nodes whose footprint contains the ground tile under cursor
   * 2) Units within a small world-space radius of that ground point
   * 3) Tight screen fallback for unit bodies only (not large buildings)
   */
  private pickEntityAtScreen(
    sx: number,
    sy: number,
    kinds: Entity['kind'][],
  ): Entity | null {
    const z = Math.max(0.5, this.renderer.zoom);
    const wpos = this.renderer.screenToWorld(sx, sy);
    const gx = Math.floor(wpos.x);
    const gy = Math.floor(wpos.y);

    let best: Entity | null = null;
    let bestScore = Infinity;

    for (const e of this.world.entities.values()) {
      if (!e.alive) continue;
      if (!kinds.includes(e.kind)) continue;
      if (e.kind === 'enemy' || e.kind === 'resourceNode') {
        if (!this.world.tileAt(Math.floor(e.x), Math.floor(e.y))) continue;
      }

      // ── Footprint picks (exact tile ownership) ─────────────────────
      if (e.kind === 'base' || e.kind === 'blacksmith') {
        // 2×2: center is e.x,e.y → tiles [floor(e.x)-1 .. floor(e.x)] × same for y
        const ox = Math.floor(e.x) - 1;
        const oy = Math.floor(e.y) - 1;
        if (gx >= ox && gx < ox + 2 && gy >= oy && gy < oy + 2) {
          // Prefer closest to building center among footprint hits
          const score = (wpos.x - e.x) ** 2 + (wpos.y - e.y) ** 2;
          if (score < bestScore) {
            bestScore = score;
            best = e;
          }
        }
        continue; // never use oversized screen boxes for buildings
      }

      if (e.kind === 'resourceNode') {
        if (Math.floor(e.x) === gx && Math.floor(e.y) === gy) {
          const score = (wpos.x - e.x) ** 2 + (wpos.y - e.y) ** 2;
          if (score < bestScore) {
            bestScore = score;
            best = e;
          }
        }
        continue;
      }

      if (e.kind === 'loot') {
        if (Math.floor(e.x) === gx && Math.floor(e.y) === gy) {
          const score = (wpos.x - e.x) ** 2 + (wpos.y - e.y) ** 2 * 0.5;
          if (score < bestScore) {
            bestScore = score;
            best = e;
          }
        }
        // small world radius too
        const wd = Math.hypot(wpos.x - e.x, wpos.y - e.y);
        if (wd < 0.45) {
          const score = wd * wd;
          if (score < bestScore) {
            bestScore = score;
            best = e;
          }
        }
        continue;
      }

      // ── Units: tight world radius first ────────────────────────────
      let worldR = 0.48;
      if (e.kind === 'enemy' && e.species === 'cow') worldR = 0.55;
      else if (e.kind === 'worker') worldR = 0.42;
      else if (e.kind === 'hero' || e.kind === 'npc') worldR = 0.5;

      const wd = Math.hypot(wpos.x - e.x, wpos.y - e.y);
      if (wd <= worldR) {
        // Prefer closer units; slight bias so hero is easy to re-select
        const score = wd * wd * (e.kind === 'hero' ? 0.85 : 1);
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
        continue;
      }

      // ── Tight screen fallback (body only — still small) ────────────
      // Helps when the unit stands slightly off the raycast ground point.
      const foot = this.renderer.worldToScreen(e.x, e.y);
      let halfW = 10 * z;
      let heightUp = 26 * z;
      let heightDown = 6 * z;
      if (e.kind === 'enemy') {
        if (e.species === 'cow') {
          halfW = 12 * z;
          heightUp = 16 * z;
        } else if (e.species === 'goblin') {
          halfW = 10 * z;
          heightUp = 22 * z;
        } else {
          halfW = 10 * z;
          heightUp = 28 * z;
        }
      } else if (e.kind === 'hero' || e.kind === 'npc') {
        halfW = 10 * z;
        heightUp = 30 * z;
      } else if (e.kind === 'worker') {
        halfW = 9 * z;
        heightUp = 24 * z;
      }

      // Only allow screen fallback if ground click is already near the unit
      if (wd > 1.05) continue;

      const dx = sx - foot.x;
      const above = foot.y - sy;
      if (Math.abs(dx) > halfW) continue;
      if (above < -heightDown || above > heightUp) continue;

      const bodyCenterY = foot.y - heightUp * 0.45;
      const dy = sy - bodyCenterY;
      const score = 0.35 + dx * dx * 0.02 + dy * dy * 0.015 + wd * wd;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.panning = true;
      this.unlockCamera();
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      return;
    }

    const { sx, sy } = this.eventToCanvas(e);
    const wpos = this.renderer.screenToWorld(sx, sy);
    const gx = Math.floor(wpos.x);
    const gy = Math.floor(wpos.y);

    if (e.button === 0) {
      // Building placement always wins on LMB
      if (this.world.buildingPlacement) {
        placeBlacksmith(this.world, gx, gy);
        return;
      }
      /**
       * LMB hybrid:
       * - Entity → select only (workers, base, nodes, enemies, vendor…)
       * - Empty ground → move (hero, or selected worker)
       * RMB still does attack / shop / fish / move so nothing is lost.
       */
      const picked = this.pickEntityAtScreen(sx, sy, [
        'hero',
        'worker',
        'base',
        'blacksmith',
        'npc',
        'enemy',
        'resourceNode',
        'loot',
      ]);
      if (
        picked &&
        (picked.kind === 'hero' ||
          picked.kind === 'worker' ||
          picked.kind === 'base' ||
          picked.kind === 'blacksmith' ||
          picked.kind === 'npc' ||
          picked.kind === 'enemy' ||
          picked.kind === 'resourceNode' ||
          picked.kind === 'loot')
      ) {
        this.world.selectedId = picked.id;
        return;
      }
      // Empty ground: move selected worker, else hero
      commandAt(this.world, wpos.x, wpos.y);
    } else if (e.button === 2) {
      // RMB = context actions (unchanged) + ground move still works
      const npc = this.pickEntityAtScreen(sx, sy, ['npc']);
      if (npc && npc.kind === 'npc' && npc.role === 'shop') {
        this.world.selectedId = npc.id;
        queueShopInteract(this.world, npc.id);
        return;
      }
      const enemy = this.pickEntityAtScreen(sx, sy, ['enemy']);
      if (enemy && enemy.kind === 'enemy') {
        queueHeroAttack(this.world, enemy.id);
        return;
      }
      const spot = this.pickEntityAtScreen(sx, sy, ['resourceNode']);
      if (
        spot &&
        spot.kind === 'resourceNode' &&
        spot.resource === 'fish' &&
        spot.remaining > 0 &&
        spot.replenishTimer <= 0
      ) {
        queueFish(this.world, spot.id);
        return;
      }
      // RMB ground → move / flee (same as LMB empty ground)
      commandAt(this.world, wpos.x, wpos.y);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 1 || e.button === 0) this.panning = false;
  }

  private onMouseMove(e: MouseEvent): void {
    const wpos = this.eventToWorld(e);
    this.world.hoverTile = { gx: Math.floor(wpos.x), gy: Math.floor(wpos.y) };

    // Entity under cursor for subtle interactable highlight (nodes, vendor, units, …)
    // Skip while placing a building — tile ghost already communicates intent.
    if (this.world.buildingPlacement) {
      this.world.hoverEntityId = null;
      this.canvas.style.cursor = 'crosshair';
    } else {
      const { sx, sy } = this.eventToCanvas(e);
      const picked = this.pickEntityAtScreen(sx, sy, [
        'hero',
        'worker',
        'base',
        'blacksmith',
        'npc',
        'enemy',
        'resourceNode',
        'loot',
      ]);
      // Only highlight loot piles that still have items
      if (picked && picked.kind === 'loot' && picked.items.length === 0) {
        this.world.hoverEntityId = null;
      } else {
        this.world.hoverEntityId = picked?.id ?? null;
      }
      this.canvas.style.cursor = this.world.hoverEntityId != null ? 'pointer' : 'default';
    }

    if (this.panning) {
      this.unlockCamera();
      const dx = e.clientX - this.lastPanX;
      const dy = e.clientY - this.lastPanY;
      this.renderer.panScreen(dx, dy);
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.clampCameraToHero();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    if (e.deltaMode === 2) delta *= rect.height;
    // Gentler steps; hard min/max live in Renderer.zoomAt (CONFIG.minZoom/maxZoom)
    const factor = delta > 0 ? 0.94 : 1.06;
    this.renderer.zoomAt(sx, sy, this.renderer.zoom * factor);
    this.clampCameraToHero();
    const wpos = this.renderer.screenToWorld(sx, sy);
    this.world.hoverTile = { gx: Math.floor(wpos.x), gy: Math.floor(wpos.y) };
  }
}
