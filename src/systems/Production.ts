import { CONFIG } from '../config';
import { dist } from '../core/math';
import type { BaseBuilding, BlacksmithBuilding, ResourceKind, ResourceNode, Stockpile, Worker, WorkerJob } from '../core/types';
import type { World } from '../world/World';
import { issueGather, issueMove } from './Movement';

export function canTrainWorker(world: World): boolean {
  if (world.workerCount() + (world.base()?.trainQueue ?? 0) >= CONFIG.maxWorkers) return false;
  return (
    world.stockpile.stone >= CONFIG.workerTrainStone &&
    world.stockpile.food >= CONFIG.workerTrainFood
  );
}

export function canUpgradeBase(world: World): boolean {
  const base = world.base();
  if (!base || !base.alive) return false;
  if (base.upgradeLevel >= CONFIG.baseMaxLevel) return false;
  if (base.upgrading) return false;
  return (
    world.stockpile.stone >= CONFIG.baseUpgradeStone &&
    world.stockpile.wood >= CONFIG.baseUpgradeWood &&
    world.stockpile.food >= CONFIG.baseUpgradeFood
  );
}

export function startBaseUpgrade(world: World): boolean {
  const base = world.base();
  if (!base || !base.alive) return false;
  if (!canUpgradeBase(world)) return false;
  world.stockpile.stone -= CONFIG.baseUpgradeStone;
  world.stockpile.wood -= CONFIG.baseUpgradeWood;
  world.stockpile.food -= CONFIG.baseUpgradeFood;
  base.upgrading = true;
  base.upgradeProgress = 0;
  base.upgradeSeconds = CONFIG.baseUpgradeSeconds;
  base.upgradeBuilderIds = [];
  world.message = 'Base upgrade started.';
  return true;
}

export function addBaseUpgradeBuilder(world: World): boolean {
  const base = world.base();
  if (!base || !base.alive || !base.upgrading) return false;
  if (base.upgradeProgress >= base.upgradeSeconds) return false;
  let best: Worker | null = null;
  let bestD = Infinity;
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'worker' || e.job !== 'idle') continue;
    const d = (e.x - base.x) ** 2 + (e.y - base.y) ** 2;
    if (d < bestD) { best = e; bestD = d; }
  }
  if (!best) { world.message = 'No idle worker available.'; return false; }
  best.job = 'build';
  best.phase = 'building';
  best.constructionId = base.id;
  const origin = world.baseFootprintOrigin();
  if (origin) {
    const stand = world.constructionStandForBase(origin.gx, origin.gy, base.upgradeBuilderIds.length);
    if (stand) issueMove(world, best, stand.x, stand.y);
  }
  base.upgradeBuilderIds.push(best.id);
  world.message = 'Worker joined base upgrade.';
  return true;
}

export function queueTrainWorker(world: World): boolean {
  const base = world.base();
  if (!base || !base.alive) return false;
  if (!canTrainWorker(world)) return false;
  world.stockpile.stone -= CONFIG.workerTrainStone;
  world.stockpile.food -= CONFIG.workerTrainFood;
  base.trainQueue += 1;
  if (base.trainTimer <= 0) base.trainTimer = CONFIG.workerTrainTime;
  return true;
}

/**
 * Assign job and send worker to a free slot on the best matching resource node.
 */
export function assignWorkerJob(world: World, worker: Worker, job: WorkerJob): boolean {
  leaveConstruction(world, worker);
  clearWorkClaim(worker);
  worker.job = job;
  worker.gatherTimer = 0;
  worker.carried = 0;
  worker.carriedResource = null;

  if (job === 'idle') {
    // Player chose Idle — stop work and stay put (free to move afterward).
    worker.job = 'idle';
    worker.phase = 'idle';
    clearWorkClaim(worker);
    worker.gatherTimer = 0;
    worker.order = { type: 'none' };
    return true;
  }

  const resource = world.resourceForJob(job);
  if (!resource) return false;

  const found = world.findWorkNode(worker.x, worker.y, resource);
  if (!found) {
    world.message = `No free ${resource} work available.`;
    sendIdleNearBase(world, worker);
    return false;
  }

  claimNode(worker, found.node, found.slot);
  worker.phase = 'toWork';
  issueGather(worker, found.node.id);
  world.message = '';
  return true;
}

