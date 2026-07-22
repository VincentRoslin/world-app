import { CONFIG, ENEMY_SPECIES, type EnemySpeciesId } from '../config';
import type {
  BaseBuilding,
  BlacksmithBuilding,
  CoinPurse,
  Enemy,
  Entity,
  EntityId,
  FloatText,
  GameStatus,
  Hero,
  LootPile,
  Npc,
  ResourceKind,
  ResourceNode,
  Stockpile,
  Tile,
  Worker,
  WorkerJob,
} from '../core/types';
import type { Inventory, ItemInstance } from '../items/types';
import { createEmptyInventory, applyHeroStats } from '../systems/Inventory';
import { createDefaultSkills } from '../systems/Skills';
import { chunkOrigin, generateHomeChunk, generateWildChunk } from './MapGen';

function tileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export class World {
  worldSeed = 42;
  tiles = new Map<string, Tile>();
  loadedChunks = new Set<string>();
  explored = new Set<string>();
  entities = new Map<EntityId, Entity>();
  nextId = 1;
  nextPackId = 1;

  stockpile: Stockpile = { stone: 0, wood: 0, food: 0 };
  coins: CoinPurse = { gold: 0, silver: 0, copper: 0 };
  /** Projected +N from workers currently assigned to a job (per full gather cycle). */
  expectedIncome: Stockpile = { stone: 0, wood: 0, food: 0 };
  floatTexts: FloatText[] = [];
  nextFloatId = 1;
  nextItemUid = 1;
  inventory: Inventory = createEmptyInventory();
  inventoryOpen = false;
  /** Accumulates real time toward OSRS-style game ticks. */
  tickAcc = 0;
  /** Monotonic game tick counter (OSRS server cycle). */
  tickCount = 0;
  /**
   * Player intents registered this tick; applied at the start of the next tick
   * (OSRS: actions take effect on the following game tick).
   */
  pendingMove: { x: number; y: number } | null = null;
  pendingAttackId: EntityId | null = null;
  pendingFishId: EntityId | null = null;
  buildingPlacement: { workerId: EntityId; kind: 'blacksmith' } | null = null;

  /** Pending fishing spot respawns: timer + origin position for nearby search. */
  pendingFishRespawns: { timer: number; nearX: number; nearY: number }[] = [];

  selectedId: EntityId | null = null;
  hoverTile: { gx: number; gy: number } | null = null;
  status: GameStatus = 'playing';
  baseId: EntityId = 0;
  heroId: EntityId = 0;
  timeScale = 1;
  paused = false;
  message = '';

  /** Bounds of all loaded tiles (for minimap). */
  minGx = 0;
  maxGx = 0;
  minGy = 0;
  maxGy = 0;

  reset(seed = 42): void {
    this.worldSeed = seed;
    this.tiles.clear();
    this.loadedChunks.clear();
    this.explored.clear();
    this.entities.clear();
    this.nextId = 1;
    this.nextPackId = 1;
    this.selectedId = null;
    this.hoverTile = null;
    this.status = 'playing';
    this.message = '';
    this.paused = false;
    this.timeScale = 1;
    this.expectedIncome = { stone: 0, wood: 0, food: 0 };
    this.floatTexts = [];
    this.nextFloatId = 1;
    this.nextItemUid = 1;
    this.inventory = createEmptyInventory();
    this.inventoryOpen = false;
    this.tickAcc = 0;
    this.tickCount = 0;
    this.pendingMove = null;
    this.pendingAttackId = null;
    this.pendingFishId = null;
    this.pendingFishRespawns = [];
    this.buildingPlacement = null;
    this.stockpile = {
      stone: CONFIG.startStone,
      wood: CONFIG.startWood,
      food: CONFIG.startFood,
    };
    this.coins = { gold: 0, silver: 10, copper: 50 };
    this.minGx = 0;
    this.maxGx = CONFIG.chunkSize - 1;
    this.minGy = 0;
    this.maxGy = CONFIG.chunkSize - 1;

    this.loadChunk(0, 0, true);
  }

  tileAt(gx: number, gy: number): Tile | undefined {
    return this.tiles.get(tileKey(gx, gy));
  }

  isWalkable(gx: number, gy: number): boolean {
    const t = this.tileAt(gx, gy);
    return !!t && !t.blocked;
  }

  /** Mark a tile solid so nothing can path or stand on it. */
  setBlocked(gx: number, gy: number, blocked = true): void {
    const t = this.tileAt(gx, gy);
    if (t) {
      t.blocked = blocked;
      return;
    }
    this.tiles.set(tileKey(gx, gy), { terrain: 'dirt', blocked });
  }

  /**
   * Resolve continuous position so the unit's feet stay on a walkable tile.
   * Used after free-form movement to enforce solid structures/work tiles.
   */
  clampEntityToWalkable(x: number, y: number): { x: number; y: number } {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (this.isWalkable(gx, gy)) return { x, y };

    // Push to nearest walkable tile center in a small ring
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (!this.isWalkable(nx, ny)) continue;
          const cx = nx + 0.5;
          const cy = ny + 0.5;
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: cx, y: cy };
          }
        }
      }
      if (best) break;
    }
    return best ?? { x, y };
  }

  isExplored(gx: number, gy: number): boolean {
    return this.explored.has(tileKey(gx, gy));
  }

  markExplored(gx: number, gy: number): void {
    this.explored.add(tileKey(gx, gy));
  }

  chunkCoords(gx: number, gy: number): { cx: number; cy: number } {
    const s = CONFIG.chunkSize;
    return { cx: Math.floor(gx / s), cy: Math.floor(gy / s) };
  }

  isChunkLoaded(cx: number, cy: number): boolean {
    return this.loadedChunks.has(chunkKey(cx, cy));
  }

  /** The home chunk is the worker economy's operating area. */
  isHomeTile(gx: number, gy: number): boolean {
    const { cx, cy } = this.chunkCoords(gx, gy);
    return cx === 0 && cy === 0;
  }

  loadChunk(cx: number, cy: number, isHome = false): void {
    const key = chunkKey(cx, cy);
    if (this.loadedChunks.has(key)) return;

    // Soft world limit
    if (Math.abs(cx) > CONFIG.maxChunkRadius || Math.abs(cy) > CONFIG.maxChunkRadius) return;

    const content =
      isHome || (cx === 0 && cy === 0)
        ? generateHomeChunk(this.worldSeed)
        : generateWildChunk(this.worldSeed, cx, cy);

    for (const { gx, gy, tile } of content.tiles) {
      this.tiles.set(tileKey(gx, gy), tile);
      this.minGx = Math.min(this.minGx, gx);
      this.maxGx = Math.max(this.maxGx, gx);
      this.minGy = Math.min(this.minGy, gy);
      this.maxGy = Math.max(this.maxGy, gy);
    }
    this.loadedChunks.add(key);

    for (const r of content.resources) {
      this.createResourceNode(r.x, r.y, r.resource);
    }

    if (content.packs.length > 0) {
      const packId = this.nextPackId++;
      const camp = content.packs[0]!;
      for (const p of content.packs) {
        this.createEnemy(p.x, p.y, {
          packId,
          campX: camp.x,
          campY: camp.y,
          species: p.species ?? 'goblin',
        });
      }
    }

    if (content.base) {
      const base = this.createBase(content.base.gx, content.base.gy);
      this.baseId = base.id;
      // Free test shopkeeper ~5 tiles north of base center
      if (isHome || (cx === 0 && cy === 0)) {
        const shopX = content.base.gx + 1.5;
        const shopY = content.base.gy + 1.5 - 5;
        const sx = Math.floor(shopX);
        const sy = Math.floor(shopY);
        const tile = this.tileAt(sx, sy);
        if (tile) {
          tile.blocked = false;
          tile.decoration = undefined;
          if (tile.terrain === 'water') tile.terrain = 'dirt';
        }
        this.createNpc(shopX, shopY, 'shop', 'Test Vendor');
      }
    }
    if (content.hero) {
      const hero = this.createHero(content.hero.x, content.hero.y);
      this.heroId = hero.id;
      this.selectedId = hero.id;
    }
    if (content.workers) {
      for (const w of content.workers) {
        this.createWorker(w.x, w.y);
      }
    }

    // Home fully explored
    if (isHome || (cx === 0 && cy === 0)) {
      const { ox, oy } = chunkOrigin(cx, cy);
      for (let y = 0; y < CONFIG.chunkSize; y++) {
        for (let x = 0; x < CONFIG.chunkSize; x++) {
          this.markExplored(ox + x, oy + y);
        }
      }
    }
  }

  ensureChunksAround(wx: number, wy: number): void {
    const { cx, cy } = this.chunkCoords(wx, wy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.loadChunk(cx + dx, cy + dy, false);
      }
    }
  }

  private allocId(): EntityId {
    return this.nextId++;
  }

  createBase(gx: number, gy: number): BaseBuilding {
    // x,y = center of 2×2 footprint covering (gx,gy)..(gx+1,gy+1)
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        this.setBlocked(gx + dx, gy + dy, true);
      }
    }
    // Drop-off on walkable tile just north of the footprint (not on solid base)
    const dropX = gx + 1 + 0.5;
    const dropY = gy - 1 + 0.5;
    const e: BaseBuilding = {
      id: this.allocId(),
      kind: 'base',
      x: gx + 1,
      y: gy + 1,
      prevX: gx + 1,
      prevY: gy + 1,
      hp: CONFIG.baseHp,
      maxHp: CONFIG.baseHp,
      alive: true,
      trainTimer: 0,
      trainQueue: 0,
      spawnX: this.isWalkable(gx + 1, gy - 1) ? dropX : gx + 2.5,
      spawnY: this.isWalkable(gx + 1, gy - 1) ? dropY : gy + 0.5,
      upgradeLevel: 0,
      upgrading: false,
      upgradeProgress: 0,
      upgradeSeconds: CONFIG.baseUpgradeSeconds,
      upgradeBuilderIds: [],
    };
    this.entities.set(e.id, e);
    return e;
  }

  canPlaceBlacksmith(gx: number, gy: number): boolean {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      const tile = this.tileAt(x, y);
      if (!tile || !this.isWalkable(x, y) || tile.decoration) return false;
      for (const e of this.entities.values()) {
        if (!e.alive || e.kind === 'loot' || e.kind === 'resourceNode') continue;
        if (Math.floor(e.x) === x && Math.floor(e.y) === y) return false;
      }
    }
    return true;
  }

  createBlacksmith(gx: number, gy: number, builderId: EntityId): BlacksmithBuilding | null {
    if (!this.canPlaceBlacksmith(gx, gy)) return null;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const tile = this.tileAt(gx + dx, gy + dy);
      if (tile) tile.decoration = undefined;
      this.setBlocked(gx + dx, gy + dy, true);
    }
    const e: BlacksmithBuilding = {
      id: this.allocId(), kind: 'blacksmith', x: gx + 1, y: gy + 1, prevX: gx + 1, prevY: gy + 1,
      hp: 1, maxHp: 1, alive: true, buildProgress: 0, buildSeconds: CONFIG.blacksmithBuildSeconds,
      builderIds: [builderId], completed: false,
    };
    this.entities.set(e.id, e);
    return e;
  }

  blacksmithOrigin(b: BlacksmithBuilding): { gx: number; gy: number } {
    return { gx: Math.floor(b.x) - 1, gy: Math.floor(b.y) - 1 };
  }

  constructionStand(b: BlacksmithBuilding, builderId: EntityId): { x: number; y: number } | null {
    const { gx, gy } = this.blacksmithOrigin(b);
    const candidates = [
      { x: gx + 0.5, y: gy - 0.5 }, { x: gx + 1.5, y: gy - 0.5 },
      { x: gx + 2.5, y: gy + 0.5 }, { x: gx + 2.5, y: gy + 1.5 },
      { x: gx + 1.5, y: gy + 2.5 }, { x: gx + 0.5, y: gy + 2.5 },
      { x: gx - 0.5, y: gy + 1.5 }, { x: gx - 0.5, y: gy + 0.5 },
    ].filter((p) => this.isWalkable(Math.floor(p.x), Math.floor(p.y)));
    if (!candidates.length) return null;
    return candidates[Math.max(0, b.builderIds.indexOf(builderId)) % candidates.length]!;
  }

  constructionStandForBase(gx: number, gy: number, index: number): { x: number; y: number } | null {
    const candidates = [
      { x: gx - 0.5, y: gy - 0.5 }, { x: gx + 2.5, y: gy - 0.5 },
      { x: gx + 2.5, y: gy + 2.5 }, { x: gx - 0.5, y: gy + 2.5 },
      { x: gx + 0.5, y: gy - 0.5 }, { x: gx + 1.5, y: gy - 0.5 },
      { x: gx + 2.5, y: gy + 0.5 }, { x: gx + 2.5, y: gy + 1.5 },
    ].filter((p) => this.isWalkable(Math.floor(p.x), Math.floor(p.y)));
    if (!candidates.length) return null;
    return candidates[index % candidates.length]!;
  }

  /** Origin tile (min corner) of the base 2×2 footprint. */
  baseFootprintOrigin(): { gx: number; gy: number } | null {
    const b = this.base();
    if (!b) return null;
    return { gx: Math.floor(b.x) - 1, gy: Math.floor(b.y) - 1 };
  }

  createNpc(x: number, y: number, role: 'shop' = 'shop', name = 'Shopkeeper'): Npc {
    const e: Npc = {
      id: this.allocId(),
      kind: 'npc',
      role,
      name,
      x,
      y,
      prevX: x,
      prevY: y,
      hp: 1,
      maxHp: 1,
      alive: true,
    };
    this.entities.set(e.id, e);
    return e;
  }

  createHero(x: number, y: number): Hero {
    const e: Hero = {
      id: this.allocId(),
      kind: 'hero',
      x,
      y,
      prevX: x,
      prevY: y,
      hp: CONFIG.heroHp + 1,
      maxHp: CONFIG.heroHp + 1,
      alive: true,
      speed: CONFIG.heroSpeed,
      damage: 1,
      armor: 0,
      range: CONFIG.heroRange,
      attackTicks: CONFIG.heroAttackTicks,
      attackTimer: 0,
      combatTimer: 99,
      combatTargetId: null,
      queuedTargetId: null,
      fightQueue: [],
      combatStandX: null,
      combatStandY: null,
      combatEngaged: false,
      combatTurn: 'hero',
      skills: createDefaultSkills(),
      order: { type: 'none' },
      fishingTimer: 0,
      fishingNodeId: null,
    };
    this.entities.set(e.id, e);
    applyHeroStats(e, this.inventory);
    e.hp = e.maxHp;
    return e;
  }

  allocItemUid(): number {
    return this.nextItemUid++;
  }

  createItem(defId: string, quantity = 1): ItemInstance {
    return { uid: this.allocItemUid(), defId, quantity: Math.max(1, quantity) };
  }

  createLoot(x: number, y: number, items: ItemInstance[]): LootPile {
    const e: LootPile = {
      id: this.allocId(),
      kind: 'loot',
      x,
      y,
      prevX: x,
      prevY: y,
      hp: 1,
      maxHp: 1,
      alive: true,
      items,
    };
    this.entities.set(e.id, e);
    return e;
  }

  createWorker(x: number, y: number): Worker {
    const e: Worker = {
      id: this.allocId(),
      kind: 'worker',
      x,
      y,
      prevX: x,
      prevY: y,
      hp: CONFIG.workerHp,
      maxHp: CONFIG.workerHp,
      alive: true,
      speed: CONFIG.workerSpeed,
      job: 'idle',
      phase: 'idle',
      targetNodeId: null,
      slotIndex: -1,
      gatherTimer: 0,
      carried: 0,
      carriedResource: null,
      constructionId: null,
      order: { type: 'none' },
    };
    this.entities.set(e.id, e);
    return e;
  }

  spawnFloatText(x: number, y: number, text: string, color: string): void {
    this.floatTexts.push({
      id: this.nextFloatId++,
      x,
      y,
      text,
      color,
      age: 0,
      lifetime: CONFIG.floatTextLifetime,
    });
  }

  updateFloatTexts(dt: number): void {
    for (const f of this.floatTexts) {
      f.age += dt;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.age < f.lifetime);
  }

  createEnemy(
    x: number,
    y: number,
    opts?: {
      packId?: number;
      campX?: number;
      campY?: number;
      aggressive?: boolean;
      species?: EnemySpeciesId;
    },
  ): Enemy {
    const species = opts?.species ?? 'goblin';
    const def = ENEMY_SPECIES[species];
    const e: Enemy = {
      id: this.allocId(),
      kind: 'enemy',
      species,
      x,
      y,
      prevX: x,
      prevY: y,
      hp: def.hp,
      maxHp: def.hp,
      alive: true,
      speed: CONFIG.enemySpeed,
      damage: def.maxHit,
      range: CONFIG.enemyRange,
      attackTicks: def.attackTicks,
      attackTimer: 0,
      defenseLevel: def.defenseLevel,
      order: { type: 'none' },
      aggressive: opts?.aggressive ?? false,
      leashing: false,
      fightRole: 'idle',
      queueIndex: -1,
      campX: opts?.campX ?? x,
      campY: opts?.campY ?? y,
      packId: opts?.packId ?? 0,
    };
    this.entities.set(e.id, e);
    return e;
  }

  createResourceNode(x: number, y: number, resource: ResourceKind): ResourceNode {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    // Fishing spots sit on water (already blocked). Other nodes are solid work tiles.
    if (resource !== 'fish') {
      this.setBlocked(gx, gy, true);
    } else {
      this.setBlocked(gx, gy, true); // ensure blocked even if tile was shore
    }
    const isFish = resource === 'fish';
    const stock = isFish
      ? CONFIG.fishSpotMin +
        Math.floor(Math.random() * (CONFIG.fishSpotMax - CONFIG.fishSpotMin + 1))
      : CONFIG.nodeCapacity;
    const e: ResourceNode = {
      id: this.allocId(),
      kind: 'resourceNode',
      x,
      y,
      prevX: x,
      prevY: y,
      hp: 1,
      maxHp: 1,
      alive: true,
      resource,
      remaining: stock,
      maxRemaining: stock,
      replenishTimer: 0,
    };
    this.entities.set(e.id, e);
    return e;
  }

  /**
   * Walkable stand tile centers around a solid resource node (max 4).
   * Never includes the work tile itself.
   */
  standPositions(node: ResourceNode): { x: number; y: number }[] {
    const nx = Math.floor(node.x);
    const ny = Math.floor(node.y);
    const out: { x: number; y: number }[] = [];
    for (const d of CONFIG.workStandTileOffsets) {
      const gx = nx + d.x;
      const gy = ny + d.y;
      if (!this.isWalkable(gx, gy)) continue;
      out.push({ x: gx + 0.5, y: gy + 0.5 });
      if (out.length >= CONFIG.maxWorkersPerNode) break;
    }
    return out;
  }

  /**
   * Find a water tile with a walkable shore neighbor near (nearX, nearY).
   * Used for respawning depleted fishing spots at new locations.
   * Returns null if no eligible tile found within radius.
   */
  findNearbyWaterWithShore(
    nearX: number,
    nearY: number,
    radius: number = CONFIG.fishRespawnRadius,
  ): { x: number; y: number } | null {
    const cx = Math.floor(nearX);
    const cy = Math.floor(nearY);
    const candidates: { x: number; y: number; dist: number }[] = [];
    // Collect existing fish node positions to avoid overlap
    const occupied = new Set<string>();
    for (const e of this.entities.values()) {
      if (e.alive && e.kind === 'resourceNode' && e.resource === 'fish') {
        occupied.add(`${Math.floor(e.x)},${Math.floor(e.y)}`);
      }
    }

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        const key = `${gx},${gy}`;
        if (occupied.has(key)) continue;
        const tile = this.tileAt(gx, gy);
        if (!tile || tile.terrain !== 'water') continue;
        // Must have at least one walkable shore neighbor
        const hasShore =
          this.isWalkable(gx + 1, gy) ||
          this.isWalkable(gx - 1, gy) ||
          this.isWalkable(gx, gy + 1) ||
          this.isWalkable(gx, gy - 1);
        if (!hasShore) continue;
        const dist = dx * dx + dy * dy;
        candidates.push({ x: gx + 0.5, y: gy + 0.5, dist });
      }
    }
    if (candidates.length === 0) return null;
    // Prefer closer tiles with some randomness
    candidates.sort((a, b) => a.dist - b.dist);
    const topN = candidates.slice(0, Math.min(5, candidates.length));
    return topN[Math.floor(Math.random() * topN.length)] ?? null;
  }

  slotWorldPos(node: ResourceNode, slotIndex: number): { x: number; y: number } {
    const stands = this.standPositions(node);
    if (stands.length === 0) {
      // Fallback: nearest walkable (should be rare)
      const clamped = this.clampEntityToWalkable(node.x + 1, node.y);
      return clamped;
    }
    return stands[slotIndex] ?? stands[0]!;
  }

  maxSlotsForNode(node: ResourceNode): number {
    return Math.min(CONFIG.maxWorkersPerNode, this.standPositions(node).length);
  }

  /** Workers currently claiming a slot on this node (any non-idle assignment). */
  workersOnNode(nodeId: EntityId): Worker[] {
    const out: Worker[] = [];
    for (const e of this.entities.values()) {
      if (!e.alive || e.kind !== 'worker') continue;
      if (e.targetNodeId === nodeId && e.job !== 'idle' && e.slotIndex >= 0) {
        out.push(e);
      }
    }
    return out;
  }

  freeSlotIndex(nodeId: EntityId): number {
    const node = this.get<ResourceNode>(nodeId);
    if (!node || node.kind !== 'resourceNode') return -1;
    const max = this.maxSlotsForNode(node);
    if (max <= 0) return -1;
    const used = new Set(this.workersOnNode(nodeId).map((w) => w.slotIndex));
    for (let i = 0; i < max; i++) {
      if (!used.has(i)) return i;
    }
    return -1;
  }

  nodeIsGatherable(node: ResourceNode): boolean {
    return node.alive && node.remaining > 0 && node.replenishTimer <= 0;
  }

  /**
   * Nearest gatherable node of type with a free slot.
   * Optionally exclude a node id (e.g. just depleted).
   */
  findWorkNode(
    x: number,
    y: number,
    resource: ResourceKind,
    excludeId: EntityId | null = null,
  ): { node: ResourceNode; slot: number } | null {
    let best: ResourceNode | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (!e.alive || e.kind !== 'resourceNode') continue;
      if (e.id === excludeId) continue;
      if (e.resource !== resource) continue;
      // Workers belong to the home economy. Wild resources are for the hero to
      // explore, rather than destinations that silently pull workers off-map.
      if (!this.isHomeTile(Math.floor(e.x), Math.floor(e.y))) continue;
      if (!this.nodeIsGatherable(e)) continue;
      if (this.freeSlotIndex(e.id) < 0) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return null;
    const slot = this.freeSlotIndex(best.id);
    if (slot < 0) return null;
    return { node: best, slot };
  }

  /** Idle park position near base so idlers do not stack. */
  idleParkPos(workerId: EntityId): { x: number; y: number } {
    const base = this.base();
    const origin = this.baseFootprintOrigin();
    if (!base || !origin) return { x: 8, y: 8 };
    const idlers = [...this.entities.values()]
      .filter((e): e is Worker => e.alive && e.kind === 'worker' && e.job === 'idle')
      .sort((a, b) => a.id - b.id);
    let idx = idlers.findIndex((w) => w.id === workerId);
    if (idx < 0) idx = idlers.length;
    const angle = (idx / Math.max(1, CONFIG.maxWorkers)) * Math.PI * 2;
    const r = 1.6 + (idx % 3) * 0.25;
    const cx = origin.gx + 1;
    const cy = origin.gy + 2.4;
    return {
      x: cx + Math.cos(angle) * r * 0.4,
      y: cy + Math.sin(angle) * r * 0.35,
    };
  }

  /** True if a world position is clear of other living ground units. */
  isSpawnClear(x: number, y: number, minDist = CONFIG.spawnMinSeparation, ignoreId?: EntityId): boolean {
    if (!this.isWalkable(Math.floor(x), Math.floor(y))) return false;
    const min2 = minDist * minDist;
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      if (ignoreId != null && e.id === ignoreId) continue;
      if (e.kind !== 'hero' && e.kind !== 'worker' && e.kind !== 'enemy') continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy < min2) return false;
    }
    return true;
  }

  /**
   * Find a walkable spawn point near the base that does not overlap other units.
   */
  findClearSpawnNearBase(): { x: number; y: number } {
    const base = this.base();
    const origin = this.baseFootprintOrigin();
    const fallback = base
      ? { x: base.spawnX, y: base.spawnY }
      : { x: 8.5, y: 8.5 };

    if (!origin) {
      if (this.isSpawnClear(fallback.x, fallback.y)) return fallback;
      return fallback;
    }

    // Expanding ring of tile centers around the base footprint
    for (let r = 1; r <= 6; r++) {
      const candidates: { x: number; y: number }[] = [];
      for (let dy = -r; dy <= r + 1; dy++) {
        for (let dx = -r; dx <= r + 1; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 1) {
            // outer ring only for r>1; for r=1 fill adjacent
            if (r > 1) continue;
          }
          const gx = origin.gx + dx;
          const gy = origin.gy + dy;
          // Skip solid base footprint
          if (gx >= origin.gx && gx < origin.gx + 2 && gy >= origin.gy && gy < origin.gy + 2) {
            continue;
          }
          if (!this.isWalkable(gx, gy)) continue;
          // Prefer south/east slightly (stable order)
          candidates.push({ x: gx + 0.5, y: gy + 0.5 });
        }
      }
      // Stable sort: south first, then east
      candidates.sort((a, b) => b.y - a.y || b.x - a.x);
      for (const c of candidates) {
        // Small deterministic jitter so multiple workers on different tiles still separate
        const jx = ((Math.floor(c.x * 10) % 5) - 2) * 0.04;
        const jy = ((Math.floor(c.y * 10) % 5) - 2) * 0.04;
        const px = c.x + jx;
        const py = c.y + jy;
        if (this.isSpawnClear(px, py)) return { x: px, y: py };
        if (this.isSpawnClear(c.x, c.y)) return c;
      }
    }

    // Last resort: base spawn even if crowded
    return fallback;
  }

  get<T extends Entity>(id: EntityId): T | undefined {
    return this.entities.get(id) as T | undefined;
  }

  base(): BaseBuilding | undefined {
    return this.get<BaseBuilding>(this.baseId);
  }

  hero(): Hero | undefined {
    return this.get<Hero>(this.heroId);
  }

  listByKind<K extends Entity['kind']>(kind: K): Extract<Entity, { kind: K }>[] {
    const out: Extract<Entity, { kind: K }>[] = [];
    for (const e of this.entities.values()) {
      if (e.alive && e.kind === kind) out.push(e as Extract<Entity, { kind: K }>);
    }
    return out;
  }

  workerCount(): number {
    return this.listByKind('worker').length;
  }

  removeDead(): void {
    for (const [id, e] of this.entities) {
      if (e.kind === 'resourceNode' || e.kind === 'base') continue;
      if (e.kind === 'loot') {
        if (e.items.length === 0) {
          this.entities.delete(id);
          if (this.selectedId === id) this.selectedId = null;
        }
        continue;
      }
      if (!e.alive) {
        this.entities.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
    }
  }

  /** Remove an entity by ID (used for depleted fishing spots). */
  removeEntity(id: EntityId): void {
    this.entities.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  nearestResourceNode(x: number, y: number, resource: ResourceKind): ResourceNode | null {
    return this.findWorkNode(x, y, resource)?.node ?? null;
  }

  entityAtTile(gx: number, gy: number, kinds?: Entity['kind'][]): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      if (kinds && !kinds.includes(e.kind)) continue;
      // Hide unexplored entities from picking (except own units / base)
      if (e.kind === 'enemy' || e.kind === 'resourceNode') {
        if (!this.isExplored(Math.floor(e.x), Math.floor(e.y))) continue;
      }
      if (e.kind === 'resourceNode') {
        if (Math.floor(e.x) === gx && Math.floor(e.y) === gy) return e;
        continue;
      }
      if (e.kind === 'base') {
        const bx = Math.floor(e.x) - 1;
        const by = Math.floor(e.y) - 1;
        if (gx >= bx && gx < bx + 2 && gy >= by && gy < by + 2) return e;
        continue;
      }
      // Looser than pure center — units can sit slightly off-tile while pathing
      const d = (e.x - (gx + 0.5)) ** 2 + (e.y - (gy + 0.5)) ** 2;
      if (d < 0.9 ** 2 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Continuous world-space pick for iso clicks (sprite body ≠ foot tile).
   * Prefer this for combat/selection so clicking a tall model still hits the unit.
   */
  nearestEntityAt(
    wx: number,
    wy: number,
    kinds?: Entity['kind'][],
    radius = 1.25,
  ): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    const r2 = radius * radius;
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      if (kinds && !kinds.includes(e.kind)) continue;
      if (e.kind === 'enemy' || e.kind === 'resourceNode') {
        if (!this.isExplored(Math.floor(e.x), Math.floor(e.y))) continue;
      }
      if (e.kind === 'base') {
        // Distance to 2×2 footprint center
        const dx = e.x - wx;
        const dy = e.y - wy;
        const d = dx * dx + dy * dy;
        // Slightly larger radius for big footprint
        if (d < (radius + 0.6) ** 2 && d < bestD) {
          bestD = d;
          best = e;
        }
        continue;
      }
      if (e.kind === 'resourceNode') {
        const dx = e.x - wx;
        const dy = e.y - wy;
        const d = dx * dx + dy * dy;
        if (d < r2 && d < bestD) {
          bestD = d;
          best = e;
        }
        continue;
      }
      const dx = e.x - wx;
      const dy = e.y - wy;
      const d = dx * dx + dy * dy;
      if (d < r2 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  jobForResource(r: ResourceKind): WorkerJob {
    if (r === 'stone') return 'mine';
    if (r === 'wood') return 'log';
    return 'farm';
  }

  resourceForJob(job: WorkerJob): ResourceKind | null {
    if (job === 'mine') return 'stone';
    if (job === 'log') return 'wood';
    if (job === 'farm') return 'food';
    return null;
  }

  toJSON(): string {
    return JSON.stringify({
      worldSeed: this.worldSeed,
      tiles: [...this.tiles.entries()],
      loadedChunks: [...this.loadedChunks],
      explored: [...this.explored],
      stockpile: this.stockpile,
      coins: this.coins,
      inventory: this.inventory,
      nextId: this.nextId,
      nextPackId: this.nextPackId,
      nextItemUid: this.nextItemUid,
      selectedId: this.selectedId,
      status: this.status,
      baseId: this.baseId,
      heroId: this.heroId,
      entities: [...this.entities.values()],
      minGx: this.minGx,
      maxGx: this.maxGx,
      minGy: this.minGy,
      maxGy: this.maxGy,
      pendingFishRespawns: this.pendingFishRespawns,
    });
  }

  fromJSON(raw: string): boolean {
    try {
      const data = JSON.parse(raw) as {
        worldSeed: number;
        tiles: [string, Tile][];
        loadedChunks: string[];
        explored: string[];
        stockpile: Stockpile;
        coins?: CoinPurse;
        inventory?: Inventory;
        nextId: number;
        nextPackId?: number;
        nextItemUid?: number;
        selectedId: EntityId | null;
        status: GameStatus;
        baseId: EntityId;
        heroId: EntityId;
        entities: Entity[];
        minGx: number;
        maxGx: number;
        minGy: number;
        maxGy: number;
        pendingFishRespawns?: { timer: number; nearX: number; nearY: number }[];
      };
      this.worldSeed = data.worldSeed;
      this.tiles = new Map(data.tiles);
      this.loadedChunks = new Set(data.loadedChunks);
      this.explored = new Set(data.explored);
      this.stockpile = data.stockpile;
      this.coins = data.coins ?? { gold: 0, silver: 0, copper: 0 };
      this.inventory = data.inventory ?? createEmptyInventory();
      this.inventoryOpen = false;
      this.expectedIncome = { stone: 0, wood: 0, food: 0 };
      this.floatTexts = [];
      this.nextFloatId = 1;
      this.nextId = data.nextId;
      this.nextPackId = data.nextPackId ?? 1;
      this.nextItemUid = data.nextItemUid ?? 1;
      this.selectedId = data.selectedId;
      this.status = data.status;
      this.baseId = data.baseId;
      this.heroId = data.heroId;
      this.minGx = data.minGx;
      this.maxGx = data.maxGx;
      this.minGy = data.minGy;
      this.maxGy = data.maxGy;
      this.tickAcc = 0;
      this.tickCount = 0;
      this.pendingMove = null;
      this.pendingAttackId = null;
      this.pendingFishId = null;
      this.pendingFishRespawns = data.pendingFishRespawns ?? [];
      this.entities = new Map();
      for (const e of data.entities) {
        const withPrev = {
          ...e,
          prevX: (e as Entity).prevX ?? e.x,
          prevY: (e as Entity).prevY ?? e.y,
        };
        if (e.kind === 'worker') {
          const w = withPrev as Worker;
          this.entities.set(w.id, {
            ...w,
            phase: w.phase ?? 'idle',
            slotIndex: w.slotIndex ?? -1,
            gatherTimer: w.gatherTimer ?? 0,
            carried: w.carried ?? 0,
            carriedResource: w.carriedResource ?? null,
            constructionId: w.constructionId ?? null,
          });
        } else if (e.kind === 'resourceNode') {
          const n = withPrev as ResourceNode;
          this.entities.set(n.id, {
            ...n,
            maxRemaining: n.maxRemaining ?? CONFIG.nodeCapacity,
            replenishTimer: n.replenishTimer ?? 0,
            remaining: Math.min(n.remaining ?? CONFIG.nodeCapacity, n.maxRemaining ?? CONFIG.nodeCapacity),
          });
        } else if (e.kind === 'hero') {
          const h = withPrev as Hero;
          this.entities.set(h.id, {
            ...h,
            armor: h.armor ?? 0,
            fishingTimer: h.fishingTimer ?? 0,
            fishingNodeId: h.fishingNodeId ?? null,
            combatTimer: h.combatTimer ?? 99,
            combatTargetId: h.combatTargetId ?? null,
            queuedTargetId: h.queuedTargetId ?? null,
            fightQueue: h.fightQueue ?? [],
            combatStandX: h.combatStandX ?? null,
            combatStandY: h.combatStandY ?? null,
            combatEngaged: h.combatEngaged ?? false,
            combatTurn: h.combatTurn ?? 'hero',
            attackTicks: h.attackTicks ?? CONFIG.heroAttackTicks,
            skills: h.skills ?? createDefaultSkills(),
          });
        } else if (e.kind === 'enemy') {
          const en = withPrev as Enemy;
          const sp = en.species && ENEMY_SPECIES[en.species] ? en.species : 'goblin';
          const def = ENEMY_SPECIES[sp];
          this.entities.set(en.id, {
            ...en,
            species: sp,
            leashing: en.leashing ?? false,
            fightRole: en.fightRole ?? 'idle',
            queueIndex: en.queueIndex ?? -1,
            attackTicks: en.attackTicks ?? def.attackTicks,
            defenseLevel: en.defenseLevel ?? def.defenseLevel,
            damage: en.damage ?? def.maxHit,
          });
        } else if (e.kind === 'loot') {
          this.entities.set(e.id, withPrev as LootPile);
        } else if (e.kind === 'base') {
          const b = withPrev as BaseBuilding;
          this.entities.set(b.id, {
            ...b,
            upgradeLevel: b.upgradeLevel ?? 0,
            upgrading: b.upgrading ?? false,
            upgradeProgress: b.upgradeProgress ?? 0,
            upgradeSeconds: b.upgradeSeconds ?? CONFIG.baseUpgradeSeconds,
            upgradeBuilderIds: b.upgradeBuilderIds ?? [],
          });
        } else {
          this.entities.set(e.id, withPrev as Entity);
        }
      }
      const hero = this.hero();
      if (hero) applyHeroStats(hero, this.inventory);
      this.paused = false;
      this.message = '';
      return true;
    } catch {
      return false;
    }
  }
}
