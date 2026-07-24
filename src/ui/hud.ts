import { CONFIG } from '../config';
import type { Worker, WorkerJob, WorkerPhase } from '../core/types';
import type { World } from '../world/World';
import { setJobCommand, trainWorkerCommand } from '../systems/Commands';
import {
  addBaseUpgradeBuilder,
  addClosestBuilder,
  baseUpgradeCost,
  beginBlacksmithPlacement,
  canTrainWorker,
  canUpgradeBase,
  maxWorkersAllowed,
  startBaseUpgrade,
  workerTrainCost,
} from '../systems/Production';

/** Job button labels + native title tooltips (what the work does). */
const JOB_UI: Record<
  WorkerJob,
  { label: string; title: string }
> = {
  idle: {
    label: 'Idle',
    title: 'Unassign this worker. No job, no food upkeep. Free to reassign later.',
  },
  mine: {
    label: 'Mine',
    title:
      'Gather stone from deposits and haul it to the base. Uses food while working. Used for training workers and base upgrades.',
  },
  log: {
    label: 'Log',
    title:
      'Gather wood from forests and haul it to the base. Uses food while working. Used for base upgrades and future building/crafting.',
  },
  farm: {
    label: 'Farm',
    title:
      'Gather food from oat fields and haul it to the base. Uses food while working, but is the main way to restock the larder — other jobs pause when food runs out.',
  },
  build: {
    label: 'Build',
    title: 'Help construct buildings or base upgrades. Uses food while working.',
  },
};

function workerPhaseShort(phase: WorkerPhase, w: Worker): string {
  if (phase === 'toWork') return 'To work';
  if (phase === 'gathering') return 'Gathering';
  if (phase === 'toBase') return w.carried > 0 ? `Haul ${w.carried}` : 'To base';
  if (phase === 'building') return 'Building';
  if (phase === 'waiting') return 'Waiting…';
  if (phase === 'starving') return 'No food';
  return 'Idle';
}

function workerPhaseDetail(w: Worker): string {
  if (w.phase === 'toWork')
    return `Walking to work${w.slotIndex >= 0 ? ` (slot ${w.slotIndex + 1})` : ''}`;
  if (w.phase === 'gathering')
    return `Gathering ${w.gatherTimer.toFixed(1)}s / ${CONFIG.resourceTickInterval}s · slot ${w.slotIndex + 1}`;
  if (w.phase === 'toBase')
    return `Returning to base${w.carried > 0 ? ` (carrying ${w.carried} ${w.carriedResource ?? ''})` : ''}`;
  if (w.phase === 'building') {
    return 'Constructing / upgrading';
  }
  if (w.phase === 'waiting') return 'Waiting for resources… zzz';
  if (w.phase === 'starving') return 'No food — paused… zzz';
  return 'Standing by (no job · no food cost)';
}

export class Hud {
  private world: World;
  private onRestart: () => void;
  private onSave: () => void;
  private onLoad: () => void;
  private onDevCam?: () => boolean;
  private stoneEl = el('stone');
  private woodEl = el('wood');
  private foodEl = el('food');
  private stoneIncomeEl = el('stone-income');
  private woodIncomeEl = el('wood-income');
  private foodIncomeEl = el('food-income');
  private exploreEl = el('explore-status');
  private combatLockEl = el('combat-lock');
  private titleEl = el('selection-title');
  private detailEl = el('selection-detail');
  private actionsEl = el('selection-actions');
  private panelEl = document.getElementById('panel')!;
  private overlay = document.getElementById('overlay')!;
  private overlayTitle = el('overlay-title');
  private overlayMsg = el('overlay-msg');
  private btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
  private pauseOverlay = document.getElementById('pause-overlay')!;
  private rosterCountEl = el('worker-roster-count');
  private rosterSummaryEl = el('worker-roster-summary');
  private rosterListEl = el('worker-roster-list');
  private panelKey = '';
  private rosterKey = '';
  private buildTabWorkerId: number | null = null;