/** Advance production by one game tick (seconds-based timers decrement by gameTickSec). */
export function updateProductionOnTick(world: World): void {
  const dt = CONFIG.gameTickSec;
  updateNodeReplenish(world, dt);

  const base = world.base();
  if (base && base.alive && base.trainQueue > 0) {
    base.trainTimer -= dt;
    if (base.trainTimer <= 0) {
      base.trainQueue -= 1;
      const pos = world.findClearSpawnNearBase();
      world.createWorker(pos.x, pos.y);
      base.trainTimer = base.trainQueue > 0 ? CONFIG.workerTrainTime : 0;
    }
  }

  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'worker') continue;
    updateWorkerCycle(world, e, dt);
  }

  updateConstruction(world, dt);
  updateBaseUpgrade(world, dt);

  world.expectedIncome = computeExpectedIncome(world);
}

export function beginBlacksmithPlacement(world: World, worker: Worker): void {
  if (!worker.alive || worker.job === 'build') return;
  const base = world.base();
  if (!base || base.upgradeLevel < 1) {
    world.message = 'Upgrade the Base first to unlock the Blacksmith.';
    return;
  }
  world.buildingPlacement = { workerId: worker.id, kind: 'blacksmith' };
  world.message = 'Choose a clear 2×2 area for the Blacksmith.';
}

export function placeBlacksmith(world: World, gx: number, gy: number): boolean {
  const placement = world.buildingPlacement;
  const worker = placement ? world.get(placement.workerId) : null;
  if (!placement || !worker || worker.kind !== 'worker' || !worker.alive) return false;
  const building = world.createBlacksmith(gx, gy, worker.id);
  if (!building) {
    world.message = 'Blacksmith needs four clear tiles without scenery, work, or buildings.';
    return false;
  }
  assignWorkerToConstruction(world, worker, building);
  world.buildingPlacement = null;
  world.selectedId = building.id;
  world.message = 'Blacksmith construction started.';
  return true;
}

export function addClosestBuilder(world: World, building: BlacksmithBuilding): boolean {
  if (building.completed) return false;
  let best: Worker | null = null;
  let bestD = Infinity;
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'worker' || e.job !== 'idle') continue;
    const d = (e.x - building.x) ** 2 + (e.y - building.y) ** 2;
    if (d < bestD) { best = e; bestD = d; }
  }
  if (!best) { world.message = 'No idle worker is available to help build.'; return false; }
  building.builderIds.push(best.id);
  assignWorkerToConstruction(world, best, building);
  world.message = 'A worker joined the construction.';
  return true;
}

function assignWorkerToConstruction(world: World, worker: Worker, building: BlacksmithBuilding): void {
  clearWorkClaim(worker);
  worker.job = 'build';
  worker.phase = 'building';
  worker.constructionId = building.id;
  const stand = world.constructionStand(building, worker.id);
  if (stand) issueMove(world, worker, stand.x, stand.y);
}

function leaveConstruction(world: World, worker: Worker): void {
  if (!worker.constructionId) return;
  const building = world.get(worker.constructionId);
  if (building && building.kind === 'blacksmith') {
    building.builderIds = building.builderIds.filter((id) => id !== worker.id);
  }
  if (building && building.kind === 'base') {
    building.upgradeBuilderIds = building.upgradeBuilderIds.filter((id) => id !== worker.id);
  }
  worker.constructionId = null;
}

