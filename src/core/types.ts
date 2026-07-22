export type EntityId = number;

export type ResourceKind = 'stone' | 'wood' | 'food' | 'fish';

export type WorkerJob = 'idle' | 'mine' | 'log' | 'farm' | 'build';

/** Worker resource loop: go to node → gather → return to base → deposit → repeat. */
export type WorkerPhase = 'idle' | 'toWork' | 'gathering' | 'toBase' | 'building';

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
  | { type: 'gather'; nodeId: EntityId; path?: { x: number; y: number }[]; pathGoalX?: number; pathGoalY?: number };

export interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  lifetime: number;
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
  /** Seconds since last combat event; regen when > grace. */
  combatTimer: number;
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
   * Whose swing is next once both are in melee (alternating).
   * Hero always opens the exchange.
   */
  combatTurn: 'hero' | 'enemy';
  skills: import('../systems/Skills').Skills;
  order: UnitOrder;
  /** Ticks elapsed toward the current catch (0 when not fishing). */
  fishingTimer: number;
  /** Active fishing spot, or null. */
  fishingNodeId: EntityId | null;
}

export interface Worker extends BaseEntity {
  kind: 'worker';
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
  /** Returning to camp after leash break. */
  leashing: boolean;
  fightRole: FightRole;
  queueIndex: number;
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

export interface ResourceNode extends BaseEntity {
  kind: 'resourceNode';
  resource: ResourceKind;
  remaining: number;
  maxRemaining: number;
  /** >0 while regenerating after depletion (seconds remaining). */
  replenishTimer: number;
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

export type TileTerrain = 'grass' | 'dirt' | 'water';

export interface Tile {
  terrain: TileTerrain;
  blocked: boolean;
  /** Visual-only scenery; it does not affect pathing or resource gathering. */
  decoration?: 'tree' | 'fallenTree' | 'stone';
}

export interface Stockpile {
  stone: number;
  wood: number;
  food: number;
}

/** Currency is kept in a wallet and never consumes an inventory slot. */
export interface CoinPurse {
  gold: number;
  silver: number;
  copper: number;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export type WalkFn = (gx: number, gy: number) => boolean;