  constructor(
    world: World,
    onRestart: () => void,
    onSave: () => void,
    onLoad: () => void,
    onDevCam?: () => boolean,
  ) {
    this.world = world;
    this.onRestart = onRestart;
    this.onSave = onSave;
    this.onLoad = onLoad;
    this.onDevCam = onDevCam;

    this.btnPause.addEventListener('click', () => {
      this.world.paused = !this.world.paused;
      this.syncPauseUi();
    });
    document.getElementById('btn-save')!.addEventListener('click', () => this.onSave());
    document.getElementById('btn-load')!.addEventListener('click', () => this.onLoad());
    document.getElementById('btn-restart')!.addEventListener('click', () => this.onRestart());
    const devCam = document.getElementById('btn-dev-cam') as HTMLButtonElement | null;
    if (devCam && this.onDevCam) {
      devCam.addEventListener('click', () => {
        const on = this.onDevCam!();
        devCam.classList.toggle('dev-on', on);
        devCam.title = on
          ? 'Dev cam ON — click to restore camera leash'
          : 'Dev: unlock camera leash (temporary)';
      });
    }

    this.rosterListEl.addEventListener('click', (ev) => {
      const row = (ev.target as HTMLElement).closest('[data-select-worker]') as HTMLElement | null;
      if (!row) return;
      const id = Number(row.dataset.selectWorker);
      if (Number.isNaN(id)) return;
      this.world.selectedId = id;
      this.buildTabWorkerId = null;
      this.panelKey = '';
    });

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

    const loaded = w.tiles.size;
    this.exploreEl.textContent = `Chunks ${w.loadedChunks.size} · Map ${loaded} tiles`;

    const hero = w.hero();
    const lock = hero && hero.alive ? hero.combatLockTicks : 0;
    if (lock > 0) {
      this.combatLockEl.classList.remove('hidden');
      this.combatLockEl.textContent = `Combat ${lock}`;
      this.combatLockEl.title = `Combat lock — ${lock} ticks left (logout blocked until 0)`;
    } else {
      this.combatLockEl.classList.add('hidden');
      this.combatLockEl.textContent = 'Combat —';
    }

    this.renderWorkerRoster();
    this.renderSelection();
    this.syncPauseUi();

    if (w.status === 'won' || w.status === 'lost') {
      this.overlay.classList.remove('hidden');
      this.overlayTitle.textContent = w.status === 'won' ? 'Victory!' : 'Defeat';
      this.overlayMsg.textContent = w.message;
    } else {
      this.overlay.classList.add('hidden');
    }
  }

  private syncPauseUi(): void {
    const paused = this.world.paused && this.world.status === 'playing';
    this.btnPause.textContent = paused ? 'Play' : 'Pause';
    this.btnPause.title = paused ? 'Resume' : 'Pause';
    this.pauseOverlay.classList.toggle('hidden', !paused);
    this.pauseOverlay.setAttribute('aria-hidden', paused ? 'false' : 'true');
  }

  private setIncome(node: HTMLElement, amount: number): void {
    const n = Math.floor(amount);
    // Food can go negative once upkeep > farm output
    node.textContent = n > 0 ? `+${n}` : n < 0 ? `${n}` : '+0';
    node.classList.toggle('zero', n === 0);
    node.classList.toggle('neg', n < 0);
  }

  /** Left roster: totals, job breakdown, per-worker status (click to select). */
  private renderWorkerRoster(): void {
    const workers: Worker[] = [];
    for (const e of this.world.entities.values()) {
      if (e.alive && e.kind === 'worker') workers.push(e);
    }

    const cap = maxWorkersAllowed(this.world);
    const counts: Record<WorkerJob, number> = {
      idle: 0,
      mine: 0,
      log: 0,
      farm: 0,
      build: 0,
    };
    for (const w of workers) counts[w.job] += 1;

    workers.sort((a, b) => a.rosterNo - b.rosterNo || a.id - b.id);

    const key =
      `${workers.length}/${cap}|` +
      workers
        .map(
          (w) =>
            `${w.id}:${w.rosterNo}:${w.job}:${w.phase}:${w.carried}:${this.world.selectedId === w.id ? 1 : 0}`,
        )
        .join(',');
    if (key === this.rosterKey) return;
    this.rosterKey = key;

    this.rosterCountEl.textContent = `${workers.length}/${cap}`;
    this.rosterCountEl.title = `Living workers / cap (cap rises when you upgrade the base)`;

    const chips: { job: WorkerJob; label: string }[] = [
      { job: 'idle', label: 'Idle' },
      { job: 'mine', label: 'Mine' },
      { job: 'log', label: 'Log' },
      { job: 'farm', label: 'Farm' },
      { job: 'build', label: 'Build' },
    ];
    this.rosterSummaryEl.innerHTML = chips
      .filter((c) => counts[c.job] > 0 || c.job === 'idle')
      .map(
        (c) =>
          `<span class="worker-sum-chip ${c.job}" title="${JOB_UI[c.job].title}"><i></i>${c.label} ${counts[c.job]}</span>`,
      )
      .join('');

    if (workers.length === 0) {
      this.rosterListEl.innerHTML = `<div class="worker-roster-empty">No workers yet — train some at the Base.</div>`;
      return;
    }

    this.rosterListEl.innerHTML = workers
      .map((w) => {
        const selected = this.world.selectedId === w.id ? ' selected' : '';
        const phaseClass =
          w.phase === 'starving' ? ' starving' : w.phase === 'waiting' ? ' waiting' : '';
        const phase = workerPhaseShort(w.phase, w);
        const tip = `Worker #${w.rosterNo} · ${w.job} · ${workerPhaseDetail(w)}`;
        return `<button type="button" class="worker-roster-row${selected}${phaseClass}" data-select-worker="${w.id}" title="${tip}">
          <span class="wr-id">#${w.rosterNo}</span>
          <span class="wr-job ${w.job}">${w.job}</span>
          <span class="wr-phase">${phase}</span>
        </button>`;
      })
      .join('');
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
      this.detailEl.textContent = 'LMB select · LMB ground to move · RMB attack / shop / fish.';
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
      this.titleEl.textContent = `Worker #${e.rosterNo} · ${e.job}`;
      this.detailEl.textContent = `HP ${Math.ceil(e.hp)}/${e.maxHp} · ${workerPhaseDetail(e)}`;
      const actionKey = `worker-btns:${e.id}:${e.rosterNo}:${e.job}:${e.phase}`;
      if (this.panelKey !== actionKey) {
        this.actionsEl.innerHTML = '';
        for (const job of ['idle', 'mine', 'log', 'farm'] as const) {
          const meta = JOB_UI[job];
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.action = 'job';
          b.dataset.job = job;
          b.textContent = meta.label;
          b.title = meta.title;
          if (e.job === job) b.classList.add('primary');
          this.actionsEl.appendChild(b);
        }
        const build = document.createElement('button');
        build.type = 'button';
        build.dataset.action = 'build';
        build.dataset.workerId = String(e.id);
        build.textContent = 'Build';
        build.title =
          'Open the build menu — place a Blacksmith (needs Base level 1+) or assign construction work. Uses food while building.';
        this.actionsEl.appendChild(build);
        this.panelKey = actionKey;
      }
      return;
    }