function updateConstruction(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'blacksmith' || e.completed) continue;
    e.builderIds = e.builderIds.filter((id) => {
      const w = world.get(id);
      return !!w && w.kind === 'worker' && w.alive && w.constructionId === e.id;
    });
    let active = 0;
    for (const id of e.builderIds) {
      const worker = world.get(id);
      if (!worker || worker.kind !== 'worker') continue;
      const stand = world.constructionStand(e, worker.id);
      if (!stand) continue;
      if (dist(worker.x, worker.y, stand.x, stand.y) <= 0.5) {
        worker.x = stand.x; worker.y = stand.y; worker.order = { type: 'none' }; active++;
      } else if (worker.order.type !== 'move') issueMove(world, worker, stand.x, stand.y);
    }
    e.buildProgress = Math.min(e.buildSeconds, e.buildProgress + dt * active);
    if (e.buildProgress >= e.buildSeconds) {
      e.completed = true;
      for (const id of e.builderIds) {
        const worker = world.get(id);
        if (worker && worker.kind === 'worker') {
          worker.job = 'idle'; worker.phase = 'idle'; worker.constructionId = null; worker.order = { type: 'none' };
        }
      }
      e.builderIds = [];
      world.message = 'Blacksmith completed.';
    }
  }
}

function updateBaseUpgrade(world: World, dt: number): void {
  const base = world.base();
  if (!base || !base.alive || !base.upgrading) return;
  if (base.upgradeProgress >= base.upgradeSeconds) return;
  // Prune dead / reassigned builders
  base.upgradeBuilderIds = base.upgradeBuilderIds.filter((id) => {
    const w = world.get(id);
    return !!w && w.kind === 'worker' && w.alive && w.constructionId === base.id;
  });
  let active = 0;
  for (const id of base.upgradeBuilderIds) {
    const worker = world.get(id);
    if (!worker || worker.kind !== 'worker') continue;
    const origin = world.baseFootprintOrigin();
    if (!origin) continue;
    const stand = world.constructionStandForBase(origin.gx, origin.gy, base.upgradeBuilderIds.indexOf(id));
    if (!stand) continue;
    if (dist(worker.x, worker.y, stand.x, stand.y) <= 0.5) {
      worker.x = stand.x; worker.y = stand.y; worker.order = { type: 'none' }; active++;
    } else if (worker.order.type !== 'move') issueMove(world, worker, stand.x, stand.y);
  }
  base.upgradeProgress = Math.min(base.upgradeSeconds, base.upgradeProgress + dt * active);
  if (base.upgradeProgress >= base.upgradeSeconds) {
    base.upgradeLevel += 1;
    base.upgrading = false;
    base.upgradeProgress = 0;
    for (const id of base.upgradeBuilderIds) {
      const worker = world.get(id);
      if (worker && worker.kind === 'worker') {
        worker.job = 'idle'; worker.phase = 'idle'; worker.constructionId = null; worker.order = { type: 'none' };
      }
    }
    base.upgradeBuilderIds = [];
    world.message = 'Base upgraded!';
  }
}

function updateNodeReplenish(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'resourceNode') continue;
    if (e.replenishTimer > 0) {
      e.replenishTimer -= dt;
      if (e.replenishTimer <= 0) {
        e.replenishTimer = 0;
        e.remaining = e.maxRemaining;
      }
    }
  }
}

function clearWorkClaim(worker: Worker): void {
  worker.targetNodeId = null;
  worker.slotIndex = -1;
}

function claimNode(worker: Worker, node: ResourceNode, slot: number): void {
  worker.targetNodeId = node.id;
  worker.slotIndex = slot;
}

function sendIdleNearBase(world: World, worker: Worker): void {
  worker.job = 'idle';
  worker.phase = 'idle';
  clearWorkClaim(worker);
  worker.gatherTimer = 0;
  const park = world.idleParkPos(worker.id);
  issueMove(world, worker, park.x, park.y);
}

