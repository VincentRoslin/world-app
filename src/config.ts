/**
 * Global tunables for the hybrid isometric game.
 *
 * Groups (scan this file when balancing):
 * - Map / iso projection (chunkSize, tileW/H, entityDrawYOffset)
 * - Base economy (train costs, upgrades, worker gather rates)
 * - Resource nodes (capacity 300, replenish, nearby respawn radius)
 * - Fishing (separate stock + water respawn)
 * - Hero combat (tick length 0.6s, leash, HP regen)
 * - Bags / shop range
 *
 * Changing saveKey invalidates localStorage saves (use when data shape breaks).
 */
export const CONFIG = {
  /** Tiles per chunk side (32 balances vision streaming vs content density). */
  chunkSize: 32,
  visionRadius: 8,
  /** Soft cap: how far from home (in chunks) can generate. */
  maxChunkRadius: 8,

  tileW: 64,
  /** Slightly flatter than classic 2:1 → camera a bit more top-down. */
  tileH: 28,
  defaultZoom: 0.88,
  /**
   * Screen-space Y nudge for *standing* units (hero, worker, props with height).
   * Positive = toward bottom of screen (iso "south").
   * IMPORTANT: flat tile-bound art (oat fields, fishing diamonds) must use the
   * raw tile center (`foot` in Renderer) WITHOUT this offset, or they look shifted.
   */
  entityDrawYOffset: 3,

  /** Soft unit–unit separation (tile units). Kept mild so it doesn’t fight pathing. */
  unitRadius: 0.38,
  separationStrength: 2.4,
  /**
   * Max tiles a non-hero can be shoved by separation in one second.
   * Stops workers from being pushed forever in front of a walking hero —
   * excess becomes lateral “glide past” motion.
   */
  separationMaxSpeed: 1.6,
  /** Extra lateral bias when a worker is pushed by the hero (0–1). */
  separationLateralBias: 0.72,
  spawnMinSeparation: 0.55,

  startStone: 100,
  startWood: 50,
  startFood: 100,

  maxWorkers: 12,
  workerTrainStone: 25,
  workerTrainFood: 50,
  workerTrainTime: 3,
  blacksmithBuildSeconds: 300,

  /** Base upgrade: cost and build time (per builder). */
  baseUpgradeStone: 100,
  baseUpgradeWood: 80,
  baseUpgradeFood: 50,
  baseUpgradeSeconds: 180,
  baseMaxLevel: 3,

  /** Seconds gathering at a node before returning to base to deposit. */
  resourceTickInterval: 15,
  gatherAmount: 3,
  /** How close (tile units) a worker must be to their work slot. */
  gatherReach: 0.28,
  /** When within this of the slot, skip grid path and walk straight in. */
  gatherApproach: 1.5,
  /** How close to deposit point to count as emptying. */
  depositReach: 0.55,
  /** Floating +N text lifetime (seconds). */
  floatTextLifetime: 1.15,

  /** Max workers per resource tile (on adjacent walkable tiles only). */
  maxWorkersPerNode: 4,
  /**
   * Relative tile offsets for worker stand slots around a solid work tile.
   * Prefer orthogonal, then diagonal — never on the work tile itself.
   */
  workStandTileOffsets: [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ] as const,

  /** Stock per stone / wood / food node before depleting. */
  nodeCapacity: 300,
  /** Seconds before an empty node refills (then relocates nearby). */
  nodeReplenishSeconds: 300,
  /**
   * Min Chebyshev distance between land resource nodes (centers).
   * 2 = at least one free tile between nodes so worker stand rings don’t overlap.
   * Crowding is solved here rather than with complex local avoidance.
   */
  nodeMinSeparation: 2,
  /** Max tiles from a node's anchor when choosing a post-respawn tile. */
  nodeRespawnRadius: 6,

  /** Fishing spots: stock per node and catch timing (game ticks). */
  fishSpotMin: 5,
  fishSpotMax: 10,
  /** Level 1 catch duration in ticks (×0.6s). */
  fishBaseTicks: 12,
  /** Ticks shaved per fishing level above 1. */
  fishTicksPerLevel: 0.12,
  /** Fastest catch (high level). */
  fishMinTicks: 4,
  /** Fishing XP per catch. */
  fishXpPerCatch: 25,
  /** Seconds before a depleted fishing spot respawns at a nearby water tile. */
  fishRespawnDelay: 120,
  /** Max radius (tiles) from depleted spot to search for a new water tile. */
  fishRespawnRadius: 8,

  /** Base HP before Defense level & gear (squished). */
  heroHp: 10,
  /** Unused flat damage — combat uses skills + gear bonuses. */
  heroDamage: 1,
  /** Weapon speed in game ticks (4 × 0.6s = 2.4s). */
  heroAttackTicks: 4,
  heroRange: 1.25,
  /** Out-of-combat HP regeneration. */
  heroHpRegenPerSec: 1,
  /** Seconds after combat before regen starts. */
  heroCombatGrace: 3,
  /** Game tick length (server cycle). */
  gameTickSec: 0.6,
  /** Walk = 1 tile/tick; run = 2 tiles/tick. */
  walkTilesPerTick: 1,
  runTilesPerTick: 2,
  /**
   * Continuous hero speed (tiles/s) ≈ runTilesPerTick / gameTickSec.
   * Keep in sync: 2 / 0.6 ≈ 3.333.
   */
  heroSpeed: 2 / 0.6,
  /** Max ticks processed in one frame (avoids spiral of death after tab-out). */
  maxTicksPerFrame: 3,
  /**
   * Max tiles from enemy camp for combat leash.
   * Inside: front chases if you kite; stand still → hero re-engages.
   * Outside: fight ends and mobs return home.
   */
  enemyLeashDistance: 10,
  /** Auto-retarget / fight group radius. */
  heroAutoTargetRange: 8,
  /** Packmates within this range join the fight queue. */
  fightGroupRadius: 4.5,

  mainBagSlots: 16,
  maxExtraBags: 4,
  extraBagSlots: 16,
  lootPickupRange: 1.4,
  /** Hero must be this close (tiles) to open / keep the vendor shop. */
  shopInteractRange: 2.25,
  /** Normal enemies are mainly a source of materials and pocket change. */
  normalMobGearDropChance: 0.04,

  workerHp: 40,
  /** ~half of hero run; fine for hauling. */
  workerSpeed: 1.8,
  /** Multiplier while carrying resources back to base. */
  workerCarrySpeedMult: 0.62,

  baseHp: 500,

  enemyRange: 1.15,
  /** Slightly below hero run so packs don't outpace the player forever. */
  enemySpeed: 1.8,
  enemyAggroRadius: 1.8,
  /** Enemy effective defense level for accuracy rolls. */
  enemyDefenseLevel: 1,

  packSize: 3,
  /** Chance a wild chunk gets a pack when first generated. */
  wildPackChance: 0.55,

  /** Bumped for 32×32 chunks (old 16×16 saves are incompatible). */
  /** Bumped for half-rate XP table + max-hit formula. */
  saveKey: 'iso-base-save-v12',
} as const;

/** Per-species starter combat stats (easy). */
export const ENEMY_SPECIES = {
  cow: {
    name: 'Cow',
    hp: 5,
    maxHit: 1,
    attackTicks: 5,
    defenseLevel: 1,
    color: '#e6edf3',
    aggroRadius: 0, // passive until attacked
  },
  goblin: {
    name: 'Goblin',
    hp: 5,
    maxHit: 1,
    attackTicks: 4,
    defenseLevel: 1,
    color: '#3fb950',
    aggroRadius: 0, // only when attacked — no passive join
  },
  human: {
    name: 'Human',
    hp: 5,
    maxHit: 1,
    attackTicks: 4,
    defenseLevel: 1,
    color: '#f0c6a8',
    aggroRadius: 0,
  },
} as const;

export type EnemySpeciesId = keyof typeof ENEMY_SPECIES;
