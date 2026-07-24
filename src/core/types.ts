export type EntityId = number;

export type ResourceKind = 'stone' | 'wood' | 'food' | 'fish';

/** What the player assigned this worker to do (HUD buttons). */
export type WorkerJob = 'idle' | 'mine' | 'log' | 'farm' | 'build';

/**
 * Where the worker is in their current job loop (see Production.updateWorkerCycle).
 * `waiting`  = job still set, no gatherable node; snore until respawn
 * `starving` = job still set, stockpile food empty; snore until food returns
 * Distinct from job `idle` (fully unassigned by player).
 */
export type WorkerPhase =
  | 'idle'
  | 'toWork'
  | 'gathering'
  | 'toBase'
  | 'building'
  | 'waiting'
  | 'starving';

export type UnitOrder =
  | { type: 'none' }
  | { type: 'move'; tx: number; ty: number; path: { x: number; y: number }[] }
  | {
      type: 'attack';
      targetId: EntityId;
      /** Cached approach path; repath when from/goal tiles change. */
      path?: { x: number; y: number }[];
      pathGoalX?: number;
      pathGoalY?: number;
      pathFromX?: number;
      pathFromY?: number;
    }
  | {
      type: 'gather';
      nodeId: EntityId;
      /** Cached approach path; repath when start/goal tiles change (same idea as attack). */
      path?: { x: number; y: number }[];
      pathGoalX?: number;
      pathGoalY?: number;
      pathFromX?: number;
      pathFromY?: number;
    };

export type FloatTextStyle = 'plain' | 'hitsplat' | 'miss';

export interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  lifetime: number;
  /** Visual style — hitsplat = combat damage box (OSRS-like). */
  style?: FloatTextStyle;
}

export type EntityKind =
  | 'hero'
  | 'worker'
  | 'enemy'
  | 'base'
  | 'blacksmith'
  | 'npc'
  | 'resourceNode'
  | 'loot';

