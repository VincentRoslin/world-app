import { CONFIG } from '../config';
import { getItemDef, rarityColor } from '../items/catalog';
import type { EquipKey, ItemInstance } from '../items/types';
import {
  EQUIP_LABELS,
  PAPER_DOLL_LEFT,
  PAPER_DOLL_RIGHT,
  PAPER_DOLL_WEAPONS,
} from '../items/types';
import {
  applyHeroStats,
  equipFromBag,
  estimateMaxHit,
  getStats,
  itemTooltip,
  unequip,
  unequipBag,
} from '../systems/Inventory';
import { xpProgress } from '../systems/Skills';
import type { World } from '../world/World';
import { itemIconHtml } from './itemIcon';

type CharTab = 'inventory' | 'skills';

export class InventoryUi {
  private world: World;
  private charPanel: HTMLElement;
  private pdLeft: HTMLElement;
  private pdRight: HTMLElement;
  private pdWeapons: HTMLElement;
  private pdCenterStats: HTMLElement;
  private skillsPanelEl: HTMLElement;
  private bagPanelsEl: HTMLElement;
  private bagBar: HTMLElement;
  private tooltipEl: HTMLElement;
  private openBags = new Set<'main' | number>();
  private activeTab: CharTab = 'inventory';
  private equipFingerprint = '';
  private bagBarFingerprint = '';
  private bagPanelsFingerprint = '';
  private centerStatsFingerprint = '';
  private skillsFingerprint = '';
  /** Custom drag position (px). Null = default left-middle placement. */
  private charPos: { left: number; top: number } | null = null;
  private charDragging = false;
  private charDragStart = { x: 0, y: 0, left: 0, top: 0 };
  constructor(world: World) {
    this.world = world;
    this.charPanel = document.getElementById('character-panel')!;
    this.pdLeft = document.getElementById('pd-left')!;
    this.pdRight = document.getElementById('pd-right')!;
    this.pdWeapons = document.getElementById('pd-weapons')!;
    this.pdCenterStats = document.getElementById('pd-center-stats')!;
    this.skillsPanelEl = document.getElementById('inv-skills-panel')!;
    this.bagPanelsEl = document.getElementById('bag-panels')!;
    this.bagBar = document.getElementById('bag-bar')!;
    this.tooltipEl = document.getElementById('inv-tooltip')!;

    document.getElementById('btn-character')?.addEventListener('click', () => this.toggleCharacter());
    document.getElementById('btn-char-close')?.addEventListener('click', () => this.closeCharacter());
    document.getElementById('btn-help')?.addEventListener('click', () => this.openHelp());
    document.getElementById('btn-help-close')?.addEventListener('click', () => this.closeHelp());
    document.getElementById('help-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('help-modal')) this.closeHelp();
    });

    this.charPanel.addEventListener('mousedown', (e) => e.stopPropagation());
    this.bagBar.addEventListener('mousedown', (e) => e.stopPropagation());
    this.bagPanelsEl.addEventListener('mousedown', (e) => e.stopPropagation());

    this.setupCharDrag();

