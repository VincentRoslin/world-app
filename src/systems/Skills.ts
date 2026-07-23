/**
 * Skills system — levels, XP curves, and combat XP rates.
 *
 * Design goals (as built so far):
 * - Four skills: Attack (hit chance), Strength (max hit), Defense (mitigation/HP), Fishing.
 * - Levels 1–99 using a cumulative XP table.
 * - The table is intentionally *half* a classic exponential curve so early levels feel
 *   rewarding without trivializing combat forever.
 * - Melee grants XP_PER_HIT once per successful strike (damage > 0 only; no miss XP).
 *
 * Related: Inventory.ts (max hit & accuracy rolls), Combat.ts (when XP is granted).
 */

export type SkillId = 'attack' | 'strength' | 'defense' | 'fishing';

export interface SkillState {
  /** Current level (1–99). Derived from XP after grant/normalize. */
  level: number;
  /** Lifetime XP invested in this skill. */
  xp: number;
}

export type Skills = Record<SkillId, SkillState>;

/**
 * Precomputed cumulative XP to *reach* each level (index = level).
 * Built once at module load so level lookups stay O(1) / O(levels) without redoing the sum.
 *
 * Formula (full rate): for each level i from 1..L-1
 *   points += floor(i + 300 * 2^(i/7))
 *   fullXp  = floor(points / 4)
 * We then store floor(fullXp / 2) so progression is ~2× faster than the full curve.
 */
const CUM_XP: number[] = (() => {
  const arr = new Array<number>(100).fill(0);
  // Level 1 requires 0 XP (arr[1] stays 0).
  let points = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    const fullXp = Math.floor(points / 4);
    // Half cumulative XP (round down); keep strictly non-decreasing so levelFromXp is stable.
    arr[lvl + 1] = Math.max(arr[lvl]!, Math.floor(fullXp / 2));
  }
  return arr;
})();

/**
 * Full-rate cumulative XP for a level (before our half-curve speedup).
 * Not used in gameplay — handy if you want to compare curves in the console/debugger.
 */
export function fullCurveXpForLevel(level: number): number {
  const L = Math.max(1, Math.min(99, Math.floor(level)));
  let points = 0;
  for (let lvl = 1; lvl < L; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
  }
  return Math.floor(points / 4);
}

/** Brand-new hero / worker skill block. */
export function createDefaultSkills(): Skills {
  return {
    attack: { level: 1, xp: 0 },
    strength: { level: 1, xp: 0 },
    defense: { level: 1, xp: 0 },
    fishing: { level: 1, xp: 0 },
  };
}

/** Total XP needed to reach `level` on *our* half-rate table. */
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.min(99, Math.floor(level)));
  return CUM_XP[L] ?? 0;
}

/** Highest level whose XP threshold is ≤ total XP. */
export function levelFromXp(xp: number): number {
  const x = Math.max(0, Math.floor(xp));
  let lvl = 1;
  for (let i = 99; i >= 1; i--) {
    if (x >= (CUM_XP[i] ?? 0)) {
      lvl = i;
      break;
    }
  }
  return lvl;
}

/**
 * Progress toward the next level — used by the Skills UI bar.
 * `into` = XP past current level threshold; `need` = span to next; `pct` = 0–1 fill.
 */
export function xpProgress(skill: SkillState): { into: number; need: number; pct: number } {
  if (skill.level >= 99) return { into: 0, need: 1, pct: 1 };
  const cur = xpForLevel(skill.level);
  const next = xpForLevel(skill.level + 1);
  const into = Math.max(0, skill.xp - cur);
  const need = Math.max(1, next - cur);
  return { into, need, pct: Math.min(1, into / need) };
}

export interface LevelUpEvent {
  skill: SkillId;
  level: number;
}

/**
 * Grant XP and return every level crossed (can be multi-level if amount is huge).
 * Callers (Combat, Fishing) use the events for float text / messages / re-apply stats.
 */
export function addSkillXp(skills: Skills, skill: SkillId, amount: number): LevelUpEvent[] {
  if (amount <= 0) return [];
  const s = skills[skill];
  if (s.level >= 99) return [];
  s.xp += Math.floor(amount);
  const events: LevelUpEvent[] = [];
  let newLvl = levelFromXp(s.xp);
  if (newLvl > 99) newLvl = 99;
  while (s.level < newLvl) {
    s.level += 1;
    events.push({ skill, level: s.level });
  }
  // Cap stored XP at the level-99 threshold (half of full-curve ~13M → ~6.5M).
  if (s.level >= 99) {
    s.level = 99;
    s.xp = xpForLevel(99);
  }
  return events;
}

/**
 * After load or formula change: reconcile level ↔ XP so saves stay valid.
 * Prefers preserving a high level from an older, easier curve by bumping XP up.
 */
export function normalizeSkills(skills: Skills): void {
  for (const id of ['attack', 'strength', 'defense', 'fishing'] as SkillId[]) {
    const s = skills[id];
    if (!s) continue;
    s.level = Math.max(1, Math.min(99, Math.floor(s.level || 1)));
    s.xp = Math.max(0, Math.floor(s.xp || 0));
    // If save had a high level on an old easy curve, preserve level by bumping XP.
    const minXp = xpForLevel(s.level);
    if (s.xp < minXp) s.xp = minXp;
    // If XP is ahead of stored level, sync level up.
    s.level = levelFromXp(s.xp);
    if (s.level >= 99) {
      s.level = 99;
      s.xp = xpForLevel(99);
    }
  }
}

export function skillLabel(id: SkillId): string {
  if (id === 'attack') return 'Attack';
  if (id === 'strength') return 'Strength';
  if (id === 'defense') return 'Defense';
  return 'Fishing';
}

/**
 * One combat training step per successful hit (damage > 0).
 * Attack + Strength each get this on a successful hero swing;
 * Defense gets this when an enemy deals damage to the hero.
 * Misses and 0-damage rolls grant nothing.
 */
export const XP_PER_HIT = 4;
