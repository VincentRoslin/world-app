import { CONFIG } from '../config';
import type { WorkerJob } from '../core/types';
import type { World } from '../world/World';
import { setJobCommand, trainWorkerCommand } from '../systems/Commands';
import { addBaseUpgradeBuilder, addClosestBuilder, beginBlacksmithPlacement, canTrainWorker, canUpgradeBase, startBaseUpgrade } from '../systems/Production';

export class Hud {
  private world: World;
  private onRestart: () => void;
  private onSave: () => void;
  private onLoad: () => void;
  private stoneEl = el('stone');
  private woodEl = el('wood');
  private foodEl = el('food');
  private stoneIncomeEl = el('stone-income');
  private woodIncomeEl = el('wood-income');
  private foodIncomeEl = el('food-income');
  private exploreEl = el('explore-status');
  private titleEl = el('selection-title');
  private detailEl = el('selection-detail');
  private actionsEl = el('selection-actions');
  private panelEl = document.getElementById('panel')!;
  private overlay = document.getElementById('overlay')!;
  private overlayTitle = el('overlay-title');
  private overlayMsg = el('overlay-msg');
  private btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
  private btnSpeed = document.getElementById('btn-speed') as HTMLButtonElement;
  private panelKey = '';
  private buildTabWorkerId: number | null = null;

  constructor(world: World, onRestart: () => void, onSave: () => void, onLoad: () => void) {
    this.world = world;
    this.onRestart = onRestart;
    this.onSave = onSave;
    this.onLoad = onLoad;

    this.btnPause.addEventListener('click', () => {
      this.world.paused = !this.world.paused;
      this.btnPause.textContent = this.world.paused ? '▶' : '❚❚';
    });
    this.btnSpeed.addEventListener('click', () => {
      this.world.timeScale = this.world.timeScale === 1 ? 2 : this.world.timeScale === 2 ? 3 : 1;
      this.btnSpeed.textContent = `${this.world.timeScale}×`;
    });
    document.getElementById('btn-save')!.addEventListener('click', () => this.onSave());
    document.getElementById('btn-load')!.addEventListener('click', () => this.onLoad());
    document.getElementById('btn-restart')!.addEventListener('click', () => this.onRestart());

    this.actionsEl.addEventListener('click', (ev) => {
      const target = (ev.target as HTMLElement).closest(
        'button[data-action]',
      ) as HTMLButtonElement | null;
      if (!target) return;
      const action = target.dataset.action;
      if (!action) return;
      if (action === 'train') {
        trainWorkerCommand(this.world);
        this.panelKey = '';
        return;
      }
      if (action === 'job') {
        const job = target.dataset.job as WorkerJob;
        setJobCommand(this.world, job);
        this.panelKey = '';
        return;
      }
      if (action === 'build') {
        this.buildTabWorkerId = Number(target.dataset.workerId);
        this.panelKey = '';
        return;
      }
      if (action === 'build-back') {
        this.buildTabWorkerId = null;
        this.panelKey = '';
        return;
      }
      if (action === 'place-blacksmith') {
        const worker = this.world.get(Number(target.dataset.workerId));
        if (worker?.kind === 'worker') beginBlacksmithPlacement(this.world, worker);
        this.buildTabWorkerId = null;
        this.panelKey = '';
        return;
      }
      if (action === 'add-builder') {
        const building = this.world.get(Number(target.dataset.buildingId));
        if (building?.kind === 'blacksmith') addClosestBuilder(this.world, building);
        this.panelKey = '';
      }
      if (action === 'upgrade-base') {
        startBaseUpgrade(this.world);
        this.panelKey = '';
      }
      if (action === 'add-base-builder') {
        addBaseUpgradeBuilder(this.world);
        this.panelKey = '';
      }
    });
  }

  update(): void {
    const w = this.world;
    this.stoneEl.textContent = String(Math.floor(w.stockpile.stone));
    this.woodEl.textContent = String(Math.floor(w.stockpile.wood));
    this.foodEl.textContent = String(Math.floor(w.stockpile.food));

    this.setIncome(this.stoneIncomeEl, w.expectedIncome.stone);
    this.setIncome(this.woodIncomeEl, w.expectedIncome.wood);
    this.setIncome(this.foodIncomeEl, w.expectedIncome.food);

    const explored = w.explored.size;
    const loaded = w.tiles.size;
    this.exploreEl.textContent = `Explored ${explored} · Chunks ${w.loadedChunks.size} · Map ${loaded} tiles`;

    this.renderSelection();

    if (w.status === 'won' || w.status === 'lost') {
      this.overlay.classList.remove('hidden');
      this.overlayTitle.textContent = w.status === 'won' ? 'Victory!' : 'Defeat';
      this.overlayMsg.textContent = w.message;
    } else {
      this.overlay.classList.add('hidden');
    }
  }

  private setIncome(node: HTMLElement, amount: number): void {
    node.textContent = `+${Math.floor(amount)}`;
    node.classList.toggle('zero', amount <= 0);
  }

