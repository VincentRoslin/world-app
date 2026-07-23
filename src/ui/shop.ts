import { CONFIG } from '../config';
import { addCoins } from '../core/currency';
import { dist } from '../core/math';
import { ITEM_CATALOG, getItemDef, rarityColor } from '../items/catalog';
import type { EquipSlot } from '../items/types';
import { addItem, applyHeroStats, itemTooltipHtml } from '../systems/Inventory';
import {
  addSkillXp,
  skillLabel,
  type SkillId,
  xpForLevel,
} from '../systems/Skills';
import type { World } from '../world/World';
import { itemIconHtml } from './itemIcon';

/** Max tile distance (hero center → NPC) to open/keep shop. */
export const SHOP_INTERACT_RANGE = CONFIG.shopInteractRange;

export type ShopLine =
  | { kind: 'item'; defId: string; label?: string }
  | { kind: 'resource'; resource: 'stone' | 'wood' | 'food'; amount: number; label: string }
  | { kind: 'coins'; copper?: number; silver?: number; gold?: number; label: string }
  | {
      kind: 'skill';
      skill: SkillId;
      /** Absolute set level, or relative +levels via mode. */
      mode: 'set' | 'addLevels' | 'addXp';
      amount: number;
      label: string;
    };

export type ShopCategoryId =
  | 'weapons'
  | 'armor'
  | 'bags'
  | 'materials'
  | 'resources'
  | 'skills'
  | 'currency';

export type ArmorSubId =
  | 'all'
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
  | 'ring';

const ARMOR_SLOTS: EquipSlot[] = [
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
  'ring',
];

/** Tab labels: short word for the chip, full name for tooltip / a11y. */
const CATEGORIES: { id: ShopCategoryId; label: string; short: string }[] = [
  { id: 'weapons', label: 'Weapons', short: 'Weap' },
  { id: 'armor', label: 'Armor', short: 'Armor' },
  { id: 'bags', label: 'Bags', short: 'Bags' },
  { id: 'materials', label: 'Materials', short: 'Mats' },
  { id: 'resources', label: 'Resources', short: 'Res' },
  { id: 'skills', label: 'Skills', short: 'Skill' },
  { id: 'currency', label: 'Currency', short: 'Coin' },
];

const ARMOR_SUBS: { id: ArmorSubId; label: string; short: string }[] = [
  { id: 'all', label: 'All armor', short: 'All' },
  { id: 'head', label: 'Helm', short: 'Helm' },
  { id: 'chest', label: 'Chest', short: 'Chest' },
  { id: 'cloak', label: 'Cloak', short: 'Cloak' },
  { id: 'shoulders', label: 'Shoulders', short: 'Shldr' },
  { id: 'legs', label: 'Legs', short: 'Legs' },
  { id: 'feet', label: 'Boots', short: 'Boots' },
  { id: 'hands', label: 'Gloves', short: 'Glove' },
  { id: 'wrist', label: 'Wrists', short: 'Wrist' },
  { id: 'belt', label: 'Belt', short: 'Belt' },
  { id: 'neck', label: 'Neck', short: 'Neck' },
  { id: 'ring', label: 'Ring', short: 'Ring' },
];

const SKILLS: SkillId[] = ['attack', 'strength', 'defense', 'fishing'];

function isArmorSlot(slot: EquipSlot | 'none'): slot is EquipSlot {
  return (ARMOR_SLOTS as string[]).includes(slot);
}

