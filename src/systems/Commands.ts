import type { WorkerJob } from '../core/types';
import type { World } from '../world/World';
import { clearFishing, queueFish } from './Fishing';
import { issueMove } from './Movement';
import { assignWorkerJob, queueTrainWorker } from './Production';

export function selectAt(world: World, gx: number, gy: number, wx?: number, wy?: number): void {
  const kinds: Array<
    'hero' | 'worker' | 'base' | 'blacksmith' | 'npc' | 'enemy' | 'resourceNode' | 'loot'
  > = ['hero', 'worker', 'base', 'blacksmith', 'npc', 'enemy', 'resourceNode', 'loot'];
  // Prefer continuous pick when world coords are known (iso body clicks)
  const e =
    wx != null && wy != null
      ? (world.nearestEntityAt(wx, wy, kinds, 1.25) ?? world.entityAtTile(gx, gy, kinds))
      : world.entityAtTile(gx, gy, kinds);
  if (
    e &&
    (e.kind === 'hero' ||
      e.kind === 'worker' ||
      e.kind === 'base' ||
      e.kind === 'blacksmith' ||
      e.kind === 'npc' ||
      e.kind === 'enemy')
  ) {
    world.selectedId = e.id;
  }
}

/**
 * Queue a ground command. Hero moves/flees on the **next game tick** (OSRS-style).
 * Workers still get immediate pathing when selected.
 */
export function commandAt(world: World, wx: number, wy: number): void {
  if (world.status !== 'playing') return;

  const gx = Math.floor(wx);
  const gy = Math.floor(wy);

  const selected = world.selectedId != null ? world.get(world.selectedId) : null;
  if (selected && selected.alive && selected.kind === 'worker') {
    const node = world.entityAtTile(gx, gy, ['resourceNode']);
    if (node && node.kind === 'resourceNode') {
      assignWorkerJob(world, selected, world.jobForResource(node.resource));
      return;
    }
    selected.job = 'idle';
    selected.phase = 'idle';
    selected.targetNodeId = null;
    selected.slotIndex = -1;
    selected.gatherTimer = 0;
    issueMove(world, selected, wx, wy);
    return;
  }

  // Hero: queue move for next tick (cancels pending attack/fish; combat leash handled on tick)
  const hero = world.hero();
  if (!hero || !hero.alive) return;
  world.selectedId = hero.id;
  world.pendingAttackId = null;
  world.pendingFishId = null;
  clearFishing(hero);
  world.pendingMove = { x: wx, y: wy };
  world.message = hero.combatEngaged ? 'Moving…' : 'Walking…';
}

/** Queue hero attack on next game tick. */
export function queueHeroAttack(world: World, enemyId: number): void {
  if (world.status !== 'playing') return;
  const hero = world.hero();
  if (!hero || !hero.alive) return;
  world.selectedId = hero.id;
  world.pendingMove = null;
  world.pendingFishId = null;
  clearFishing(hero);
  world.pendingAttackId = enemyId;
  world.message = 'Attacking…';
}

export { queueFish };

export function trainWorkerCommand(world: World): boolean {
  return queueTrainWorker(world);
}

export function setJobCommand(world: World, job: WorkerJob): void {
  const e = world.selectedId != null ? world.get(world.selectedId) : null;
  if (!e || e.kind !== 'worker' || !e.alive) return;
  assignWorkerJob(world, e, job);
}
