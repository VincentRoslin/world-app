import { CONFIG } from '../config';
import {
  getItemDef,
  itemAttackBonus,
  itemDefenseBonus,
  itemStrengthBonus,
  rarityColor,
} from '../items/catalog';
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

/**
 * Sum bonuses from every equipped item.
 * Bags / inventory items do NOT count — only paper-doll slots.
 */
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

/**
 * Melee max hit from Strength level + equipment strength bonus.
 *
 * Why this formula exists:
 * - Strength level is the main "I hit harder" lever.
 * - Gear strengthBonus multiplies with the effective level (not pure additive).
 * - The +8 and /640 constants scale so low levels still deal ≥1 damage.
 *
 * effectiveStrength = Strength + styleBonus + 8
 *   (styleBonus = +3 "aggressive" — we dual-train Atk/Str XP but lean damage)
 * maxHit = floor(0.5 + effectiveStrength * (equipmentStrength + 64) / 640)
 *
 * Used by Combat.rollHeroHit and shown on the Character stats panel.
 */
export function estimateMaxHit(skills: Skills, inv: Inventory): number {
  const gear = getStats(inv);
  const styleBonus = 3; // Aggressive stance bonus
  const effectiveStrength = skills.strength.level + styleBonus + 8;
  const equipmentStrength = gear.strengthBonus;
  const maxHit = Math.floor(0.5 + (effectiveStrength * (equipmentStrength + 64)) / 640);
  return Math.max(1, maxHit);
}

/**
 * Attack roll fed into Combat.meleeHitChance (higher → more hits land).
 * effectiveAttack = Attack + styleBonus + 8
 * (styleBonus = +1 "controlled" — middle ground matching dual Atk/Str XP grants)
 *
 * Roll = effectiveAttack * (gear attackBonus + 64)
 * The +64 keeps bare-handed accuracy from collapsing to near-zero.
 */
export function attackRoll(skills: Skills, inv: Inventory): number {
  const gear = getStats(inv);
  const styleBonus = 1; // Controlled stance
  const effectiveAttack = skills.attack.level + styleBonus + 8;
  return effectiveAttack * (gear.attackBonus + 64);
}

/** Same structure as attackRoll, but for Defense when monsters swing at the hero. */
export function defenceRoll(skills: Skills, inv: Inventory): number {
  const gear = getStats(inv);
  const styleBonus = 1; // Controlled / block-ish
  const effectiveDefence = skills.defense.level + styleBonus + 8;
  return effectiveDefence * (gear.defenseBonus + 64);
}

/** Base HP + Defense level + gear maxHp. */
export function heroMaxHp(skills: Skills, inv: Inventory): number {
  const gear = getStats(inv);
  return CONFIG.heroHp + skills.defense.level + gear.maxHp;
}

/**
 * Push derived combat stats onto the hero entity after equip / level-up.
 * Only equipped items count (see getStats).
 * Clamps current HP so a max-HP drop never leaves you over full.
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

/** Pick paper-doll key for a catalog slot (rings fill ring1 then ring2). */
function equipKeyForSlot(inv: Inventory, slot: EquipSlot): EquipKey | null {
  if (slot === 'bag') return null;
  if (slot === 'ring') {
    if (!inv.equipped.ring1) return 'ring1';
    if (!inv.equipped.ring2) return 'ring2';
    return 'ring1'; // replace first when both full
  }
  if (slot === 'cloak') return 'cloak';
  // Item slot names match equip keys for everything else
  return slot as EquipKey;
}

export function canEquipTo(defSlot: EquipSlot | 'none', key: EquipKey): boolean {
  if (defSlot === 'none' || defSlot === 'bag') return false;
  if (defSlot === 'mainHand') return key === 'mainHand';
  if (defSlot === 'offHand') return key === 'offHand';
  if (defSlot === 'ring') return key === 'ring1' || key === 'ring2';
  if (defSlot === 'cloak') return key === 'cloak';
  return defSlot === key;
}