/** Full free catalog, filtered by category / armor sub. */
export function buildDevShopStock(
  category: ShopCategoryId,
  armorSub: ArmorSubId = 'all',
): ShopLine[] {
  const lines: ShopLine[] = [];

  if (category === 'resources') {
    lines.push(
      { kind: 'resource', resource: 'stone', amount: 100, label: 'Stone ×100' },
      { kind: 'resource', resource: 'wood', amount: 100, label: 'Wood ×100' },
      { kind: 'resource', resource: 'food', amount: 100, label: 'Food ×100' },
      { kind: 'resource', resource: 'stone', amount: 500, label: 'Stone ×500' },
      { kind: 'resource', resource: 'wood', amount: 500, label: 'Wood ×500' },
      { kind: 'resource', resource: 'food', amount: 500, label: 'Food ×500' },
    );
    return lines;
  }

  if (category === 'currency') {
    lines.push(
      { kind: 'coins', copper: 100, label: '100 copper (→ 1s)' },
      { kind: 'coins', silver: 10, label: '10 silver' },
      { kind: 'coins', gold: 1, label: '1 gold' },
      { kind: 'coins', copper: 100, silver: 20, gold: 5, label: 'Bundle (5g 21s after convert)' },
    );
    return lines;
  }

  if (category === 'skills') {
    for (const skill of SKILLS) {
      const name = skillLabel(skill);
      lines.push(
        { kind: 'skill', skill, mode: 'addLevels', amount: 1, label: `${name} +1 level` },
        { kind: 'skill', skill, mode: 'addLevels', amount: 5, label: `${name} +5 levels` },
        { kind: 'skill', skill, mode: 'set', amount: 10, label: `${name} → level 10` },
        { kind: 'skill', skill, mode: 'set', amount: 20, label: `${name} → level 20` },
        { kind: 'skill', skill, mode: 'set', amount: 40, label: `${name} → level 40` },
        { kind: 'skill', skill, mode: 'set', amount: 99, label: `${name} → 99 (max)` },
        { kind: 'skill', skill, mode: 'addXp', amount: 500, label: `${name} +500 XP` },
      );
    }
    return lines;
  }

  if (category === 'materials') {
    for (const id of ['bone_chip', 'torn_cloth', 'raw_fish'] as const) {
      if (ITEM_CATALOG[id]) lines.push({ kind: 'item', defId: id });
    }
    return lines;
  }

  for (const def of Object.values(ITEM_CATALOG)) {
    if (category === 'weapons') {
      if (def.slot === 'mainHand' || def.slot === 'offHand') {
        lines.push({ kind: 'item', defId: def.id });
      }
      continue;
    }
    if (category === 'bags') {
      if (def.slot === 'bag') lines.push({ kind: 'item', defId: def.id });
      continue;
    }
    if (category === 'armor') {
      if (!isArmorSlot(def.slot)) continue;
      if (armorSub !== 'all' && def.slot !== armorSub) continue;
      lines.push({ kind: 'item', defId: def.id });
    }
  }

  return lines;
}

export function findShopNpc(world: World): { id: number; name: string; x: number; y: number } | null {
  for (const e of world.entities.values()) {
    if (e.alive && e.kind === 'npc' && e.role === 'shop') {
      return { id: e.id, name: e.name, x: e.x, y: e.y };
    }
  }
  return null;
}

export function heroInShopRange(world: World, npcX: number, npcY: number): boolean {
  const hero = world.hero();
  if (!hero || !hero.alive) return false;
  return dist(hero.x, hero.y, npcX, npcY) <= SHOP_INTERACT_RANGE;
}

export class ShopUi {
  private world: World;
  private panel: HTMLElement;
  private body: HTMLElement;
  private titleEl: HTMLElement;
  private tabsEl: HTMLElement;
  private subtabsEl: HTMLElement;
  private open = false;
  private category: ShopCategoryId = 'weapons';
  private armorSub: ArmorSubId = 'all';
  private stock: ShopLine[] = [];
  /** NPC id while open — used to enforce range. */
  private openNpcId: number | null = null;

  constructor(world: World) {
    this.world = world;
    this.panel = document.getElementById('shop-panel')!;
    this.body = document.getElementById('shop-body')!;
    this.titleEl = document.getElementById('shop-title')!;
    this.tabsEl = document.getElementById('shop-tabs')!;
    this.subtabsEl = document.getElementById('shop-subtabs')!;

    document.getElementById('btn-shop-close')?.addEventListener('click', () => this.close());
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());

