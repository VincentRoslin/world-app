import type { Renderer } from '../render/Renderer';
import type { World } from '../world/World';
import type { Entity } from '../core/types';
import { commandAt, queueFish, queueHeroAttack, queueShopInteract, selectAt } from '../systems/Commands';
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

  update(dt: number): void {
    // The inventory is an overlay, not a modal game state. Keep camera controls
    // available while comparing equipment or managing bags.
    const panSpeed = 420 / this.renderer.zoom;
    const panUp = this.keys.has('w') || this.keys.has('arrowup');
    const panDown = this.keys.has('s') || this.keys.has('arrowdown');
    const panLeft = this.keys.has('a') || this.keys.has('arrowleft');
    const panRight = this.keys.has('d') || this.keys.has('arrowright');
    if (panUp || panDown || panLeft || panRight) {
      // Soft unlock: free look while panning
      this.unlockCamera();
      if (panUp) this.renderer.cameraY += panSpeed * dt;
      if (panDown) this.renderer.cameraY -= panSpeed * dt;
      if (panLeft) this.renderer.cameraX += panSpeed * dt;
      if (panRight) this.renderer.cameraX -= panSpeed * dt;
    }
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
   * Screen-space pick: sprites draw upward from the foot tile, so world unproject
   * from a body-click lands on the wrong tile. Score each candidate by distance
   * to its projected foot + vertical body hit-box (species-aware).
   */
  private pickEntityAtScreen(
    sx: number,
    sy: number,
    kinds: Entity['kind'][],
  ): Entity | null {
    const z = this.renderer.zoom;
    let best: Entity | null = null;
    let bestScore = Infinity;

    for (const e of this.world.entities.values()) {
      if (!e.alive) continue;
      if (!kinds.includes(e.kind)) continue;
      if (e.kind === 'enemy' || e.kind === 'resourceNode') {
        if (!this.world.isExplored(Math.floor(e.x), Math.floor(e.y))) continue;
      }

      const foot = this.renderer.worldToScreen(e.x, e.y);
      const footY = foot.y + CONFIG.entityDrawYOffset * z;

      let halfW = 14 * z;
      let heightUp = 28 * z;
      let heightDown = 8 * z;

      if (e.kind === 'enemy') {
        if (e.species === 'cow') {
          halfW = 16 * z;
          heightUp = 18 * z;
          heightDown = 10 * z;
        } else if (e.species === 'goblin') {
          halfW = 14 * z;
          heightUp = 26 * z;
          heightDown = 10 * z;
        } else {
          halfW = 12 * z;
          heightUp = 36 * z;
          heightDown = 8 * z;
        }
      } else if (e.kind === 'hero') {
        halfW = 12 * z;
        heightUp = 36 * z;
      } else if (e.kind === 'npc') {
        halfW = 12 * z;
        heightUp = 36 * z;
      } else if (e.kind === 'worker') {
        halfW = 11 * z;
        heightUp = 28 * z;
      } else if (e.kind === 'base') {
        halfW = 40 * z;
        heightUp = 50 * z;
        heightDown = 20 * z;
      } else if (e.kind === 'blacksmith') {
        halfW = 38 * z;
        heightUp = 42 * z;
        heightDown = 18 * z;
      } else if (e.kind === 'resourceNode') {
        halfW = 16 * z;
        heightUp = 30 * z;
      } else if (e.kind === 'loot') {
        halfW = 12 * z;
        heightUp = 16 * z;
        heightDown = 8 * z;
      }

      const dx = sx - foot.x;
      const above = footY - sy;
      if (Math.abs(dx) > halfW) continue;
      if (above < -heightDown || above > heightUp) continue;

      const bodyCenterY = footY - heightUp * 0.45;
      const dy = sy - bodyCenterY;
      const score = dx * dx + dy * dy * 0.65;
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
      if (this.world.buildingPlacement) {
        placeBlacksmith(this.world, gx, gy);
        return;
      }
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
          picked.kind === 'resourceNode')
      ) {
        this.world.selectedId = picked.id;
      } else {
        selectAt(this.world, gx, gy, wpos.x, wpos.y);
      }
    } else if (e.button === 2) {
      // RMB shop NPC → walk into range then open (like attack/fish)
      const npc = this.pickEntityAtScreen(sx, sy, ['npc']);
      if (npc && npc.kind === 'npc' && npc.role === 'shop') {
        this.world.selectedId = npc.id;
        queueShopInteract(this.world, npc.id);
        return;
      }
      // RMB on mob → queue attack for next game tick
      const enemy = this.pickEntityAtScreen(sx, sy, ['enemy']);
      if (enemy && enemy.kind === 'enemy') {
        queueHeroAttack(this.world, enemy.id);
        return;
      }
      // RMB fishing spot → queue fish
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
      // RMB ground → queue walk / flee for next tick
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
      this.renderer.cameraX += dx;
      this.renderer.cameraY += dy;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
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
    const factor = delta > 0 ? 0.9 : 1.1;
    this.renderer.zoomAt(sx, sy, this.renderer.zoom * factor);
    const wpos = this.renderer.screenToWorld(sx, sy);
    this.world.hoverTile = { gx: Math.floor(wpos.x), gy: Math.floor(wpos.y) };
  }
}
