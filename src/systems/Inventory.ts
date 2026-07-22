import { CONFIG } from '../config';
import { getItemDef, itemAttackBonus, itemDefenseBonus, itemStrengthBonus } from '../items/catalog';
import type {
  EquipKey,
  EquipSlot,
  GearStats,
  Inventory,
  ItemInstance,
  SkillRequirements,
} from '../items/types';
import { EQUIP_KEYS } from '../items/types';
import type { Hero } from '../core/types';
import type { Skills } from './Skills';
import { skillLabel } from './Skills';

export function createEmptyInventory(): Inventory {
  const equipped = {} as Inventory['equipped'];
  for (const k of EQUIP_KEYS) equipped[k] = null;
  return {
    equipped,
    bagEquip: [null, null, null, null],
    mainBag: Array.from({ length: CONFIG.mainBagSlots }, () => null),
    extraBags: [null, null, null, null],
  };
}

export function getStats(inv: Inventory): GearStats {
  const stats: GearStats = {
    attackBonus: 0,
    strengthBonus: 0,
    defenseBonus: 0,
    maxHp: 0,
  };
  for (const k of EQUIP_KEYS) {
    const inst = inv.equipped[k];
    if (!inst) continue;
    const def = getItemDef(inst.defId);
    if (!def) continue;
    stats.attackBonus += itemAttackBonus(def);
    stats.strengthBonus += itemStrengthBonus(def);
    stats.defenseBonus += itemDefenseBonus(def);
    stats.maxHp += def.maxHp ?? 0;
  }
  return stats;
}

/** Max hit estimate (squished OSRS-inspired). */
export function estimateMaxHit(skills: Skills, inv: Inventory): number {
  const gear = getStats(inv);
  const effStr = skills.strength.level + Math.floor(gear.strengthBonus / 3);
  return Math.max(1, 1 + Math.floor((effStr * (gear.strengthBonus + 64)) / 640));
}

export function heroMaxHp(skills: Skills, inv: Inventory): number {
  const gear = getStats(inv);
  return CONFIG.heroHp + skills.defense.level + gear.maxHp;
}

/**
 * Apply gear + skills onto hero. Only equipped items count.
 */
export function applyHeroStats(hero: Hero, inv: Inventory): void {
  const s = getStats(inv);
  const newMax = heroMaxHp(hero.skills, inv);
  hero.damage = estimateMaxHit(hero.skills, inv);
  hero.armor = s.defenseBonus;
  hero.maxHp = newMax;
  hero.hp = Math.max(0, Math.min(hero.hp, newMax));
}

export function meetsRequirements(skills: Skills, req?: SkillRequirements): boolean {
  if (!req) return true;
  if (req.attack != null && skills.attack.level < req.attack) return false;
  if (req.strength != null && skills.strength.level < req.strength) return false;
  if (req.defense != null && skills.defense.level < req.defense) return false;
  if (req.fishing != null && skills.fishing.level < req.fishing) return false;
  return true;
}

export function requirementMessage(skills: Skills, req?: SkillRequirements): string | null {
  if (!req) return null;
  const missing: string[] = [];
  if (req.attack != null && skills.attack.level < req.attack) {
    missing.push(`${skillLabel('attack')} ${req.attack}`);
  }
  if (req.strength != null && skills.strength.level < req.strength) {
    missing.push(`${skillLabel('strength')} ${req.strength}`);
  }
  if (req.defense != null && skills.defense.level < req.defense) {
    missing.push(`${skillLabel('defense')} ${req.defense}`);
  }
  if (req.fishing != null && skills.fishing.level < req.fishing) {
    missing.push(`${skillLabel('fishing')} ${req.fishing}`);
  }
  if (missing.length === 0) return null;
  return `You need ${missing.join(', ')} to equip this.`;
}

export function maxStackFor(defId: string): number {
  const def = getItemDef(defId);
  if (!def) return 1;
  if (def.maxStack != null) return def.maxStack;
  // Unequippable junk stacks; gear/bags do not
  if (def.slot === 'none') return 5;
  return 1;
}

export function isStackable(defId: string): boolean {
  return maxStackFor(defId) > 1;
}