    this.charPanel.querySelectorAll('.char-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTab((btn as HTMLElement).dataset.tab as CharTab);
      });
    });

    this.bagBar.querySelectorAll('[data-bag-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = (btn as HTMLElement).dataset.bagOpen!;
        if (key === 'main') this.toggleBagPanel('main');
        else this.toggleBagPanel(Number(key));
      });
    });

    // Build paper-doll once
    this.buildPaperDoll();

    // Delegation: bag panels (equip, close, unequip bag)
    this.bagPanelsEl.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const closeBtn = t.closest('[data-bag-close]') as HTMLElement | null;
      if (closeBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const key = closeBtn.dataset.bagClose!;
        const bag: 'main' | number = key === 'main' ? 'main' : Number(key);
        this.openBags.delete(bag);
        this.bagPanelsFingerprint = '';
        this.hideTip();
        this.renderBagPanels(true);
        return;
      }
      const unBtn = t.closest('[data-bag-unequip]') as HTMLElement | null;
      if (unBtn) {
        ev.preventDefault();
        const bag = Number(unBtn.dataset.bagUnequip);
        if (unequipBag(this.world.inventory, bag)) {
          this.openBags.delete(bag);
          this.world.message = 'Bag unequipped.';
          this.bagBarFingerprint = '';
          this.bagPanelsFingerprint = '';
          this.updateBagBar();
          this.renderBagPanels(true);
        } else {
          this.world.message = 'Empty the bag before unequipping.';
        }
        return;
      }
      const slot = t.closest('button.bag-slot[data-bag]') as HTMLButtonElement | null;
      if (!slot) return;
      const bagAttr = slot.dataset.bag;
      const index = Number(slot.dataset.index);
      if (bagAttr == null || Number.isNaN(index)) return;
      const bag: 'main' | number = bagAttr === 'main' ? 'main' : Number(bagAttr);
      this.tryEquipFromBag(bag, index);
    });

    // Tooltips for bag slots (delegation — panels rebuild often)
    this.bagPanelsEl.addEventListener('pointerover', (ev) => {
      const slot = (ev.target as HTMLElement).closest('button.bag-slot[data-bag]') as HTMLElement | null;
      if (!slot || !this.bagPanelsEl.contains(slot)) return;
      // Only fire when entering the slot (not moving between icon children)
      const related = (ev as PointerEvent).relatedTarget as Node | null;
      if (related && slot.contains(related)) return;
      this.showTipForBagSlot(slot, ev as PointerEvent);
    });
    this.bagPanelsEl.addEventListener('pointerout', (ev) => {
      const slot = (ev.target as HTMLElement).closest('button.bag-slot[data-bag]') as HTMLElement | null;
      if (!slot || !this.bagPanelsEl.contains(slot)) return;
      const related = (ev as PointerEvent).relatedTarget as Node | null;
      if (related && slot.contains(related)) return;
      this.hideTip();
    });
    this.bagPanelsEl.addEventListener('pointermove', (ev) => {
      const slot = (ev.target as HTMLElement).closest('button.bag-slot[data-bag]') as HTMLElement | null;
      if (!slot || this.tooltipEl.classList.contains('hidden')) return;
      this.positionTip(ev as PointerEvent);
    });
  }

  private buildPaperDoll(): void {
    const makeSlot = (key: EquipKey) => {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'inv-slot equip-slot';
      slot.dataset.equip = key;
      slot.title = EQUIP_LABELS[key];
      /* icon band first, label band second — matches paper-doll CSS grid rows */
      slot.innerHTML = `<span class="slot-icon"></span><span class="slot-label">${EQUIP_LABELS[key]}</span>`;
      slot.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.tryUnequip(key);
      });
      slot.addEventListener('mouseenter', (ev) => this.showTipForEquip(key, ev));
      slot.addEventListener('mouseleave', () => this.hideTip());
      return slot;
    };
    this.pdLeft.innerHTML = '';
    this.pdRight.innerHTML = '';
    this.pdWeapons.innerHTML = '';
    for (const k of PAPER_DOLL_LEFT) this.pdLeft.appendChild(makeSlot(k));
    for (const k of PAPER_DOLL_RIGHT) this.pdRight.appendChild(makeSlot(k));
    for (const k of PAPER_DOLL_WEAPONS) this.pdWeapons.appendChild(makeSlot(k));
  }

  toggle(): void {
    this.toggleCharacter();
  }

  toggleCharacter(): void {
    if (this.charPanel.classList.contains('hidden')) this.openCharacter();
    else this.closeCharacter();
  }

  openCharacter(): void {
    this.world.inventoryOpen = true;
    this.charPanel.classList.remove('hidden');
    this.applyCharPosition();
    this.equipFingerprint = '';
    this.refreshCharacter(true);
  }

  closeCharacter(): void {
    this.world.inventoryOpen = false;
    this.charPanel.classList.add('hidden');
    this.charDragging = false;
    this.charPanel.classList.remove('dragging');
    this.hideTip();
  }

  /**
   * Open every equipped bag (main + filled bag slots).
   * If they are already all open, close them all (toggle).
   */
  toggleAllBags(): void {
    const inv = this.world.inventory;
    const equipped: Array<'main' | number> = ['main'];
    for (let i = 0; i < inv.bagEquip.length; i++) {
      if (inv.bagEquip[i]) equipped.push(i);
    }
    const allOpen = equipped.every((b) => this.openBags.has(b));
    if (allOpen) {
      this.openBags.clear();
    } else {
      for (const b of equipped) this.openBags.add(b);
    }
    this.bagPanelsFingerprint = '';
    this.renderBagPanels(true);
  }

  /** Drag the character pane by its header (tabs/close buttons still clickable). */
  private setupCharDrag(): void {
    const header = this.charPanel.querySelector('.char-header') as HTMLElement | null;
    if (!header) return;

    header.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = this.charPanel.getBoundingClientRect();
      this.charDragging = true;
      this.charDragStart = {
        x: e.clientX,
        y: e.clientY,
        left: rect.left,
        top: rect.top,
      };
      this.charPanel.style.left = `${rect.left}px`;
      this.charPanel.style.top = `${rect.top}px`;
      this.charPanel.style.right = 'auto';
      this.charPanel.style.bottom = 'auto';
      this.charPanel.style.transform = 'none';
      this.charPanel.classList.add('dragging');
      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
      if (!this.charDragging) return;
      e.preventDefault();
      const dx = e.clientX - this.charDragStart.x;
      const dy = e.clientY - this.charDragStart.y;
      const w = this.charPanel.offsetWidth;
      const h = this.charPanel.offsetHeight;
      const left = Math.max(0, Math.min(window.innerWidth - w, this.charDragStart.left + dx));
      const top = Math.max(0, Math.min(window.innerHeight - h, this.charDragStart.top + dy));
      this.charPanel.style.left = `${left}px`;
      this.charPanel.style.top = `${top}px`;
      this.charPos = { left, top };
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.charDragging) return;
      this.charDragging = false;
      this.charPanel.classList.remove('dragging');
      try {
        header.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
  }

  /** Restore default left-middle layout, or last dragged position. */
  private applyCharPosition(): void {
    if (this.charPos) {
      const w = this.charPanel.offsetWidth || Math.round(window.innerWidth * 0.3);
      const h = this.charPanel.offsetHeight || Math.round(window.innerHeight * 0.5);
      const left = Math.max(0, Math.min(window.innerWidth - w, this.charPos.left));
      const top = Math.max(0, Math.min(window.innerHeight - h, this.charPos.top));
      this.charPos = { left, top };
      this.charPanel.style.left = `${left}px`;
      this.charPanel.style.top = `${top}px`;
      this.charPanel.style.right = 'auto';
      this.charPanel.style.bottom = 'auto';
      this.charPanel.style.transform = 'none';
    } else {
      this.charPanel.style.left = '';
      this.charPanel.style.top = '';
      this.charPanel.style.right = '';
      this.charPanel.style.bottom = '';
      this.charPanel.style.transform = '';
    }
  }

  close(): void {
    this.closeCharacter();
    this.openBags.clear();
    this.bagPanelsFingerprint = '';
    this.renderBagPanels(true);
  }

  openHelp(): void {
    document.getElementById('help-modal')?.classList.remove('hidden');
  }

  closeHelp(): void {
    document.getElementById('help-modal')?.classList.add('hidden');
  }

  private setTab(tab: CharTab): void {
    this.activeTab = tab;
    this.charPanel.querySelectorAll('.char-tab').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
    });
    document.getElementById('char-tab-inventory')?.classList.toggle('hidden', tab !== 'inventory');
    document.getElementById('char-tab-skills')?.classList.toggle('hidden', tab !== 'skills');
    this.refreshCharacter(true);
  }

  private toggleBagPanel(bag: 'main' | number): void {
    if (bag !== 'main' && !this.world.inventory.extraBags[bag]) return;
    if (this.openBags.has(bag)) this.openBags.delete(bag);
    else this.openBags.add(bag);
    this.bagPanelsFingerprint = '';
    this.renderBagPanels(true);
  }

  update(): void {
    this.updateBagBar();
    if (!this.charPanel.classList.contains('hidden')) {
      this.refreshCharacter(false);
    }
    // Only rebuild bag panels when content/open set changes — fixes X close
    this.renderBagPanels(false);
  }

  private updateBagBar(): void {
    const inv = this.world.inventory;
    const fp = inv.bagEquip.map((b) => (b ? b.uid : '-')).join('|');
    if (fp === this.bagBarFingerprint) return;
    this.bagBarFingerprint = fp;

    for (let i = 0; i < 4; i++) {
      const btn = this.bagBar.querySelector(`[data-bag-open="${i}"]`) as HTMLButtonElement | null;
      if (!btn) continue;
      const has = !!inv.bagEquip[i];
      btn.disabled = !has;
      btn.classList.toggle('disabled', !has);
      if (has) {
        const def = getItemDef(inv.bagEquip[i]!.defId);
        btn.style.background = def?.iconColor ?? '#238636';
        btn.title = def?.name ?? `Bag ${i + 1}`;
      } else {
        btn.style.background = '';
        btn.title = 'Empty bag slot';
      }
    }
  }

  private refreshCharacter(force: boolean): void {
    const inv = this.world.inventory;
    const keys = [...PAPER_DOLL_LEFT, ...PAPER_DOLL_RIGHT, ...PAPER_DOLL_WEAPONS];
    const equipParts = keys
      .map((k) => {
        const it = inv.equipped[k];
        return it ? `${it.uid}:${it.quantity ?? 1}` : '.';
      })
      .join('|');
    if (force || equipParts !== this.equipFingerprint) {
      this.renderEquip();
      this.equipFingerprint = equipParts;
    }
    if (this.activeTab === 'inventory') this.renderCenterStats(force);
    if (this.activeTab === 'skills') this.renderSkills(force);
  }

  /** Combat snapshot shown in the middle of the paper-doll. */
  private renderCenterStats(force = false): void {
    const hero = this.world.hero();
    const inv = this.world.inventory;
    const gear = getStats(inv);
    const maxHit = hero ? estimateMaxHit(hero.skills, inv) : 1;
    const totalMax = hero?.maxHp ?? CONFIG.heroHp + 1;
    const hpNow = hero ? Math.ceil(hero.hp) : 0;
    const skills = hero?.skills;
    const lv = (id: 'attack' | 'strength' | 'defense') => skills?.[id]?.level ?? 1;
    const fp = `${hpNow}|${totalMax}|${maxHit}|${lv('attack')}|${lv('strength')}|${lv('defense')}|${gear.attackBonus}|${gear.strengthBonus}|${gear.defenseBonus}`;
    if (!force && fp === this.centerStatsFingerprint) return;
    this.centerStatsFingerprint = fp;
    this.pdCenterStats.innerHTML = `
      <div class="stats-title">Character</div>
      <div class="stats-grid">
        <div class="stat-row"><span>HP</span><span>${hpNow} / ${totalMax}</span></div>
        <div class="stat-row"><span>Max hit</span><span>${maxHit}</span></div>
        <div class="stat-row"><span>Attack</span><span>Lv ${lv('attack')}</span></div>
        <div class="stat-row"><span>Strength</span><span>Lv ${lv('strength')}</span></div>
        <div class="stat-row"><span>Defense</span><span>Lv ${lv('defense')}</span></div>
        <div class="stat-row"><span>Gear Atk</span><span>+${gear.attackBonus}</span></div>
        <div class="stat-row"><span>Gear Str</span><span>+${gear.strengthBonus}</span></div>
        <div class="stat-row"><span>Gear Def</span><span>+${gear.defenseBonus}</span></div>
      </div>
      <div class="stats-note">Equipped gear only. Bags bottom-right.</div>
    `;
  }

  private bagFingerprint(): string {
    const inv = this.world.inventory;
    const open = [...this.openBags].map(String).sort().join(',');
    const coins = this.world.coins;
    const parts: string[] = [open, `coins:${coins.gold}:${coins.silver}:${coins.copper}`];
    for (let i = 0; i < inv.mainBag.length; i++) {
      const it = inv.mainBag[i];
      parts.push(it ? `${it.uid}x${it.quantity ?? 1}` : '.');
    }
    for (let b = 0; b < inv.extraBags.length; b++) {
      const bag = inv.extraBags[b];
      if (!bag) {
        parts.push('N');
        continue;
      }
      for (const it of bag) parts.push(it ? `${it.uid}x${it.quantity ?? 1}` : '.');
    }
    return parts.join('|');
  }

  private renderBagPanels(force: boolean): void {
    const fp = this.bagFingerprint();
    if (!force && fp === this.bagPanelsFingerprint) return;
    this.bagPanelsFingerprint = fp;

    const inv = this.world.inventory;
    this.bagPanelsEl.innerHTML = '';
    // DOM order + CSS row-reverse → visual L→R: …4, 3, 2, 1, Main
    // (main rightmost next to bag bar; first extra immediately left of main)
    const order: Array<'main' | number> = ['main', 0, 1, 2, 3];
    for (const bag of order) {
      if (!this.openBags.has(bag)) continue;
      if (bag !== 'main' && !inv.extraBags[bag]) {
        this.openBags.delete(bag);
        continue;
      }
      const slots = bag === 'main' ? inv.mainBag : inv.extraBags[bag]!;
      const title =
        bag === 'main'
          ? 'Main Bag'
          : getItemDef(inv.bagEquip[bag]?.defId ?? '')?.name ?? `Bag ${Number(bag) + 1}`;
      this.bagPanelsEl.appendChild(this.makeBagPanel(title, bag, slots));
    }
  }

  private makeBagPanel(
    title: string,
    bag: 'main' | number,
    slots: (ItemInstance | null)[],
  ): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'wow-bag-panel';

    const header = document.createElement('div');
    header.className = 'wow-bag-header';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.dataset.bagClose = bag === 'main' ? 'main' : String(bag);
    header.appendChild(titleSpan);
    header.appendChild(close);
    panel.appendChild(header);

    if (bag === 'main') {
      const coins = document.createElement('div');
      coins.className = 'coin-purse';
      coins.innerHTML = `<span class="coin gold">Gold <b>${this.world.coins.gold}</b></span><span class="coin silver">Silver <b>${this.world.coins.silver}</b></span><span class="coin copper">Copper <b>${this.world.coins.copper}</b></span>`;
      panel.appendChild(coins);
    }

    if (bag !== 'main') {
      const un = document.createElement('button');
      un.type = 'button';
      un.className = 'wow-bag-unequip';
      un.textContent = 'Unequip bag';
      un.dataset.bagUnequip = String(bag);
      panel.appendChild(un);
    }

    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    slots.forEach((item, index) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'inv-slot bag-slot';
      cell.dataset.bag = bag === 'main' ? 'main' : String(bag);
      cell.dataset.index = String(index);
      if (item) {
        const def = getItemDef(item.defId);
        cell.classList.add('filled');
        cell.style.outlineColor = rarityColor(def?.rarity ?? 'common');
        cell.innerHTML = itemIconHtml(item, { showQty: true });
        // Custom #inv-tooltip via pointer events — avoid native title (slow / flaky)
      }
      grid.appendChild(cell);
    });
    panel.appendChild(grid);
    return panel;
  }

  private tryEquipFromBag(bag: 'main' | number, index: number): void {
    const inv = this.world.inventory;
    const hero = this.world.hero();
    const item = bag === 'main' ? inv.mainBag[index] : inv.extraBags[bag]?.[index];
    if (!item) return;
    // Cannot equip stacked junk; equip takes 1 of stack only for stackable? Gear qty is 1.
    const def = getItemDef(item.defId);
    if (!def) {
      this.world.message = 'Unknown item.';
      return;
    }
    if (def.id === 'raw_fish') {
      if (hero && hero.alive) {
        if (hero.hp >= hero.maxHp) {
          this.world.message = 'You are already at full HP.';
          return;
        }
        hero.hp = Math.min(hero.maxHp, hero.hp + 3);
        item.quantity--;
        if (item.quantity <= 0) {
          if (bag === 'main') {
            inv.mainBag[index] = null;
          } else {
            const contents = inv.extraBags[bag];
            if (contents) contents[index] = null;
          }
        }
        this.world.spawnFloatText(hero.x, hero.y, '+3 HP', '#3fb950');
        this.world.message = 'You eat the Raw Fish and heal 3 HP.';
        this.bagPanelsFingerprint = '';
        this.renderBagPanels(true);
        this.refreshCharacter(true);
      }
      return;
    }
    if (def.slot === 'none') {
      this.world.message = `${def.name} cannot be equipped.`;
      return;
    }
    // If somehow stackable equippable, only equip 1
    if ((item.quantity ?? 1) > 1 && def.slot !== 'bag') {
      // split: reduce stack, equip copy
      // For safety gear maxStack is 1
    }
    const skills = hero?.skills ?? {
      attack: { level: 1, xp: 0 },
      strength: { level: 1, xp: 0 },
      defense: { level: 1, xp: 0 },
      fishing: { level: 1, xp: 0 },
    };
    const result = equipFromBag(inv, bag, index, skills);
    if (!result.ok) {
      this.world.message = result.message ?? `Could not equip ${def.name}.`;
      return;
    }
    if (hero) applyHeroStats(hero, inv);
    this.world.message = `Equipped ${def.name}.`;
    this.equipFingerprint = '';
    this.bagBarFingerprint = '';
    this.bagPanelsFingerprint = '';
    this.updateBagBar();
    this.renderBagPanels(true);
    this.refreshCharacter(true);
  }

  private tryUnequip(key: EquipKey): void {
    const inv = this.world.inventory;
    const item = inv.equipped[key];
    if (!item) return;
    const def = getItemDef(item.defId);
    if (!unequip(inv, key)) {
      this.world.message = 'Inventory full — free a bag slot first.';
      return;
    }
    const hero = this.world.hero();
    if (hero) applyHeroStats(hero, inv);
    this.world.message = def ? `Unequipped ${def.name}.` : 'Unequipped.';
    this.equipFingerprint = '';
    this.bagPanelsFingerprint = '';
    this.renderBagPanels(true);
    this.refreshCharacter(true);
  }

  private renderEquip(): void {
    const inv = this.world.inventory;
    const all = this.charPanel.querySelectorAll<HTMLElement>('[data-equip]');
    all.forEach((btn) => {
      const key = btn.dataset.equip as EquipKey;
      const icon = btn.querySelector('.slot-icon') as HTMLElement;
      const item = inv.equipped[key];
      if (item) {
        icon.innerHTML = itemIconHtml(item, { showQty: false });
        btn.classList.add('filled');
        const def = getItemDef(item.defId);
        btn.style.outlineColor = rarityColor(def?.rarity ?? 'common');
      } else {
        icon.innerHTML = '';
        btn.classList.remove('filled');
        btn.style.outlineColor = '';
      }
    });
  }

  private renderSkills(force = false): void {
    const hero = this.world.hero();
    const skills = hero?.skills;
    if (!skills) {
      this.skillsPanelEl.innerHTML = '<p>No hero.</p>';
      return;
    }
    const a = xpProgress(skills.attack);
    const s = xpProgress(skills.strength);
    const d = xpProgress(skills.defense);
    const f = xpProgress(skills.fishing);
    const fp = `${skills.attack.level}:${a.into}|${skills.strength.level}:${s.into}|${skills.defense.level}:${d.into}|${skills.fishing.level}:${f.into}`;
    if (!force && fp === this.skillsFingerprint) return;
    this.skillsFingerprint = fp;
    const row = (id: 'attack' | 'strength' | 'defense' | 'fishing', label: string) => {
      const sk = skills[id];
      const p = xpProgress(sk);
      const pct = Math.floor(p.pct * 100);
      return `
        <div class="stat-row"><span>${label}</span><span>Level ${sk.level}</span></div>
        <div class="xp-bar"><div class="xp-fill" style="width:${pct}%"></div></div>
        <div class="stat-row subtle"><span>XP</span><span>${p.into} / ${p.need}</span></div>
      `;
    };
    this.skillsPanelEl.innerHTML = `
      <div class="stats-title">Combat skills</div>
      <div class="stats-grid">
        ${row('attack', 'Attack')}
        ${row('strength', 'Strength')}
        ${row('defense', 'Defense')}
      </div>
      <div class="stats-title" style="margin-top:12px;">Non-Combat skills</div>
      <div class="stats-grid">
        ${row('fishing', 'Fishing')}
      </div>
    `;
  }

  private showTipForEquip(key: EquipKey, ev: MouseEvent): void {
    const item = this.world.inventory.equipped[key];
    if (!item) this.tooltipEl.textContent = EQUIP_LABELS[key];
    else {
      const hero = this.world.hero();
      this.tooltipEl.textContent = itemTooltip(item, hero?.skills) + ' · click to unequip';
    }
    this.tooltipEl.classList.remove('hidden');
    this.positionTip(ev);
  }

  private showTipForBagSlot(slot: HTMLElement, ev: MouseEvent): void {
    const bagAttr = slot.dataset.bag;
    const index = Number(slot.dataset.index);
    if (bagAttr == null || Number.isNaN(index)) {
      this.hideTip();
      return;
    }
    const inv = this.world.inventory;
    const item =
      bagAttr === 'main' ? inv.mainBag[index] : inv.extraBags[Number(bagAttr)]?.[index];
    if (!item) {
      this.tooltipEl.textContent = 'Empty slot';
      this.tooltipEl.classList.remove('hidden');
      this.positionTip(ev);
      return;
    }
    const def = getItemDef(item.defId);
    const hero = this.world.hero();
    const extra =
      def?.id === 'raw_fish' ? ' · click to eat' :
      def?.slot === 'none' ? ' · not equippable' : def?.slot === 'bag' ? ' · click to equip bag' : ' · click to equip';
    this.tooltipEl.textContent = itemTooltip(item, hero?.skills) + extra;
    this.tooltipEl.classList.remove('hidden');
    this.positionTip(ev);
  }

  private positionTip(ev: MouseEvent): void {
    const pad = 12;
    const tw = this.tooltipEl.offsetWidth || 180;
    const th = this.tooltipEl.offsetHeight || 40;
    let left = ev.clientX + pad;
    let top = ev.clientY + pad;
    if (left + tw > window.innerWidth - 8) left = ev.clientX - tw - pad;
    if (top + th > window.innerHeight - 8) top = ev.clientY - th - pad;
    this.tooltipEl.style.left = `${Math.max(4, left)}px`;
    this.tooltipEl.style.top = `${Math.max(4, top)}px`;
  }

  private hideTip(): void {
    this.tooltipEl.classList.add('hidden');
  }
}
