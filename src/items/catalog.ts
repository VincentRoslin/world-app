import type { ItemDef } from './types';

/** Static item catalog — squished OSRS-style bonuses + skill reqs. */
export const ITEM_CATALOG: Record<string, ItemDef> = {
  rusty_sword: {
    id: 'rusty_sword',
    name: 'Rusty Sword',
    iconColor: '#8b949e',
    slot: 'mainHand',
    weaponType: 'sword',
    icon: 'sword',
    maxStack: 1,
    attackBonus: 4,
    strengthBonus: 3,
    rarity: 'common',
    dropWeight: 12,
  },
  iron_sword: {
    id: 'iron_sword',
    name: 'Iron Sword',
    iconColor: '#c9d1d9',
    slot: 'mainHand',
    weaponType: 'sword',
    icon: 'sword',
    maxStack: 1,
    attackBonus: 10,
    strengthBonus: 9,
    requirements: { attack: 10 },
    rarity: 'uncommon',
    dropWeight: 5,
  },
  steel_axe: {
    id: 'steel_axe',
    name: 'Steel Axe',
    iconColor: '#79c0ff',
    slot: 'mainHand',
    weaponType: 'axe',
    icon: 'axe',
    maxStack: 1,
    attackBonus: 14,
    strengthBonus: 16,
    requirements: { attack: 20, strength: 15 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  sharp_dagger: {
    id: 'sharp_dagger',
    name: 'Sharp Dagger',
    iconColor: '#ffa657',
    slot: 'mainHand',
    weaponType: 'dagger',
    icon: 'dagger',
    maxStack: 1,
    attackBonus: 7,
    strengthBonus: 4,
    rarity: 'common',
    dropWeight: 10,
  },
  kings_blade: {
    id: 'kings_blade',
    name: "King's Blade",
    iconColor: '#e3b341',
    slot: 'mainHand',
    weaponType: 'sword',
    icon: 'sword',
    maxStack: 1,
    attackBonus: 28,
    strengthBonus: 26,
    defenseBonus: 2,
    requirements: { attack: 40 },
    rarity: 'rare',
    dropWeight: 1,
  },

  wooden_shield: {
    id: 'wooden_shield',
    name: 'Wooden Shield',
    iconColor: '#8b5a2b',
    slot: 'offHand',
    weaponType: 'shield',
    icon: 'shield',
    maxStack: 1,
    defenseBonus: 5,
    rarity: 'common',
    dropWeight: 10,
  },
  iron_shield: {
    id: 'iron_shield',
    name: 'Iron Shield',
    iconColor: '#6e7681',
    slot: 'offHand',
    weaponType: 'shield',
    icon: 'shield',
    maxStack: 1,
    defenseBonus: 12,
    maxHp: 4,
    requirements: { defense: 10 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  offhand_dagger: {
    id: 'offhand_dagger',
    name: 'Parrying Dagger',
    iconColor: '#d2a8ff',
    slot: 'offHand',
    weaponType: 'dagger',
    icon: 'dagger',
    maxStack: 1,
    attackBonus: 3,
    strengthBonus: 2,
    requirements: { attack: 10 },
    rarity: 'uncommon',
    dropWeight: 5,
  },

  cloth_cap: {
    id: 'cloth_cap',
    name: 'Cloth Cap',
    iconColor: '#a371f7',
    slot: 'head',
    icon: 'helm',
    maxStack: 1,
    defenseBonus: 2,
    rarity: 'common',
    dropWeight: 10,
  },
  iron_helm: {
    id: 'iron_helm',
    name: 'Iron Helm',
    iconColor: '#8b949e',
    slot: 'head',
    icon: 'helm',
    maxStack: 1,
    defenseBonus: 8,
    maxHp: 3,
    requirements: { defense: 10 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  copper_amulet: {
    id: 'copper_amulet',
    name: 'Copper Amulet',
    iconColor: '#bf8700',
    slot: 'neck',
    icon: 'amulet',
    maxStack: 1,
    maxHp: 2,
    rarity: 'common',
    dropWeight: 8,
  },
  jade_pendant: {
    id: 'jade_pendant',
    name: 'Jade Pendant',
    iconColor: '#3fb950',
    slot: 'neck',
    icon: 'amulet',
    maxStack: 1,
    defenseBonus: 3,
    maxHp: 6,
    requirements: { defense: 20 },
    rarity: 'rare',
    dropWeight: 1,
  },
  padded_shoulders: {
    id: 'padded_shoulders',
    name: 'Padded Shoulders',
    iconColor: '#9a6700',
    slot: 'shoulders',
    icon: 'chest',
    maxStack: 1,
    defenseBonus: 3,
    rarity: 'common',
    dropWeight: 9,
  },
  leather_chest: {
    id: 'leather_chest',
    name: 'Leather Chest',
    iconColor: '#6e4b2a',
    slot: 'chest',
    icon: 'chest',
    maxStack: 1,
    defenseBonus: 5,
    rarity: 'common',
    dropWeight: 10,
  },
  chain_chest: {
    id: 'chain_chest',
    name: 'Chain Chest',
    iconColor: '#58a6ff',
    slot: 'chest',
    icon: 'chest',
    maxStack: 1,
    defenseBonus: 12,
    maxHp: 4,
    requirements: { defense: 20 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  cloth_wrist: {
    id: 'cloth_wrist',
    name: 'Cloth Wrists',
    iconColor: '#c9d1d9',
    slot: 'wrist',
    icon: 'gloves',
    maxStack: 1,
    defenseBonus: 1,
    rarity: 'common',
    dropWeight: 10,
  },
  leather_gloves: {
    id: 'leather_gloves',
    name: 'Leather Gloves',
    iconColor: '#a371f7',
    slot: 'hands',
    icon: 'gloves',
    maxStack: 1,
    defenseBonus: 2,
    attackBonus: 1,
    rarity: 'common',
    dropWeight: 9,
  },
  rope_belt: {
    id: 'rope_belt',
    name: 'Rope Belt',
    iconColor: '#d29922',
    slot: 'belt',
    icon: 'generic',
    maxStack: 1,
    defenseBonus: 1,
    rarity: 'common',
    dropWeight: 10,
  },
  leather_legs: {
    id: 'leather_legs',
    name: 'Leather Legs',
    iconColor: '#8b5a2b',
    slot: 'legs',
    icon: 'boots',
    maxStack: 1,
    defenseBonus: 4,
    rarity: 'common',
    dropWeight: 9,
  },
  iron_greaves: {
    id: 'iron_greaves',
    name: 'Iron Greaves',
    iconColor: '#6e7681',
    slot: 'legs',
    icon: 'boots',
    maxStack: 1,
    defenseBonus: 9,
    requirements: { defense: 10 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  worn_boots: {
    id: 'worn_boots',
    name: 'Worn Boots',
    iconColor: '#484f58',
    slot: 'feet',
    icon: 'boots',
    maxStack: 1,
    defenseBonus: 1,
    rarity: 'common',
    dropWeight: 11,
  },
  iron_boots: {
    id: 'iron_boots',
    name: 'Iron Boots',
    iconColor: '#8b949e',
    slot: 'feet',
    icon: 'boots',
    maxStack: 1,
    defenseBonus: 6,
    requirements: { defense: 10 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  copper_ring: {
    id: 'copper_ring',
    name: 'Copper Ring',
    iconColor: '#bf8700',
    slot: 'ring',
    icon: 'ring',
    maxStack: 1,
    strengthBonus: 1,
    rarity: 'common',
    dropWeight: 10,
  },
  silver_ring: {
    id: 'silver_ring',
    name: 'Silver Ring',
    iconColor: '#c9d1d9',
    slot: 'ring',
    icon: 'ring',
    maxStack: 1,
    attackBonus: 2,
    strengthBonus: 2,
    defenseBonus: 1,
    requirements: { attack: 5 },
    rarity: 'uncommon',
    dropWeight: 4,
  },
  gold_band: {
    id: 'gold_band',
    name: 'Gold Band',
    iconColor: '#e3b341',
    slot: 'ring',
    icon: 'ring',
    maxStack: 1,
    attackBonus: 3,
    strengthBonus: 3,
    maxHp: 5,
    requirements: { attack: 20, strength: 20 },
    rarity: 'rare',
    dropWeight: 1,
  },

  small_pouch: {
    id: 'small_pouch',
    name: 'Small Pouch',
    iconColor: '#3fb950',
    slot: 'bag',
    icon: 'bag',
    maxStack: 1,
    bagSlots: 16,
    rarity: 'uncommon',
    dropWeight: 3,
  },
  travel_pack: {
    id: 'travel_pack',
    name: 'Travel Pack',
    iconColor: '#238636',
    slot: 'bag',
    icon: 'bag',
    maxStack: 1,
    bagSlots: 16,
    rarity: 'rare',
    dropWeight: 1,
  },

  bone_chip: {
    id: 'bone_chip',
    name: 'Bone Chip',
    iconColor: '#e6edf3',
    slot: 'none',
    icon: 'bone',
    maxStack: 5,
    rarity: 'common',
    dropWeight: 14,
  },
  torn_cloth: {
    id: 'torn_cloth',
    name: 'Torn Cloth',
    iconColor: '#f85149',
    slot: 'none',
    icon: 'cloth',
    maxStack: 5,
    rarity: 'common',
    dropWeight: 12,
  },
  raw_fish: {
    id: 'raw_fish',
    name: 'Raw Fish',
    iconColor: '#388bfd',
    slot: 'none',
    icon: 'generic',
    maxStack: 10,
    rarity: 'common',
    dropWeight: 0,
  },
};

export function getItemDef(defId: string): ItemDef | undefined {
  return ITEM_CATALOG[defId];
}

export function rollDropDefId(): string {
  const defs = Object.values(ITEM_CATALOG);
  let total = 0;
  for (const d of defs) total += d.dropWeight;
  let r = Math.random() * total;
  for (const d of defs) {
    r -= d.dropWeight;
    if (r <= 0) return d.id;
  }
  return defs[0]!.id;
}

/** Most normal creatures drop simple materials; equipment is deliberately scarce. */
export function rollNormalMobDropDefId(): string {
  const materials = ['bone_chip', 'torn_cloth'];
  return materials[Math.floor(Math.random() * materials.length)]!;
}

/** A normal-mob gear roll never awards rare end-game equipment. */
export function rollNormalMobGearDropDefId(): string {
  const defs = Object.values(ITEM_CATALOG).filter(
    (d) => d.slot !== 'none' && d.slot !== 'bag' && d.rarity !== 'rare',
  );
  let total = 0;
  for (const d of defs) total += d.dropWeight;
  let roll = Math.random() * total;
  for (const d of defs) {
    roll -= d.dropWeight;
    if (roll <= 0) return d.id;
  }
  return defs[0]!.id;
}

export function rarityColor(rarity: ItemDef['rarity']): string {
  if (rarity === 'rare') return '#e3b341';
  if (rarity === 'uncommon') return '#3fb950';
  return '#8b949e';
}

/** Resolve combat bonuses (supports legacy damage/armor fields). */
export function itemAttackBonus(def: ItemDef): number {
  return def.attackBonus ?? def.damage ?? 0;
}
export function itemStrengthBonus(def: ItemDef): number {
  return def.strengthBonus ?? def.damage ?? 0;
}
export function itemDefenseBonus(def: ItemDef): number {
  return def.defenseBonus ?? def.armor ?? 0;
}