  private renderSelection(): void {
    const id = this.world.selectedId;
    const e = id != null ? this.world.get(id) : null;

    let key = 'none';
    if (e && e.alive) {
      if (e.kind === 'worker')
        key = `worker:${e.id}:${e.job}:${e.phase}:${Math.floor(e.gatherTimer)}:${e.carried}`;
      else if (e.kind === 'base')
        key = `base:${e.id}:${e.trainQueue}:${canTrainWorker(this.world) ? 1 : 0}:${Math.floor(e.trainTimer)}`;
      else if (e.kind === 'hero') key = `hero:${e.id}:${Math.ceil(e.hp)}`;
      else if (e.kind === 'enemy') key = `enemy:${e.id}:${e.aggressive}:${Math.ceil(e.hp)}`;
      else if (e.kind === 'resourceNode') key = `node:${e.id}:${e.resource}:${Math.floor(e.remaining)}`;
      else key = `${e.kind}:${e.id}`;
    }

    if (!e || !e.alive) {
      this.panelEl.classList.remove('hero-selected');
      this.titleEl.textContent = 'Nothing selected';
      this.detailEl.textContent = 'Click the hero, a worker, or your base.';
      if (this.panelKey !== key) {
        this.actionsEl.innerHTML = '';
        this.panelKey = key;
      }
      return;
    }

    if (e.kind === 'hero') {
      this.panelEl.classList.add('hero-selected');
      return;
    }

    this.panelEl.classList.remove('hero-selected');

    if (e.kind === 'worker') {
      const base = this.world.base();
      const blacksmithUnlocked = base && base.upgradeLevel >= 1;
      if (this.buildTabWorkerId === e.id) {
        this.titleEl.textContent = 'Build — Worker';
        this.detailEl.textContent = blacksmithUnlocked
          ? 'Choose a building, then click a clear 2×2 area on the map.'
          : 'Upgrade the Base first to unlock buildings.';
        const buildKey = `build-tab:${e.id}:${blacksmithUnlocked ? 1 : 0}`;
        if (this.panelKey !== buildKey) {
          this.actionsEl.innerHTML = '';
          if (blacksmithUnlocked) {
            const blacksmith = document.createElement('button');
            blacksmith.type = 'button'; blacksmith.className = 'primary';
            blacksmith.dataset.action = 'place-blacksmith'; blacksmith.dataset.workerId = String(e.id);
            blacksmith.textContent = 'Blacksmith (2×2)';
            this.actionsEl.appendChild(blacksmith);
          }
          const back = document.createElement('button');
          back.type = 'button'; back.dataset.action = 'build-back'; back.textContent = 'Back';
          this.actionsEl.appendChild(back);
          this.panelKey = buildKey;
        }
        return;
      }
      this.titleEl.textContent = `Worker (${e.job})`;
      const phaseLabel =
        e.phase === 'toWork'
          ? `Walking to work${e.slotIndex >= 0 ? ` (slot ${e.slotIndex + 1})` : ''}`
          : e.phase === 'gathering'
            ? `Gathering ${e.gatherTimer.toFixed(1)}s / ${CONFIG.resourceTickInterval}s · slot ${e.slotIndex + 1}`
            : e.phase === 'toBase'
              ? `Returning to base${e.carried > 0 ? ` (carrying ${e.carried})` : ''}`
              : e.phase === 'building'
                ? (e.constructionId != null && this.world.get(e.constructionId)?.kind === 'base' ? 'Upgrading base' : 'Constructing building')
              : 'Idle near base';
      this.detailEl.textContent = `HP ${Math.ceil(e.hp)}/${e.maxHp} · ${phaseLabel}`;
      const actionKey = `worker-btns:${e.id}:${e.job}`;
      if (this.panelKey !== actionKey) {
        this.actionsEl.innerHTML = '';
        for (const job of ['idle', 'mine', 'log', 'farm'] as const) {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.action = 'job';
          b.dataset.job = job;
          b.textContent = job[0]!.toUpperCase() + job.slice(1);
          if (e.job === job) b.classList.add('primary');
          this.actionsEl.appendChild(b);
        }
        const build = document.createElement('button');
        build.type = 'button'; build.dataset.action = 'build'; build.dataset.workerId = String(e.id);
        build.textContent = 'Build';
        this.actionsEl.appendChild(build);
        this.panelKey = actionKey;
      }
      return;
    }

    if (e.kind === 'base') {
      const queue = e.trainQueue > 0 ? ` · Training ${e.trainQueue} (${e.trainTimer.toFixed(1)}s)` : '';
      const upgradeLabel = e.upgrading
        ? ` · Upgrading Lv${e.upgradeLevel + 1} (${Math.floor((e.upgradeProgress / e.upgradeSeconds) * 100)}%)`
        : e.upgradeLevel > 0 ? ` · Level ${e.upgradeLevel}` : '';
      this.titleEl.textContent = 'Base (Home)';
      this.detailEl.textContent = `HP ${Math.ceil(e.hp)}/${e.maxHp} · Workers ${this.world.workerCount()}/${CONFIG.maxWorkers}${queue}${upgradeLabel}`;
      const baseKey = `base:${e.id}:${e.trainQueue}:${canTrainWorker(this.world) ? 1 : 0}:${Math.floor(e.trainTimer)}:${e.upgradeLevel}:${e.upgrading}:${Math.floor(e.upgradeProgress)}:${e.upgradeBuilderIds.length}`;
      if (this.panelKey !== baseKey) {
        this.actionsEl.innerHTML = '';
        const train = document.createElement('button');
        train.type = 'button';
        train.className = 'primary';
        train.dataset.action = 'train';
        train.textContent = `Train Worker (${CONFIG.workerTrainStone}s + ${CONFIG.workerTrainFood}f)`;
        train.disabled = !canTrainWorker(this.world);
        this.actionsEl.appendChild(train);

        if (e.upgradeLevel < CONFIG.baseMaxLevel) {
          if (e.upgrading) {
            const eta = Math.ceil((e.upgradeSeconds - e.upgradeProgress) / Math.max(1, e.upgradeBuilderIds.length));
            const addBuilder = document.createElement('button');
            addBuilder.type = 'button'; addBuilder.className = 'primary';
            addBuilder.dataset.action = 'add-base-builder';
            addBuilder.textContent = `Add Idle Worker (${e.upgradeBuilderIds.length} building · ~${eta}s)`;
            this.actionsEl.appendChild(addBuilder);
          } else {
            const upgrade = document.createElement('button');
            upgrade.type = 'button';
            upgrade.dataset.action = 'upgrade-base';
            upgrade.textContent = `Upgrade Base (${CONFIG.baseUpgradeStone}s + ${CONFIG.baseUpgradeWood}w + ${CONFIG.baseUpgradeFood}f)`;
            upgrade.disabled = !canUpgradeBase(this.world);
            this.actionsEl.appendChild(upgrade);
          }
        }

        this.panelKey = baseKey;
      }
      return;
    }

    if (e.kind === 'blacksmith') {
      const pct = Math.floor((e.buildProgress / e.buildSeconds) * 100);
      const eta = Math.ceil((e.buildSeconds - e.buildProgress) / Math.max(1, e.builderIds.length));
      this.titleEl.textContent = e.completed ? 'Blacksmith' : 'Blacksmith (Construction)';
      this.detailEl.textContent = e.completed
        ? 'Ready for smithing.'
        : `${pct}% complete · ${e.builderIds.length} builder${e.builderIds.length === 1 ? '' : 's'} · ~${eta}s remaining`;
      const smithKey = `blacksmith:${e.id}:${pct}:${e.builderIds.length}:${e.completed}`;
      if (this.panelKey !== smithKey) {
        this.actionsEl.innerHTML = '';
        if (!e.completed) {
          const add = document.createElement('button');
          add.type = 'button'; add.className = 'primary'; add.dataset.action = 'add-builder'; add.dataset.buildingId = String(e.id);
          add.textContent = 'Add Idle Worker'; this.actionsEl.appendChild(add);
        }
        this.panelKey = smithKey;
      }
      return;
    }

    if (e.kind === 'npc') {
      this.titleEl.textContent = e.name;
      this.detailEl.textContent =
        e.role === 'shop'
          ? 'Test Vendor — RMB to open free shop (dev).'
          : 'Friendly NPC.';
      if (this.panelKey !== key) {
        this.actionsEl.innerHTML = '';
        this.panelKey = key;
      }
      return;
    }

    if (e.kind === 'enemy') {
      const name =
        e.species === 'cow' ? 'Cow' : e.species === 'human' ? 'Human' : 'Goblin';
      const role =
        e.fightRole === 'front' ? 'fighting' : e.fightRole === 'waiting' ? 'waiting' : 'idle';
      this.titleEl.textContent = name;
      this.detailEl.textContent = `HP ${Math.ceil(e.hp)}/${e.maxHp} · ${role} · Max hit ${e.damage}`;
      if (this.panelKey !== key) {
        this.actionsEl.innerHTML = '';
        this.panelKey = key;
      }
      return;
    }

    if (e.kind === 'resourceNode') {
      const resName = e.resource === 'stone' ? 'Stone Deposit' : e.resource === 'wood' ? 'Forest' : e.resource === 'fish' ? 'Fishing Spot' : 'Farm';
      const remaining = e.remaining;
      const max = e.maxRemaining > 0 ? e.maxRemaining : CONFIG.nodeCapacity;
      const pct = Math.floor((remaining / max) * 100);
      this.titleEl.textContent = resName;
      this.detailEl.textContent = `Remaining: ${Math.floor(remaining)}/${max} (${pct}%) · ${CONFIG.maxWorkersPerNode} workers max`;
      if (this.panelKey !== key) {
        this.actionsEl.innerHTML = '';
        this.panelKey = key;
      }
      return;
    }

    this.titleEl.textContent = e.kind;
    this.detailEl.textContent = `HP ${Math.ceil(e.hp)}/${e.maxHp}`;
    if (this.panelKey !== key) {
      this.actionsEl.innerHTML = '';
      this.panelKey = key;
    }
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}