function reassignOrIdle(world: World, worker: Worker, resource: ResourceKind, excludeId: number | null): void {
  // Keep cargo if any — deposit first (retain target for job type only)
  if (worker.carried > 0) {
    worker.phase = 'toBase';
    sendToBase(world, worker);
    return;
  }
  // Free current slot so it can be reclaimed / used by others
  clearWorkClaim(worker);
  const found = world.findWorkNode(worker.x, worker.y, resource, excludeId);
  if (!found) {
    sendIdleNearBase(world, worker);
    return;
  }
  claimNode(worker, found.node, found.slot);
  worker.job = world.jobForResource(resource);
  worker.phase = 'toWork';
  worker.gatherTimer = 0;
  issueGather(worker, found.node.id);
}

function updateWorkerCycle(world: World, worker: Worker, dt: number): void {
  if (worker.job === 'build') return;
  if (worker.job === 'idle') {
    // Unassigned: free to stand/move wherever the player ordered — no auto-return.
    worker.phase = 'idle';
    worker.gatherTimer = 0;
    return;
  }

  const resource = world.resourceForJob(worker.job);
  if (!resource) {
    sendIdleNearBase(world, worker);
    return;
  }

  if (worker.phase === 'toWork') {
    if (!ensureWorkAssignment(world, worker, resource)) return;

    const node = world.get(worker.targetNodeId!) as ResourceNode;
    const slot = world.slotWorldPos(node, worker.slotIndex);

    if (atSlot(worker, slot.x, slot.y)) {
      worker.phase = 'gathering';
      worker.gatherTimer = 0;
      worker.order = { type: 'none' };
      // Snap into slot so they don't stack mid-cell
      worker.x = slot.x;
      worker.y = slot.y;
    } else if (worker.order.type !== 'gather' || worker.order.nodeId !== node.id) {
      issueGather(worker, node.id);
    }
    return;
  }

  if (worker.phase === 'gathering') {
    const node = worker.targetNodeId ? world.get(worker.targetNodeId) : null;
    if (
      !node ||
      node.kind !== 'resourceNode' ||
      !world.nodeIsGatherable(node) ||
      node.resource !== resource
    ) {
      reassignOrIdle(world, worker, resource, node?.id ?? null);
      return;
    }

    const slot = world.slotWorldPos(node, worker.slotIndex);
    if (!atSlot(worker, slot.x, slot.y)) {
      worker.phase = 'toWork';
      worker.gatherTimer = 0;
      issueGather(worker, node.id);
      return;
    }

    // Hold exact slot
    worker.x = slot.x;
    worker.y = slot.y;
    worker.order = { type: 'none' };
    worker.gatherTimer += dt;

    if (worker.gatherTimer >= CONFIG.resourceTickInterval) {
      const amount = Math.min(CONFIG.gatherAmount, node.remaining);
      node.remaining -= amount;
      worker.carried = amount;
      worker.carriedResource = resource;
      worker.gatherTimer = 0;

      if (node.remaining <= 0) {
        node.remaining = 0;
        node.replenishTimer = CONFIG.nodeReplenishSeconds;
      }

      worker.phase = 'toBase';
      sendToBase(world, worker);
    }
    return;
  }

  if (worker.phase === 'toBase') {
    const base = world.base();
    if (!base || !base.alive) {
      sendIdleNearBase(world, worker);
      return;
    }

    if (atBase(worker, base, world)) {
      depositAtBase(world, worker);
      // After deposit: same job → next free same-type work, else idle near base
      reassignOrIdle(world, worker, resource, null);
      return;
    }

    if (worker.order.type !== 'move' || worker.order.path.length === 0) {
      sendToBase(world, worker);
    }
  }
}

/** Ensure worker has a valid node+slot; reassign if not. Returns false if became idle. */
function ensureWorkAssignment(world: World, worker: Worker, resource: ResourceKind): boolean {
  const node = worker.targetNodeId ? world.get(worker.targetNodeId) : null;
  if (
    node &&
    node.kind === 'resourceNode' &&
    world.nodeIsGatherable(node) &&
    node.resource === resource &&
    worker.slotIndex >= 0
  ) {
    // Confirm slot still "ours" (no double-claim) — if conflict, reclaim free
    const others = world.workersOnNode(node.id).filter((w) => w.id !== worker.id);
    if (others.some((w) => w.slotIndex === worker.slotIndex)) {
      const free = world.freeSlotIndex(node.id);
      if (free >= 0) {
        worker.slotIndex = free;
        return true;
      }
      reassignOrIdle(world, worker, resource, node.id);
      return worker.job !== 'idle';
    }
    return true;
  }

  reassignOrIdle(world, worker, resource, null);
  return worker.job !== 'idle';
}