    if (e.kind === 'base') {
      const queue = e.trainQueue > 0 ? ` · Training ${e.trainQueue} (${e.trainTimer.toFixed(1)}s)` : '';
      const upgradeLabel = e.upgrading
        ? ` · Upgrading Lv${e.upgradeLevel + 1} (${Math.floor((e.upgradeProgress / e.upgradeSeconds) * 100)}%)`
        : e.upgradeLevel > 0
          ? ` · Level ${e.upgradeLevel}`
          : '';
      const cap = maxWorkersAllowed(this.world);
      const trainCost = workerTrainCost(this.world);
      const upCost = baseUpgradeCost(this.world);
      this.titleEl.textContent = 'Base (Home)';
      this.detailEl.textContent = `HP ${Math.ceil(e.hp)}/${e.maxHp} · Workers ${this.world.workerCount()}/${cap}${queue}${upgradeLabel}`;
      const baseKey = `base:${e.id}:${e.trainQueue}:${canTrainWorker(this.world) ? 1 : 0}:${Math.floor(e.trainTimer)}:${e.upgradeLevel}:${e.upgrading}:${Math.floor(e.upgradeProgress)}:${e.upgradeBuilderIds.length}:${cap}:${trainCost.stone}:${trainCost.food}:${upCost.stone}`;
      if (this.panelKey !== baseKey) {
        this.actionsEl.innerHTML = '';
        const train = document.createElement('button');
        train.type = 'button';
        train.className = 'primary';
        train.dataset.action = 'train';
        train.textContent = `Train Worker (${trainCost.stone}s + ${trainCost.food}f)`;
        train.title = `Scales with workforce · cap ${cap} (upgrade base for more)`;
        train.disabled = !canTrainWorker(this.world);
        this.actionsEl.appendChild(train);

        if (e.upgradeLevel < CONFIG.baseMaxLevel) {
          if (e.upgrading) {
            const eta = Math.ceil(
              (e.upgradeSeconds - e.upgradeProgress) / Math.max(1, e.upgradeBuilderIds.length),
            );
            const addBuilder = document.createElement('button');
            addBuilder.type = 'button';
            addBuilder.className = 'primary';
            addBuilder.dataset.action = 'add-base-builder';
            addBuilder.textContent = `Add Idle Worker (${e.upgradeBuilderIds.length} building · ~${eta}s)`;
            this.actionsEl.appendChild(addBuilder);
          } else {
            const upgrade = document.createElement('button');
            upgrade.type = 'button';
            upgrade.dataset.action = 'upgrade-base';
            upgrade.textContent = `Upgrade Base (${upCost.stone}s + ${upCost.wood}w + ${upCost.food}f)`;
            upgrade.title = `→ Level ${e.upgradeLevel + 1} · raises worker cap to ${Math.min(CONFIG.maxWorkers, CONFIG.maxWorkersBase + (e.upgradeLevel + 1) * CONFIG.maxWorkersPerBaseLevel)}`;
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
          ? 'Ebbe Greyho — RMB to walk over and open free shop.'
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
      const resName =
        e.resource === 'stone'
          ? 'Stone Deposit'
          : e.resource === 'wood'
            ? 'Forest'
            : e.resource === 'fish'
              ? 'Fishing Spot'
              : 'Oat Field';
      const remaining = e.remaining;
      const max = e.maxRemaining > 0 ? e.maxRemaining : CONFIG.nodeCapacity;
      const pct = Math.floor((remaining / max) * 100);
      this.titleEl.textContent = resName;
      const regen =
        e.replenishTimer > 0
          ? ` · Respawning nearby in ${Math.ceil(e.replenishTimer)}s`
          : '';
      this.detailEl.textContent = `Remaining: ${Math.floor(remaining)}/${max} (${pct}%) · ${CONFIG.maxWorkersPerNode} workers max${regen}`;
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