export interface BaseEntity {
  id: EntityId;
  kind: EntityKind;
  x: number;
  y: number;
  /** Position at start of current tick (for client lerp). */
  prevX: number;
  prevY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface Hero extends BaseEntity {
  kind: 'hero';
  speed: number;
  /** Display / fallback max hit estimate (from skills+gear). */
  damage: number;
  /** Defense bonus from gear (for UI / reduction). */
  armor: number;
  range: number;
  /** Weapon speed in game ticks. */
  attackTicks: number;
  /** Ticks until next attack (integer). */
  attackTimer: number;
  /** Seconds since last combat damage; regen when lock is clear and this > grace. */
  combatTimer: number;
  /**
   * Combat lock remaining (game ticks). Set to CONFIG.combatLockTicks on damage
   * dealt or taken; logout blocked while > 0.
   */
  combatLockTicks: number;
  /** Active single combat target (front of fight). */
  combatTargetId: EntityId | null;
  /** Queued next target (player click). */
  queuedTargetId: EntityId | null;
  /** Ordered fight queue: front is combatTargetId. */
  fightQueue: EntityId[];
  /** Tile hero should stand on while meleeing. */
  combatStandX: number | null;
  combatStandY: number | null;
  /** Player still wants this fight (false when fleeing). */
  combatEngaged: boolean;
  /**
   * True after the hero has completed at least one swing this fight.
   * Group-hostile packmates only join once this flips on.
   */
  combatSwingLanded: boolean;
  /**
   * True while hero + front are in orthogonal melee this tick.
   * Used so weapon wind-up only counts down in range (paused while walking in).
   */
  combatInMelee: boolean;
  /**
   * Whose swing is preferred if both weapons are ready the same tick.
   * Hero always opens the exchange.
   */
  combatTurn: 'hero' | 'enemy';
  skills: import('../systems/Skills').Skills;
  order: UnitOrder;
  /** Ticks elapsed toward the current catch (0 when not fishing). */
  fishingTimer: number;
  /** Active fishing spot, or null. */
  fishingNodeId: EntityId | null;
  /**
   * Tick-synced character animation (stepped keyframes, no tweening).
   * Advanced only on the game tick — see systems/CharacterAnim.ts.
   */
  animClip: 'idle' | 'walk' | 'attack';
  /** Keyframe index within the current clip (walk: 0..1, attack: 0..2). */
  animFrame: number;
  /** Screen-space facing snapped on tick: 1 = right, -1 = left. */
  animFacing: 1 | -1;
  /**
   * When true, CharacterAnim will not advance the attack clip this tick
   * (set the same tick combat starts the contact frame).
   */
  animHoldTick: boolean;
}

export interface Worker extends BaseEntity {
  kind: 'worker';
  /**
   * Human-facing roster number (#1, #2, …), not the global entity id.
   * Entity ids are shared with base/nodes/hero so the first workers are not #1.
   */
  rosterNo: number;
  speed: number;
  job: WorkerJob;
  phase: WorkerPhase;
  targetNodeId: EntityId | null;
  /** 0–3 stand slot at the node, or -1 if none. */
  slotIndex: number;
  /** Elapsed gather time while at the node (seconds). */
  gatherTimer: number;
  /** Resources carried after finishing a gather cycle (deposited at base). */
  carried: number;
  carriedResource: ResourceKind | null;
  constructionId: EntityId | null;
  /**
   * Accrues real time toward the next food upkeep tick while job !== idle.
   * Stage 1 economy: working workers consume stockpile food.
   */
  foodUpkeepAcc: number;
  order: UnitOrder;
}

export type FightRole = 'idle' | 'front' | 'waiting';

export interface Enemy extends BaseEntity {
  kind: 'enemy';
  species: import('../config').EnemySpeciesId;
  speed: number;
  /** Max hit. */
  damage: number;
  range: number;
  attackTicks: number;
  /** Ticks until next attack. */
  attackTimer: number;
  defenseLevel: number;
  order: UnitOrder;
  aggressive: boolean;
  /**
   * Returning to exact spawn after leash break.
   * While true: no target, ignore player proximity (except touch re-aggro inside leash).
   */
  leashing: boolean;
  fightRole: FightRole;
  queueIndex: number;
  /** Exact spawn / camp position (leash origin + walk-home target). */
  campX: number;
  campY: number;
  packId: number;
}

export interface BaseBuilding extends BaseEntity {
  kind: 'base';
  trainTimer: number;
  trainQueue: number;
  spawnX: number;
  spawnY: number;
  /** Permanent upgrade level (0 = default, 1+ = upgraded). */
  upgradeLevel: number;
  /** True while an upgrade is being built. */
  upgrading: boolean;
  /** Seconds of build progress toward current upgrade. */
  upgradeProgress: number;
  /** Total seconds required for current upgrade (per builder). */
  upgradeSeconds: number;
  /** Worker IDs currently building the upgrade. */
  upgradeBuilderIds: EntityId[];
}

export interface BlacksmithBuilding extends BaseEntity {
  kind: 'blacksmith';
  buildProgress: number;
  buildSeconds: number;
  builderIds: EntityId[];
  completed: boolean;
}

/** Friendly interactive NPC (e.g. free test shop). */
export interface Npc extends BaseEntity {
  kind: 'npc';
  /** Shop / dialogue role. */
  role: 'shop';
  name: string;
}

/**
 * Harvestable world feature. Land nodes (stone/wood/food) are solid tiles workers
 * stand *beside*; fish sits on water and is hero-only.
 * When remaining hits 0, replenishTimer counts down, then the node relocates near
 * anchor and refills (Production + World.relocateAndRefillNode).
 */
export interface ResourceNode extends BaseEntity {
  kind: 'resourceNode';
  resource: ResourceKind;
  remaining: number;
  maxRemaining: number;
  /** >0 while regenerating after depletion (seconds remaining). */
  replenishTimer: number;
  /**
   * Frozen "home area" for respawns — search radius is around this point so
   * nodes don't walk across the whole map over many cycles.
   */
  anchorX: number;
  anchorY: number;
}

export interface LootPile extends BaseEntity {
  kind: 'loot';
  /** Ground items waiting for pickup. */
  items: import('../items/types').ItemInstance[];
}

export type Entity =
  | Hero
  | Worker
  | Enemy
  | BaseBuilding
  | BlacksmithBuilding
  | Npc
  | ResourceNode
  | LootPile;

/** Surface type for rendering + walk rules. Water is blocked unless a bridge. */
export type TileTerrain = 'grass' | 'dirt' | 'water' | 'sand' | 'snow';

/** Large-scale map region (drives palette + décor density). */
export type BiomeId = 'meadow' | 'forest' | 'arid';

export interface Tile {
  terrain: TileTerrain;
  blocked: boolean;
  /** Visual-only scenery; it does not affect pathing or resource gathering. */
  decoration?: 'tree' | 'fallenTree' | 'stone' | 'bush' | 'rock';
  /** Optional biome tag for debugging / future systems. */
  biome?: BiomeId;
}

export interface Stockpile {
  stone: number;
  wood: number;
  food: number;
}

/**
 * Currency wallet (not an inventory slot).
 * Conversion: 100 copper = 1 silver, 100 silver = 1 gold.
 * Prefer `normalizeCoins` / `addCoins` from `core/currency` after any mutation.
 */
export interface CoinPurse {
  gold: number;
  silver: number;
  copper: number;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export type WalkFn = (gx: number, gy: number) => boolean;
