export type EquipSlot =
  | 'head'
  | 'neck'
  | 'shoulders'
  | 'cloak'
  | 'chest'
  | 'wrist'
  | 'hands'
  | 'belt'
  | 'legs'
  | 'feet'
  | 'ring'
  | 'mainHand'
  | 'offHand'
  | 'bag';

/** Concrete equip keys on the paper-doll. */
export type EquipKey =
  | 'head'
  | 'neck'
  | 'shoulders'
  | 'cloak'
  | 'chest'
  | 'wrist'
  | 'hands'
  | 'belt'
  | 'legs'
  | 'feet'
  | 'ring1'
  | 'ring2'
  | 'mainHand'
  | 'offHand';

export type WeaponType = 'sword' | 'axe' | 'dagger' | 'shield';

export type ItemRarity = 'common' | 'uncommon' | 'rare';

export interface SkillRequirements {
  attack?: number;
  strength?: number;
  defense?: number;
  fishing?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  iconColor: string;
  /** Equipment category; bag items use slot 'bag'. Junk uses 'none'. */
  slot: EquipSlot | 'none';
  weaponType?: WeaponType;
  /** Combat bonuses from this item when equipped. */
  attackBonus?: number;
  strengthBonus?: number;
  defenseBonus?: number;
  /** Optional flat max HP from gear. */
  maxHp?: number;
  /** Legacy aliases still accepted when reading old data. */
  armor?: number;
  damage?: number;
  /** Skill levels required to equip. */
  requirements?: SkillRequirements;
  /** For bag items: storage size granted when equipped. */
  bagSlots?: number;
  rarity: ItemRarity;
  /** Relative drop weight (higher = more common). */
  dropWeight: number;
  /**
   * Max stack size in bags. Gear/bags = 1 (no stack).
   * Junk / unequippable defaults to 5.
   */
  maxStack?: number;
  /** Visual glyph for basic sprite icons. */
  icon?:
    | 'sword'
    | 'axe'
    | 'dagger'
    | 'shield'
    | 'helm'
    | 'chest'
    | 'boots'
    | 'ring'
    | 'cloak'
    | 'bag'
    | 'bone'
    | 'cloth'
    | 'amulet'
    | 'gloves'
    | 'generic';
}

export interface ItemInstance {
  uid: number;
  defId: string;
  /** Stack count (gear always 1). */
  quantity: number;
}

export interface GearStats {
  attackBonus: number;
  strengthBonus: number;
  defenseBonus: number;
  maxHp: number;
}

export interface Inventory {
  equipped: Record<EquipKey, ItemInstance | null>;
  /** Up to 4 bag items equipped in bag slots. */
  bagEquip: (ItemInstance | null)[];
  /** Always 16 slots. */
  mainBag: (ItemInstance | null)[];
  /**
   * Parallel to bagEquip: contents of each extra bag, or null if no bag equipped.
   * Length always maxExtraBags.
   */
  extraBags: ((ItemInstance | null)[] | null)[];
}

export const EQUIP_KEYS: EquipKey[] = [
  'head',
  'neck',
  'shoulders',
  'cloak',
  'chest',
  'wrist',
  'hands',
  'belt',
  'legs',
  'feet',
  'ring1',
  'ring2',
  'mainHand',
  'offHand',
];

export const EQUIP_LABELS: Record<EquipKey, string> = {
  head: 'Head',
  neck: 'Neck',
  shoulders: 'Shoulders',
  cloak: 'Cloak',
  chest: 'Chest',
  wrist: 'Wrist',
  hands: 'Hands',
  belt: 'Belt',
  legs: 'Pants',
  feet: 'Boots',
  ring1: 'Ring 1',
  ring2: 'Ring 2',
  mainHand: 'Main Hand',
  offHand: 'Off Hand',
};

/** Equipment panel columns (6 + 6 + weapons) */
export const PAPER_DOLL_LEFT: EquipKey[] = ['head', 'neck', 'shoulders', 'cloak', 'chest', 'wrist'];
export const PAPER_DOLL_RIGHT: EquipKey[] = ['hands', 'belt', 'legs', 'feet', 'ring1', 'ring2'];
export const PAPER_DOLL_WEAPONS: EquipKey[] = ['mainHand', 'offHand'];