    this.tabsEl.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('[data-shop-cat]') as HTMLElement | null;
      if (!btn) return;
      const cat = btn.dataset.shopCat as ShopCategoryId;
      if (!cat) return;
      this.category = cat;
      if (cat !== 'armor') this.armorSub = 'all';
      this.render();
    });

    this.subtabsEl.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('[data-shop-sub]') as HTMLElement | null;
      if (!btn) return;
      const sub = btn.dataset.shopSub as ArmorSubId;
      if (!sub) return;
      this.armorSub = sub;
      this.render();
    });

    // Only the Buy button purchases — the rest of the row is info / tooltip target
    this.body.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('[data-shop-buy]') as HTMLElement | null;
      if (!btn) return;
      ev.stopPropagation();
      const idx = Number(btn.dataset.shopBuy);
      if (Number.isNaN(idx)) return;
      this.buy(idx);
    });

    this.body.addEventListener('mouseover', (ev) => {
      const row = (ev.target as HTMLElement).closest('[data-shop-tip]') as HTMLElement | null;
      if (!row) return;
      this.showItemTip(row, ev as MouseEvent);
    });
    this.body.addEventListener('mousemove', (ev) => {
      const row = (ev.target as HTMLElement).closest('[data-shop-tip]') as HTMLElement | null;
      if (!row) return;
      this.positionTip(ev as MouseEvent);
    });
    this.body.addEventListener('mouseout', (ev) => {
      const related = (ev as MouseEvent).relatedTarget as Node | null;
      // Keep tip while moving within an item row (icon → name → Buy)
      const fromRow = (ev.target as HTMLElement).closest('[data-shop-tip]');
      if (fromRow && related && fromRow.contains(related)) return;
      // Leaving the row (or the body) — hide
      if (!related || !this.body.contains(related)) {
        this.hideTip();
        return;
      }
      const toRow = (related as HTMLElement).closest?.('[data-shop-tip]');
      if (!toRow) this.hideTip();
    });
  }

  private tipEl(): HTMLElement | null {
    return document.getElementById('inv-tooltip');
  }

  private showItemTip(row: HTMLElement, ev: MouseEvent): void {
    const tip = this.tipEl();
    if (!tip) return;
    const defId = row.dataset.shopTip;
    if (!defId) return;
    const hero = this.world.hero();
    const fake = { uid: 0, defId, quantity: 1 };
    tip.innerHTML = itemTooltipHtml(fake, hero?.skills);
    tip.classList.remove('hidden');
    this.positionTip(ev);
  }

  /** Prefer below-right of cursor so the stack reads top→bottom like WoW. */
  private positionTip(ev: MouseEvent): void {
    const tip = this.tipEl();
    if (!tip || tip.classList.contains('hidden')) return;
    const pad = 14;
    const tw = tip.offsetWidth || 200;
    const th = tip.offsetHeight || 80;
    let left = ev.clientX + pad;
    let top = ev.clientY + pad;
    if (left + tw > window.innerWidth - 4) left = Math.max(4, ev.clientX - tw - pad);
    if (top + th > window.innerHeight - 4) top = Math.max(4, ev.clientY - th - pad);
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }

  private hideTip(): void {
    const tip = this.tipEl();
    if (!tip) return;
    tip.classList.add('hidden');
    tip.innerHTML = '';
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * Open free dev shop. By default requires range; `force` is used after
   * approach-and-interact has already verified distance.
   */
  openShop(npcName?: string, npcId?: number, force = false): void {
    let npc = npcId != null ? this.world.get(npcId) : null;
    if (!npc || npc.kind !== 'npc' || npc.role !== 'shop') {
      const found = findShopNpc(this.world);
      if (!found) {
        this.world.message = 'No vendor nearby.';
        return;
      }
      npc = this.world.get(found.id)!;
    }
    if (npc.kind !== 'npc') return;

    if (!force && !heroInShopRange(this.world, npc.x, npc.y)) {
      this.world.message = 'Walk closer to the vendor.';
      return;
    }

    this.open = true;
    this.openNpcId = npc.id;
    this.titleEl.textContent = `${npcName ?? npc.name} — Free (dev)`;
    this.panel.classList.remove('hidden');
    this.world.message = `Talking to ${npc.name}…`;
    this.render();
  }

  close(): void {
    this.open = false;
    this.openNpcId = null;
    this.panel.classList.add('hidden');
    this.hideTip();
  }

  /** Call each frame: close if hero walks out of range. */
  update(): void {
    if (!this.open || this.openNpcId == null) return;
    const npc = this.world.get(this.openNpcId);
    if (!npc || !npc.alive || npc.kind !== 'npc') {
      this.close();
      this.world.message = 'Vendor is gone.';
      return;
    }
    if (!heroInShopRange(this.world, npc.x, npc.y)) {
      this.close();
      this.world.message = 'You walk away from the vendor.';
    }
  }

  private buy(index: number): void {
    // Re-check range on every buy
    if (this.openNpcId != null) {
      const npc = this.world.get(this.openNpcId);
      if (!npc || npc.kind !== 'npc' || !heroInShopRange(this.world, npc.x, npc.y)) {
        this.close();
        this.world.message = 'Too far from the vendor.';
        return;
      }
    }

    const line = this.stock[index];
    if (!line) return;

    if (line.kind === 'resource') {
      this.world.stockpile[line.resource] += line.amount;
      this.world.message = `Bought ${line.amount} ${line.resource}.`;
      this.world.spawnFloatText(
        this.world.hero()?.x ?? 0,
        (this.world.hero()?.y ?? 0) - 0.2,
        `+${line.amount} ${line.resource}`,
        '#3fb950',
      );
      return;
    }

    if (line.kind === 'coins') {
      addCoins(this.world.coins, {
        copper: line.copper ?? 0,
        silver: line.silver ?? 0,
        gold: line.gold ?? 0,
      });
      this.world.message = 'Bought coins.';
      return;
    }

    if (line.kind === 'skill') {
      const hero = this.world.hero();
      if (!hero || !hero.alive) {
        this.world.message = 'No hero to train.';
        return;
      }
      const s = hero.skills[line.skill];
      const before = s.level;
      if (line.mode === 'set') {
        const L = Math.max(1, Math.min(99, Math.floor(line.amount)));
        s.level = L;
        s.xp = xpForLevel(L);
      } else if (line.mode === 'addLevels') {
        const L = Math.max(1, Math.min(99, s.level + Math.floor(line.amount)));
        s.level = L;
        s.xp = Math.max(s.xp, xpForLevel(L));
      } else {
        const events = addSkillXp(hero.skills, line.skill, line.amount);
        for (const ev of events) {
          this.world.spawnFloatText(hero.x, hero.y, `${skillLabel(ev.skill)} ${ev.level}!`, '#e3b341');
        }
      }
      applyHeroStats(hero, this.world.inventory);
      const after = hero.skills[line.skill].level;
      this.world.message =
        before !== after
          ? `${skillLabel(line.skill)} is now level ${after}.`
          : `${skillLabel(line.skill)} updated (XP applied).`;
      this.world.spawnFloatText(hero.x, hero.y - 0.25, line.label, '#79c0ff');
      return;
    }

    const item = this.world.createItem(line.defId, 1);
    if (!addItem(this.world.inventory, item, () => this.world.allocItemUid())) {
      this.world.message = 'Inventory full — free a bag slot.';
      return;
    }
    const def = getItemDef(line.defId);
    this.world.message = `Bought ${def?.name ?? line.defId}.`;
    const hero = this.world.hero();
    if (hero) {
      this.world.spawnFloatText(hero.x, hero.y - 0.2, `+${def?.name ?? 'item'}`, '#e3b341');
    }
  }

  private render(): void {
    this.stock = buildDevShopStock(this.category, this.armorSub);

    this.tabsEl.innerHTML = CATEGORIES.map(
      (c) =>
        `<button type="button" class="shop-tab-slot${c.id === this.category ? ' active' : ''}" data-shop-cat="${c.id}" title="${c.label}" aria-label="${c.label}">
          <span class="shop-tab-label">${c.short}</span>
        </button>`,
    ).join('');

    // Always reserve subtab row height; only fill when Armor is active (no layout jump)
    if (this.category === 'armor') {
      this.subtabsEl.classList.remove('hidden');
      this.subtabsEl.innerHTML = ARMOR_SUBS.map(
        (s) =>
          `<button type="button" class="shop-tab-slot shop-sub-slot${s.id === this.armorSub ? ' active' : ''}" data-shop-sub="${s.id}" title="${s.label}" aria-label="${s.label}">
            <span class="shop-tab-label">${s.short}</span>
          </button>`,
      ).join('');
    } else {
      this.subtabsEl.classList.remove('hidden');
      this.subtabsEl.innerHTML = `<div class="shop-subtabs-spacer" aria-hidden="true"></div>`;
    }

    // Lock window width to the main category row so Armor sub-tabs never widen it
    this.lockWidthToMainTabs();

    const parts: string[] = [];
    this.stock.forEach((line, i) => {
      if (line.kind === 'item') {
        const def = getItemDef(line.defId);
        if (!def) return;
        const color = rarityColor(def.rarity);
        const icon = itemIconHtml({ uid: 0, defId: def.id, quantity: 1 }, { showQty: false });
        const slotBit =
          def.slot === 'mainHand' || def.slot === 'offHand'
            ? (def.weaponType ?? def.slot)
            : def.slot;
        const rarityWord = def.rarity;
        parts.push(`
          <div class="shop-row" data-shop-tip="${def.id}" style="--rarity:${color}">
            <span class="shop-icon inv-slot filled">${icon}</span>
            <span class="shop-meta">
              <span class="shop-name shop-name-rarity" style="color:${color}">${def.name}</span>
              <span class="shop-sub">${slotBit} · <span class="shop-rarity" style="color:${color}">${rarityWord}</span> · FREE</span>
            </span>
            <button type="button" class="shop-price shop-buy-btn" data-shop-buy="${i}">Buy</button>
          </div>
        `);
        return;
      }

      if (line.kind === 'skill') {
        parts.push(`
          <div class="shop-row skill">
            <span class="shop-icon shop-res-icon shop-text-icon">XP</span>
            <span class="shop-meta">
              <span class="shop-name">${line.label}</span>
              <span class="shop-sub">Dev skill grant · FREE</span>
            </span>
            <button type="button" class="shop-price shop-buy-btn" data-shop-buy="${i}">Buy</button>
          </div>
        `);
        return;
      }

      const resIcon =
        line.kind === 'coins' ? 'Coin' : line.kind === 'resource' ? line.resource.slice(0, 3) : 'Res';
      parts.push(`
        <div class="shop-row resource">
          <span class="shop-icon shop-res-icon shop-text-icon">${resIcon}</span>
          <span class="shop-meta">
            <span class="shop-name">${line.label}</span>
            <span class="shop-sub">FREE (dev)</span>
          </span>
          <button type="button" class="shop-price shop-buy-btn" data-shop-buy="${i}">Buy</button>
        </div>
      `);
    });

    if (parts.length === 0) {
      this.body.innerHTML = `<p class="shop-empty">Nothing in this category.</p>`;
    } else {
      this.body.innerHTML = parts.join('');
    }
  }

  /**
   * Shop width = main tabs row only. Sub-tabs scroll inside that width.
   * (CSS max-content can still expand when sub-tabs are populated; pin explicitly.)
   */
  private lockWidthToMainTabs(): void {
    const win = this.panel.querySelector('.shop-window') as HTMLElement | null;
    if (!win) return;
    // Reset so measurement isn't stuck on a previous wider value
    win.style.width = 'max-content';
    // Force layout with only tabs defining width (subtabs constrained by CSS)
    const tabsW = this.tabsEl.scrollWidth;
    const style = getComputedStyle(win);
    const padX =
      (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const borderX =
      (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    win.style.width = `${Math.ceil(tabsW + padX + borderX)}px`;
  }
}