/** Ensure save data has all equip keys (migrate legacy `ring` → `ring1`). */
export function normalizeEquipped(inv: Inventory): void {
  const eq = inv.equipped as Record<string, ItemInstance | null>;
  if (eq.ring != null && eq.ring1 == null) {
    eq.ring1 = eq.ring;
  }
  delete eq.ring;
  for (const k of EQUIP_KEYS) {
    if (!(k in eq)) eq[k] = null;
  }
  inv.equipped = eq as Inventory['equipped'];
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

  const key = targetKey ?? equipKeyForSlot(inv, def.slot) ?? undefined;
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

/**
 * Plain multi-line tooltip text (newline-stacked, WoW-style).
 * Prefer itemTooltipHtml for colored UI tooltips.
 */
export function itemTooltip(inst: ItemInstance, skills?: Skills, extraLine?: string): string {
  return itemTooltipLines(inst, skills, extraLine).join('\n');
}

export interface TooltipLine {
  text: string;
  /** CSS class on the line (tt-name, tt-type, tt-stat, …) */
  cls: string;
  /** Optional inline color (rarity name, unmet req red). */
  color?: string;
}

/** Structured lines for a vertical (downward-stacking) item tooltip. */
export function itemTooltipLines(
  inst: ItemInstance,
  skills?: Skills,
  extraLine?: string,
): TooltipLine[] {
  const def = getItemDef(inst.defId);
  if (!def) return [{ text: 'Unknown item', cls: 'tt-name' }];

  const qty = inst.quantity ?? 1;
  const lines: TooltipLine[] = [];
  const name = qty > 1 ? `${def.name} ×${qty}` : def.name;
  lines.push({ text: name, cls: 'tt-name', color: rarityColor(def.rarity) });

  // Type line: "Uncommon Sword" / "Rare Chest" etc.
  const slotLabel =
    def.slot === 'mainHand' || def.slot === 'offHand'
      ? (def.weaponType ?? def.slot)
      : def.slot === 'none'
        ? 'Misc'
        : def.slot === 'bag'
          ? 'Bag'
          : def.slot;
  const rarityLabel = def.rarity.charAt(0).toUpperCase() + def.rarity.slice(1);
  lines.push({
    text: `${rarityLabel} ${slotLabel}`,
    cls: 'tt-type',
    color: rarityColor(def.rarity),
  });

  const atk = itemAttackBonus(def);
  const str = itemStrengthBonus(def);
  const defb = itemDefenseBonus(def);
  if (atk) lines.push({ text: `+${atk} Attack`, cls: 'tt-stat' });
  if (str) lines.push({ text: `+${str} Strength`, cls: 'tt-stat' });
  if (defb) lines.push({ text: `+${defb} Defense`, cls: 'tt-stat' });
  if (def.maxHp) lines.push({ text: `+${def.maxHp} Health`, cls: 'tt-stat' });
  if (def.bagSlots) lines.push({ text: `${def.bagSlots} bag slots`, cls: 'tt-stat' });
  if (def.id === 'raw_fish') lines.push({ text: 'Use: Restores 3 Health', cls: 'tt-use' });

  const max = maxStackFor(inst.defId);
  if (max > 1) lines.push({ text: `Stack: ${qty} / ${max}`, cls: 'tt-meta' });

  if (def.requirements) {
    const bits: string[] = [];
    if (def.requirements.attack) bits.push(`Attack ${def.requirements.attack}`);
    if (def.requirements.strength) bits.push(`Strength ${def.requirements.strength}`);
    if (def.requirements.defense) bits.push(`Defense ${def.requirements.defense}`);
    if (def.requirements.fishing) bits.push(`Fishing ${def.requirements.fishing}`);
    const ok = skills ? meetsRequirements(skills, def.requirements) : true;
    lines.push({
      text: `Requires ${bits.join(', ')}`,
      cls: ok ? 'tt-req' : 'tt-req tt-req-fail',
      color: ok ? undefined : '#f85149',
    });
  }

  if (extraLine) lines.push({ text: extraLine, cls: 'tt-extra' });
  return lines;
}

/** HTML for inv/shop tooltip — lines stack top → bottom like classic RPG tooltips. */
export function itemTooltipHtml(
  inst: ItemInstance,
  skills?: Skills,
  extraLine?: string,
): string {
  return itemTooltipLines(inst, skills, extraLine)
    .map((ln) => {
      const style = ln.color ? ` style="color:${ln.color}"` : '';
      const safe = escapeHtml(ln.text);
      return `<div class="tt-line ${ln.cls}"${style}>${safe}</div>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
