import { getItemDef, rarityColor } from '../items/catalog';
import type { ItemDef, ItemInstance } from '../items/types';

/** Compact inline SVG glyph for an item type. */
function glyphSvg(icon: NonNullable<ItemDef['icon']>, color: string): string {
  const c = color;
  const stroke = '#0d1117';
  // viewBox 0 0 32 32 — crisp at bag/slot sizes
  const common = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="item-glyph" aria-hidden="true"`;

  switch (icon) {
    case 'sword':
      return `<svg ${common}>
        <path d="M16 3 L18 5 L14 22 L12 22 Z" fill="#e6edf3" stroke="${stroke}" stroke-width="0.8"/>
        <path d="M11 21.5 H21 V24 H11 Z" fill="#bf8700" stroke="${stroke}" stroke-width="0.6"/>
        <path d="M14.5 24 H17.5 V29 H14.5 Z" fill="#6e4b2a"/>
        <circle cx="16" cy="21.5" r="1.4" fill="${c}"/>
      </svg>`;
    case 'axe':
      return `<svg ${common}>
        <path d="M15 6 H17.5 V26 H14.5 Z" fill="#6e4b2a" stroke="${stroke}" stroke-width="0.6"/>
        <path d="M17 7 C24 6 27 12 26 16 C22 15 18 13 17 10 Z" fill="${c}" stroke="${stroke}" stroke-width="0.8"/>
        <path d="M17 8.5 C22 8 24.5 12 24 14.5 C21 14 18.5 12.5 17 10.5 Z" fill="#e6edf3" opacity="0.35"/>
      </svg>`;
    case 'dagger':
      return `<svg ${common}>
        <path d="M18 4 L20 6 L13 22 L10.5 20.5 Z" fill="#e6edf3" stroke="${stroke}" stroke-width="0.7"/>
        <path d="M9 19 H17 L16 22 H10 Z" fill="#6e4b2a"/>
        <path d="M12 22 H14.5 V28 H12 Z" fill="#484f58"/>
        <circle cx="13" cy="19.5" r="1.2" fill="${c}"/>
      </svg>`;
    case 'shield':
      return `<svg ${common}>
        <path d="M16 4 L26 8 V16 C26 23 20 28 16 29 C12 28 6 23 6 16 V8 Z"
          fill="${c}" stroke="${stroke}" stroke-width="1.1"/>
        <path d="M16 7 L22 10 V16 C22 20.5 18.5 24 16 25 C13.5 24 10 20.5 10 16 V10 Z"
          fill="#00000022"/>
        <path d="M16 10 V22" stroke="#e6edf388" stroke-width="1.2"/>
        <path d="M11 15 H21" stroke="#e6edf366" stroke-width="1"/>
      </svg>`;
    case 'helm':
      return `<svg ${common}>
        <path d="M7 16 C7 9 11 6 16 6 C21 6 25 9 25 16 V22 H7 Z"
          fill="${c}" stroke="${stroke}" stroke-width="1"/>
        <path d="M9 16 H23" stroke="#00000044" stroke-width="2"/>
        <rect x="11" y="13" width="4" height="3.5" rx="0.6" fill="#0d1117"/>
        <rect x="17" y="13" width="4" height="3.5" rx="0.6" fill="#0d1117"/>
        <path d="M10 22 H22 V25 C22 26 19 27 16 27 C13 27 10 26 10 25 Z" fill="${c}" stroke="${stroke}" stroke-width="0.7"/>
      </svg>`;
    case 'chest':
      return `<svg ${common}>
        <path d="M10 8 L16 6 L22 8 L26 12 V26 H6 V12 Z" fill="${c}" stroke="${stroke}" stroke-width="1"/>
        <path d="M12 12 H20 V24 H12 Z" fill="#00000028"/>
        <path d="M6 12 L10 8 L12 14 Z" fill="${c}" stroke="${stroke}" stroke-width="0.7"/>
        <path d="M26 12 L22 8 L20 14 Z" fill="${c}" stroke="${stroke}" stroke-width="0.7"/>
        <circle cx="16" cy="16" r="2" fill="#e6edf355"/>
      </svg>`;
    case 'cloak':
      return `<svg ${common}>
        <path d="M10 6 C10 6 16 4 22 6 L24 10 C24 10 26 26 16 28 C6 26 8 10 8 10 Z"
          fill="${c}" stroke="${stroke}" stroke-width="1"/>
        <path d="M12 8 C14 12 14 20 13 26" fill="none" stroke="#00000033" stroke-width="1.2"/>
        <path d="M20 8 C18 12 18 20 19 26" fill="none" stroke="#ffffff22" stroke-width="1.2"/>
        <path d="M11 6 H21" stroke="#e6edf355" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    case 'boots':
      return `<svg ${common}>
        <path d="M8 10 H14 V20 H7 C6 20 5 21 5 22.5 V26 H14.5 V20" fill="${c}" stroke="${stroke}" stroke-width="0.9"/>
        <path d="M18 10 H24 V20 H25.5 C27 20 28 21 28 22.5 V26 H18 V20" fill="${c}" stroke="${stroke}" stroke-width="0.9"/>
        <path d="M5 24 H14.5" stroke="#00000044" stroke-width="1.5"/>
        <path d="M18 24 H28" stroke="#00000044" stroke-width="1.5"/>
      </svg>`;
    case 'ring':
      return `<svg ${common}>
        <circle cx="16" cy="17" r="8" fill="none" stroke="${c}" stroke-width="3.2"/>
        <circle cx="16" cy="17" r="8" fill="none" stroke="${stroke}" stroke-width="0.7"/>
        <rect x="13.5" y="6" width="5" height="5" rx="1" fill="${c}" stroke="${stroke}" stroke-width="0.6"/>
        <circle cx="16" cy="8.5" r="1.2" fill="#e6edf3"/>
      </svg>`;
    case 'bag':
      return `<svg ${common}>
        <path d="M8 12 H24 V26 C24 27.5 22 28.5 16 28.5 C10 28.5 8 27.5 8 26 Z"
          fill="${c}" stroke="${stroke}" stroke-width="1"/>
        <path d="M12 12 C12 8 14 6 16 6 C18 6 20 8 20 12" fill="none" stroke="#e6edf3" stroke-width="1.6"/>
        <rect x="14" y="15" width="4" height="5" rx="0.8" fill="#00000033"/>
      </svg>`;
    case 'bone':
      return `<svg ${common}>
        <rect x="11" y="14" width="10" height="4.5" rx="2" fill="#e6edf3" stroke="${stroke}" stroke-width="0.6"/>
        <circle cx="10" cy="13" r="3" fill="#e6edf3" stroke="${stroke}" stroke-width="0.5"/>
        <circle cx="10" cy="19.5" r="3" fill="#e6edf3" stroke="${stroke}" stroke-width="0.5"/>
        <circle cx="22" cy="13" r="3" fill="#e6edf3" stroke="${stroke}" stroke-width="0.5"/>
        <circle cx="22" cy="19.5" r="3" fill="#e6edf3" stroke="${stroke}" stroke-width="0.5"/>
      </svg>`;
    case 'cloth':
      return `<svg ${common}>
        <path d="M7 9 L25 9 L23 25 L9 25 Z" fill="${c}" stroke="${stroke}" stroke-width="0.9"/>
        <path d="M10 12 H22" stroke="#ffffff44" stroke-width="1.2"/>
        <path d="M11 16 H21" stroke="#ffffff33" stroke-width="1"/>
        <path d="M12 20 H20" stroke="#ffffff22" stroke-width="1"/>
      </svg>`;
    case 'amulet':
      return `<svg ${common}>
        <path d="M16 4 C12 8 10 12 10 15" fill="none" stroke="#c9d1d9" stroke-width="1.6"/>
        <path d="M16 4 C20 8 22 12 22 15" fill="none" stroke="#c9d1d9" stroke-width="1.6"/>
        <circle cx="16" cy="21" r="7" fill="${c}" stroke="${stroke}" stroke-width="1"/>
        <circle cx="16" cy="21" r="3.5" fill="#e3b341" opacity="0.85"/>
        <circle cx="16" cy="21" r="1.6" fill="#e6edf3"/>
      </svg>`;
    case 'gloves':
      return `<svg ${common}>
        <path d="M6 12 H13 V24 C13 26 11 27 9.5 27 C8 27 6 26 6 24 Z" fill="${c}" stroke="${stroke}" stroke-width="0.8"/>
        <path d="M19 12 H26 V24 C26 26 24 27 22.5 27 C21 27 19 26 19 24 Z" fill="${c}" stroke="${stroke}" stroke-width="0.8"/>
        <path d="M8 10 H11 V14 H8 Z" fill="${c}" stroke="${stroke}" stroke-width="0.5"/>
        <path d="M21 10 H24 V14 H21 Z" fill="${c}" stroke="${stroke}" stroke-width="0.5"/>
      </svg>`;
    default:
      return `<svg ${common}>
        <rect x="7" y="7" width="18" height="18" rx="4" fill="${c}" stroke="${stroke}" stroke-width="1"/>
        <path d="M12 16 H20 M16 12 V20" stroke="#e6edf388" stroke-width="1.5"/>
      </svg>`;
  }
}

/** Simple HTML "sprite" icon for an item (SVG glyph + rarity frame). */
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
  // Rarity border is on the parent slot; icon only carries tint for the glyph fill.
  return `<span class="item-icon icon-${icon}" style="--item-color:${color};--rarity:${rarity}">${glyphSvg(icon, color)}${qtyHtml}</span>`;
}
