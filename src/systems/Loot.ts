import { CONFIG } from '../config';
import { addCoins } from '../core/currency';
import { dist } from '../core/math';
import { rollNormalMobDropDefId, rollNormalMobGearDropDefId } from '../items/catalog';
import { addItem } from './Inventory';
import type { World } from '../world/World';

/** Spawn 1–2 items as a ground loot pile at (x, y). */
export function spawnLootAt(world: World, x: number, y: number): void {
  const count = Math.random() < 0.3 ? 2 : 1;
  const items = [];
  for (let i = 0; i < count; i++) {
    const defId =
      Math.random() < CONFIG.normalMobGearDropChance
        ? rollNormalMobGearDropDefId()
        : rollNormalMobDropDefId();
    items.push(world.createItem(defId));
  }
  // Coins go straight into the purse (never bag slots); auto-convert 100c→1s, 100s→1g.
  addCoins(world.coins, {
    copper: 4 + Math.floor(Math.random() * 9),
    silver: Math.random() < 0.18 ? 1 : 0,
  });
  // Slight offset so piles don't perfectly stack on corpses
  const jx = (Math.random() - 0.5) * 0.3;
  const jy = (Math.random() - 0.5) * 0.3;
  world.createLoot(x + jx, y + jy, items);
}

/** Auto-pickup loot near the hero into inventory. */
export function updateLootPickup(world: World): void {
  const hero = world.hero();
  if (!hero || !hero.alive) return;

  for (const e of world.entities.values()) {
    if (!e.alive || e.kind !== 'loot') continue;
    if (dist(hero.x, hero.y, e.x, e.y) > CONFIG.lootPickupRange) continue;

    const before = e.items.length;
    const remaining = [];
    let picked = 0;
    for (const item of e.items) {
      if (addItem(world.inventory, item, () => world.allocItemUid())) {
        picked++;
      } else {
        remaining.push(item);
      }
    }
    e.items = remaining;
    if (picked > 0) {
      world.spawnFloatText(hero.x, hero.y - 0.2, `+${picked} item${picked > 1 ? 's' : ''}`, '#e3b341');
    }
    if (remaining.length > 0 && remaining.length < before) {
      world.message = 'Inventory full — some loot left on ground.';
    }
  }
}