export function findFreeBagSlot(
  inv: Inventory,
): { bag: 'main' | number; index: number } | null {
  for (let i = 0; i < inv.mainBag.length; i++) {
    if (!inv.mainBag[i]) return { bag: 'main', index: i };
  }
  for (let b = 0; b < inv.extraBags.length; b++) {
    const bag = inv.extraBags[b];
    if (!bag) continue;
    for (let i = 0; i < bag.length; i++) {
      if (!bag[i]) return { bag: b, index: i };
    }
  }
  return null;
}

/** Iterate all bag slots for stacking. */
function forEachBagSlot(
  inv: Inventory,
  fn: (bag: 'main' | number, index: number, item: ItemInstance | null) => boolean | void,
): void {
  for (let i = 0; i < inv.mainBag.length; i++) {
    if (fn('main', i, inv.mainBag[i] ?? null) === false) return;
  }
  for (let b = 0; b < inv.extraBags.length; b++) {
    const bag = inv.extraBags[b];
    if (!bag) continue;
    for (let i = 0; i < bag.length; i++) {
      if (fn(b, i, bag[i] ?? null) === false) return;
    }
  }
}

/**
 * Add item (or stack qty). Gear never stacks. Junk stacks up to maxStack (default 5)
 * when same defId (same item & quality via catalog rarity).
 * Returns false if nothing could be placed.
 */
/**
 * Add item (or stack qty). Pass `allocUid` when splitting stacks so UIDs stay unique.
 */
export function addItem(
  inv: Inventory,
  item: ItemInstance,
  allocUid?: () => number,
): boolean {
  const qty = Math.max(1, item.quantity ?? 1);
  const max = maxStackFor(item.defId);
  let remaining = qty;
  let nextUid = item.uid;
  let usedFirstUid = false;

  // Merge into existing stacks of same defId
  if (max > 1) {
    forEachBagSlot(inv, (_bag, _index, existing) => {
      if (!existing || existing.defId !== item.defId) return;
      const space = max - (existing.quantity ?? 1);
      if (space <= 0) return;
      const add = Math.min(space, remaining);
      existing.quantity = (existing.quantity ?? 1) + add;
      remaining -= add;
      if (remaining <= 0) return false;
    });
  }

  if (remaining <= 0) return true;

  while (remaining > 0) {
    const free = findFreeBagSlot(inv);
    if (!free) return remaining < qty; // partial success if some added
    const place = Math.min(max, remaining);
    const uid = !usedFirstUid ? nextUid : allocUid ? allocUid() : nextUid + 1;
    usedFirstUid = true;
    nextUid = uid;
    setBagItem(inv, free.bag, free.index, {
      uid,
      defId: item.defId,
      quantity: place,
    });
    remaining -= place;
  }
  return true;
}

export function getBagItem(
  inv: Inventory,
  bag: 'main' | number,
  index: number,
): ItemInstance | null {
  if (bag === 'main') return inv.mainBag[index] ?? null;
  return inv.extraBags[bag]?.[index] ?? null;
}

export function setBagItem(
  inv: Inventory,
  bag: 'main' | number,
  index: number,
  item: ItemInstance | null,
): void {
  if (bag === 'main') {
    inv.mainBag[index] = item;
    return;
  }
  const b = inv.extraBags[bag];
  if (b) b[index] = item;
}

function equipKeyForSlot(slot: EquipSlot): EquipKey | null {
  if (slot === 'bag') return null;
  return slot as EquipKey;
}

export function canEquipTo(defSlot: EquipSlot | 'none', key: EquipKey): boolean {
  if (defSlot === 'none' || defSlot === 'bag') return false;
  if (defSlot === 'mainHand') return key === 'mainHand';
  if (defSlot === 'offHand') return key === 'offHand';
  return defSlot === key;
}

