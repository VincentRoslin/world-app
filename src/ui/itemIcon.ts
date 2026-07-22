import { getItemDef } from '../items/catalog';
import type { ItemInstance } from '../items/types';
import { rarityColor } from '../items/catalog';

/** Simple CSS/HTML "sprite" icon for an item. */
export function itemIconHtml(item: ItemInstance | null, opts?: { showQty?: boolean }): string {
  if (!item) return '';
  const def = getItemDef(item.defId);
  const color = def?.iconColor ?? '#484f58';
  const icon = def?.icon ?? 'generic';
  const rarity = rarityColor(def?.rarity ?? 'common');
  const qty = item.quantity ?? 1;
  const qtyHtml =
    opts?.showQty !== false && qty > 1
      ? `<span class="item-qty">${qty}</span>`
      : '';
  return `<span class="item-icon icon-${icon}" style="--item-color:${color};--rarity:${rarity}">${qtyHtml}</span>`;
}
