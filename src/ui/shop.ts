import { ITEM_CATALOG, getItemDef, rarityColor } from '../items/catalog';
import type { World } from '../world/World';
import { addItem } from '../systems/Inventory';
import { itemIconHtml } from './itemIcon';

export type ShopLine =
  | { kind: 'item'; defId: string; label?: string }
  | { kind: 'resource'; resource: 'stone' | 'wood' | 'food'; amount: number; label: string }
  | { kind: 'coins'; copper?: number; silver?: number; gold?: number; label: string };

/** Free test catalog — all gear + bags + resources. */
export function buildDevShopStock(): ShopLine[] {
  const lines: ShopLine[] = [
    { kind: 'resource', resource: 'stone', amount: 100, label: 'Stone ×100' },
    { kind: 'resource', resource: 'wood', amount: 100, label: 'Wood ×100' },
    { kind: 'resource', resource: 'food', amount: 100, label: 'Food ×100' },
    { kind: 'coins', copper: 100, silver: 20, gold: 5, label: 'Coins (5g 20s 100c)' },
  ];
  for (const def of Object.values(ITEM_CATALOG)) {
    // Sell gear, bags, and usable junk/fish for testing
    if (def.slot === 'none' && def.id !== 'raw_fish' && def.id !== 'bone_chip' && def.id !== 'torn_cloth') {
      continue;
    }
    lines.push({ kind: 'item', defId: def.id });
  }
  return lines;
}

export class ShopUi {
  private world: World;
  private panel: HTMLElement;
  private body: HTMLElement;
  private titleEl: HTMLElement;
  private open = false;

  constructor(world: World) {
    this.world = world;
    this.panel = document.getElementById('shop-panel')!;
    this.body = document.getElementById('shop-body')!;
    this.titleEl = document.getElementById('shop-title')!;

    document.getElementById('btn-shop-close')?.addEventListener('click', () => this.close());
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());

    this.body.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('[data-shop-buy]') as HTMLElement | null;
      if (!btn) return;
      const idx = Number(btn.dataset.shopBuy);
      if (Number.isNaN(idx)) return;
      this.buy(idx);
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  openShop(npcName = 'Test Vendor'): void {
    this.open = true;
    this.titleEl.textContent = `${npcName} — Free shop (dev)`;
    this.panel.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.open = false;
    this.panel.classList.add('hidden');
  }

  toggleFromNpc(npcName: string): void {
    if (this.open) this.close();
    else this.openShop(npcName);
  }

  private stock = buildDevShopStock();

  private buy(index: number): void {
    const line = this.stock[index];
    if (!line) return;

    if (line.kind === 'resource') {
      this.world.stockpile[line.resource] += line.amount;
      this.world.message = `Received ${line.amount} ${line.resource}.`;
      this.world.spawnFloatText(
        this.world.hero()?.x ?? 0,
        (this.world.hero()?.y ?? 0) - 0.2,
        `+${line.amount} ${line.resource}`,
        '#3fb950',
      );
      return;
    }

    if (line.kind === 'coins') {
      this.world.coins.copper += line.copper ?? 0;
      this.world.coins.silver += line.silver ?? 0;
      this.world.coins.gold += line.gold ?? 0;
      this.world.message = 'Received free coins.';
      return;
    }

    const item = this.world.createItem(line.defId, 1);
    if (!addItem(this.world.inventory, item, () => this.world.allocItemUid())) {
      this.world.message = 'Inventory full — free a bag slot.';
      return;
    }
    const def = getItemDef(line.defId);
    this.world.message = `Received free ${def?.name ?? line.defId}.`;
    const hero = this.world.hero();
    if (hero) {
      this.world.spawnFloatText(hero.x, hero.y - 0.2, `+${def?.name ?? 'item'}`, '#e3b341');
    }
  }

  private render(): void {
    this.stock = buildDevShopStock();
    const parts: string[] = [];
    this.stock.forEach((line, i) => {
      if (line.kind === 'item') {
        const def = getItemDef(line.defId);
        if (!def) return;
        const color = rarityColor(def.rarity);
        const icon = itemIconHtml(
          { uid: 0, defId: def.id, quantity: 1 },
          { showQty: false },
        );
        parts.push(`
          <button type="button" class="shop-row" data-shop-buy="${i}" style="--rarity:${color}">
            <span class="shop-icon inv-slot filled">${icon}</span>
            <span class="shop-meta">
              <span class="shop-name">${def.name}</span>
              <span class="shop-sub">${def.slot} · ${def.rarity} · FREE</span>
            </span>
            <span class="shop-price">Take</span>
          </button>
        `);
        return;
      }
      parts.push(`
        <button type="button" class="shop-row resource" data-shop-buy="${i}">
          <span class="shop-icon shop-res-icon">${line.kind === 'coins' ? '💰' : '📦'}</span>
          <span class="shop-meta">
            <span class="shop-name">${line.label}</span>
            <span class="shop-sub">FREE (dev)</span>
          </span>
          <span class="shop-price">Take</span>
        </button>
      `);
    });
    this.body.innerHTML = parts.join('');
  }
}
