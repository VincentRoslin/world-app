import { CONFIG } from '../config';
import { Input } from '../input/Input';
import { Minimap } from '../render/Minimap';
import { Renderer } from '../render/Renderer';
import { advanceClock, processGameTick } from '../systems/GameTick';
import { updateMovement } from '../systems/Movement';
import { Hud } from '../ui/hud';
import { InventoryUi } from '../ui/inventory';
import { ShopUi } from '../ui/shop';
import { World } from '../world/World';
import { updateExploration } from '../systems/Exploration';

export class Game {
  world = new World();
  renderer: Renderer;
  minimap: Minimap;
  input: Input;
  hud: Hud;
  inventoryUi: InventoryUi;
  shopUi: ShopUi;
  private last = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, minimapCanvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.minimap = new Minimap(minimapCanvas);
    this.inventoryUi = new InventoryUi(this.world);
    this.shopUi = new ShopUi(this.world);
    this.input = new Input(canvas, this.world, this.renderer, {
      onToggleCharacter: () => this.inventoryUi.toggleCharacter(),
      onToggleBags: () => this.inventoryUi.toggleAllBags(),
      onOpenShop: (name) => this.shopUi.openShop(name),
    });
    this.hud = new Hud(
      this.world,
      () => this.restart(),
      () => this.save(),
      () => this.load(),
    );
    this.restart();
    window.addEventListener('resize', () => this.renderer.resize());
  }

  restart(): void {
    this.world.reset(42);
    this.renderer.resize();
    const base = this.world.base();
    if (base) this.renderer.centerOn(base.x, base.y);
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
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) {
      this.world.message = 'No save found.';
      return;
    }
    if (this.world.fromJSON(raw)) {
      this.renderer.resize();
      const base = this.world.base();
      if (base) this.renderer.centerOn(base.x, base.y);
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
   * 1) input (camera + queue intents)
   * 2) continuous movement @ heroSpeed
   * 3) discrete game ticks: intents → combat → production (0.6s)
   * 4) render / HUD
   */
  private tick(dt: number): void {
    this.input.update(dt);

    if (!this.world.paused && this.world.status === 'playing') {
      const sim = dt * this.world.timeScale;
      updateMovement(this.world, sim);
      this.world.updateFloatTexts(sim);
      const n = advanceClock(this.world, sim);
      for (let i = 0; i < n; i++) {
        processGameTick(this.world);
      }
    }

    this.renderer.tickAlpha = 1;
    this.renderer.render(this.world);
    this.minimap.render(this.world);
    this.hud.update();
    this.inventoryUi.update();
  }
}