function atSlot(worker: Worker, sx: number, sy: number): boolean {
  return dist(worker.x, worker.y, sx, sy) <= CONFIG.gatherReach + 0.05;
}

function atBase(worker: Worker, base: BaseBuilding, world: World): boolean {
  // Standing on any walkable deposit tile around the solid base
  const origin = world.baseFootprintOrigin();
  if (origin) {
    for (const p of depositPoints(origin.gx, origin.gy)) {
      if (!world.isWalkable(Math.floor(p.x), Math.floor(p.y))) continue;
      if (dist(worker.x, worker.y, p.x, p.y) <= CONFIG.depositReach + 0.35) return true;
    }
  }
  if (dist(worker.x, worker.y, base.spawnX, base.spawnY) <= CONFIG.depositReach + 0.35) return true;
  // Adjacent to footprint (Manhattan) without standing on solid base tiles
  if (origin) {
    const wx = Math.floor(worker.x);
    const wy = Math.floor(worker.y);
    if (world.isWalkable(wx, wy)) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (Math.abs(wx - (origin.gx + dx)) + Math.abs(wy - (origin.gy + dy)) === 1) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function depositPoints(gx: number, gy: number): { x: number; y: number }[] {
  // Tile centers on the walkable ring around the solid 2×2 base (never on base tiles)
  return [
    { x: gx + 0.5, y: gy - 0.5 },
    { x: gx + 1.5, y: gy - 0.5 },
    { x: gx + 2.5, y: gy + 0.5 },
    { x: gx + 2.5, y: gy + 1.5 },
    { x: gx + 1.5, y: gy + 2.5 },
    { x: gx + 0.5, y: gy + 2.5 },
    { x: gx - 0.5, y: gy + 1.5 },
    { x: gx - 0.5, y: gy + 0.5 },
  ];
}

function sendToBase(world: World, worker: Worker): void {
  const base = world.base();
  const origin = world.baseFootprintOrigin();
  if (!base || !origin) return;

  // Nearest *walkable* deposit tile outside the solid base
  let best = { x: base.spawnX, y: base.spawnY };
  let bestD = Infinity;
  for (const p of depositPoints(origin.gx, origin.gy)) {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (!world.isWalkable(tx, ty)) continue;
    const d = dist(worker.x, worker.y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  // Fallback to spawn if set and walkable
  if (bestD === Infinity && world.isWalkable(Math.floor(base.spawnX), Math.floor(base.spawnY))) {
    best = { x: base.spawnX, y: base.spawnY };
  }
  issueMove(world, worker, best.x, best.y);
}

function depositAtBase(world: World, worker: Worker): void {
  if (worker.carried > 0 && worker.carriedResource) {
    const res = worker.carriedResource;
    const amount = worker.carried;
    if (res !== 'fish') world.stockpile[res] += amount;
    world.spawnFloatText(worker.x, worker.y, `+${amount}`, colorForResource(res));
    worker.carried = 0;
    worker.carriedResource = null;
  }
  worker.order = { type: 'none' };
}

function colorForResource(r: ResourceKind): string {
  if (r === 'stone') return '#8b949e';
  if (r === 'wood') return '#3fb950';
  return '#a371f7';
}

function computeExpectedIncome(world: World): Stockpile {
  const income: Stockpile = { stone: 0, wood: 0, food: 0 };
  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'worker') continue;
    if (e.job === 'idle') continue;
    const resource = world.resourceForJob(e.job);
    if (!resource || resource === 'fish') continue;
    income[resource] += CONFIG.gatherAmount;
  }
  return income;
}
