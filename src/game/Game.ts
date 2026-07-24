import { CONFIG } from '../config';
import { Input } from '../input/Input';
import { Renderer } from '../render/Renderer';
import { advanceClock, processGameTick } from '../systems/GameTick';
import { updateMovement } from '../systems/Movement';
import { Hud } from '../ui/hud';
import { InventoryUi } from '../ui/inventory';
import { MapChrome } from '../ui/mapChrome';
import { ShopUi } from '../ui/shop';
import { World } from '../world/World';
import { updateExploration } from '../systems/Exploration';
import { updateShopInteract } from '../systems/ShopInteract';
import { canLogout } from '../systems/Combat';

export class Game {
  world = new World();
  renderer: Renderer;
  mapChrome: MapChrome;
  input: Input;
  hud: Hud;
  inventoryUi: InventoryUi;
  shopUi: ShopUi;
  private last = 0;
  private raf = 0;

  constructor(
    canvas: HTMLCanvasElement,
    minimapCanvas: HTMLCanvasElement,
    fullMapCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new Renderer(canvas);
    this.mapChrome = new MapChrome(this.world, minimapCanvas, fullMapCanvas);
    this.inventoryUi = new InventoryUi(this.world);
    this.shopUi = new ShopUi(this.world);
    this.input = new Input(canvas, this.world, this.renderer, {
      onToggleCharacter: () => this.inventoryUi.toggleCharacter(),
      onToggleBags: () => this.inventoryUi.toggleAllBags(),
    });
    this.hud = new Hud(
      this.world,
      () => this.restart(),
      () => this.save(),
      () => this.load(),
      () => this.input.toggleDevCameraUnlock(),
    );
    this.restart();
    window.addEventListener('resize', () => this.renderer.resize());
  }

  restart(): void {
    this.world.reset(42);
    this.renderer.resize();
    this.input.resetCameraFollow();
    this.input.applyCameraFollow();
    updateExploration(this.world);
    this.inventoryUi.close();
    this.shopUi.close();
  }

  save(): void {
    try {
      localStorage.setItem(CONFIG.saveKey, this.world.toJSON());
      this.world.message = 'Game saved.';
    } catch {
      this.world.message = 'Save failed.';
    }
  }

  load(): void {
    // Load = session escape / logout surrogate — blocked during combat lock
    if (!canLogout(this.world)) {
      const hero = this.world.hero();
      const left = hero?.combatLockTicks ?? 0;
      this.world.message = `Cannot log out while in combat (${left} ticks left).`;
      return;
    }
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) {
      this.world.message = 'No save found.';
      return;
    }
    if (this.world.fromJSON(raw)) {
      this.renderer.resize();
      this.input.resetCameraFollow();
      this.input.applyCameraFollow();
      this.inventoryUi.close();
      this.shopUi.close();
    }
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /**
   * Frame loop:
   * 1) input (free pan unlocks soft camera lock)
   * 2) continuous movement @ heroSpeed
   * 3) discrete game ticks: intents → combat → production (0.6s)
   * 4) soft camera follow on hero (if locked)
   * 5) render / HUD
   */
  private tick(dt: number): void {
    this.input.update(dt);

    if (!this.world.paused && this.world.status === 'playing') {
      const sim = dt * this.world.timeScale;
      updateMovement(this.world, sim);
      // Vendor approach after movement so range check is current
      const shopNpcId = updateShopInteract(this.world);
      if (shopNpcId != null) {
        const npc = this.world.get(shopNpcId);
        if (npc && npc.kind === 'npc') {
          this.shopUi.openShop(npc.name, npc.id, true);
        }
      }
      this.world.updateFloatTexts(sim);
      const n = advanceClock(this.world, sim);
      for (let i = 0; i < n; i++) {
        processGameTick(this.world);
      }
    }

    // After movement so follow tracks the hero; skipped when WASD/pan unlocked
    this.input.applyCameraFollow();

    // Dev cam: stream + fully mark chunks under the camera every frame so
    // panning reveals terrain without moving the hero.
    if (this.input.isDevCameraUnlocked()) {
      const look = this.renderer.screenToWorld(
        window.innerWidth / 2,
        window.innerHeight / 2,
      );
      updateExploration(this.world, { alsoAround: look });
    }

    this.shopUi.update();

    this.renderer.tickAlpha = 1;
    this.renderer.render(this.world);
    this.mapChrome.render();
    this.hud.update();
    this.inventoryUi.update();
  }
}