export function equipFromBag(
  inv: Inventory,
  bag: 'main' | number,
  index: number,
  skills: Skills,
  targetKey?: EquipKey,
): { ok: boolean; message?: string } {
  const item = getBagItem(inv, bag, index);
  if (!item) return { ok: false, message: 'Empty slot.' };
  const def = getItemDef(item.defId);
  if (!def || def.slot === 'none') return { ok: false, message: 'That item cannot be equipped.' };

  if (def.slot === 'bag') {
    const ok = equipBagItem(inv, bag, index);
    return ok ? { ok: true } : { ok: false, message: 'Could not equip bag.' };
  }

  const reqMsg = requirementMessage(skills, def.requirements);
  if (reqMsg) return { ok: false, message: reqMsg };

  const key = targetKey ?? equipKeyForSlot(def.slot) ?? undefined;
  if (!key || !canEquipTo(def.slot, key)) {
    return { ok: false, message: 'Wrong equipment slot.' };
  }

  if (key === 'mainHand' && def.weaponType === 'shield') {
    return { ok: false, message: 'Shields go in the off-hand.' };
  }
  if (key === 'offHand') {
    if (def.weaponType && !['shield', 'sword', 'axe', 'dagger'].includes(def.weaponType)) {
      return { ok: false, message: 'Cannot equip that in off-hand.' };
    }
  }

  const previous = inv.equipped[key];
  inv.equipped[key] = item;
  setBagItem(inv, bag, index, previous);
  return { ok: true };
}

function equipBagItem(inv: Inventory, bag: 'main' | number, index: number): boolean {
  const item = getBagItem(inv, bag, index);
  if (!item) return false;
  const def = getItemDef(item.defId);
  if (!def || def.slot !== 'bag') return false;

  let slot = inv.bagEquip.findIndex((b) => !b);
  if (slot < 0) slot = 0;

  const previous = inv.bagEquip[slot] ?? null;
  if (previous && inv.extraBags[slot]?.some((x) => x != null)) return false;

  inv.bagEquip[slot] = item;
  inv.extraBags[slot] = Array.from({ length: def.bagSlots ?? CONFIG.extraBagSlots }, () => null);
  setBagItem(inv, bag, index, previous);
  return true;
}

export function unequip(inv: Inventory, key: EquipKey): boolean {
  const item = inv.equipped[key];
  if (!item) return false;
  if (!addItem(inv, item)) return false;
  inv.equipped[key] = null;
  return true;
}

export function unequipBag(inv: Inventory, bagSlot: number): boolean {
  const item = inv.bagEquip[bagSlot];
  if (!item) return false;
  if (inv.extraBags[bagSlot]?.some((x) => x != null)) return false;
  if (!addItem(inv, item)) return false;
  inv.bagEquip[bagSlot] = null;
  inv.extraBags[bagSlot] = null;
  return true;
}

export function itemTooltip(inst: ItemInstance, skills?: Skills): string {
  const def = getItemDef(inst.defId);
  if (!def) return 'Unknown item';
  const qty = inst.quantity ?? 1;
  const parts = [qty > 1 ? `${def.name} ×${qty}` : def.name, `(${def.rarity})`];
  const atk = itemAttackBonus(def);
  const str = itemStrengthBonus(def);
  const defb = itemDefenseBonus(def);
  if (atk) parts.push(`+${atk} Atk`);
  if (str) parts.push(`+${str} Str`);
  if (defb) parts.push(`+${defb} Def`);
  if (def.maxHp) parts.push(`+${def.maxHp} HP`);
  if (def.bagSlots) parts.push(`${def.bagSlots} slots`);
  if (def.id === 'raw_fish') parts.push('Heals 3 HP');
  const max = maxStackFor(inst.defId);
  if (max > 1) parts.push(`Stack ${qty}/${max}`);
  if (def.requirements) {
    const bits: string[] = [];
    if (def.requirements.attack) bits.push(`Atk ${def.requirements.attack}`);
    if (def.requirements.strength) bits.push(`Str ${def.requirements.strength}`);
    if (def.requirements.defense) bits.push(`Def ${def.requirements.defense}`);
    if (def.requirements.fishing) bits.push(`Fish ${def.requirements.fishing}`);
    const ok = skills ? meetsRequirements(skills, def.requirements) : true;
    parts.push(ok ? `Req: ${bits.join(', ')}` : `Req: ${bits.join(', ')} (not met)`);
  }
  return parts.join(' · ');
}
