export type SkillId = 'attack' | 'strength' | 'defense' | 'fishing';

export interface SkillState {
  level: number;
  xp: number;
}

export type Skills = Record<SkillId, SkillState>;

/** Cumulative XP required to *reach* level L (level 1 = 0).
 * Deliberately slower than the original squished curve so each early level
 * represents a few encounters instead of arriving after every kill.
 */
const CUM_XP: number[] = (() => {
  const arr = [0, 0]; // index = level
  let total = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    const diff = Math.floor(((lvl + 1) + 120 * Math.pow(2, lvl / 9)) / 3);
    total += Math.max(100, diff);
    arr.push(total);
  }
  return arr;
})();

export function createDefaultSkills(): Skills {
  return {
    attack: { level: 1, xp: 0 },
    strength: { level: 1, xp: 0 },
    defense: { level: 1, xp: 0 },
    fishing: { level: 1, xp: 0 },
  };
}

export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.min(99, Math.floor(level)));
  return CUM_XP[L] ?? 0;
}

export function levelFromXp(xp: number): number {
  let lvl = 1;
  for (let i = 99; i >= 1; i--) {
    if (xp >= (CUM_XP[i] ?? 0)) {
      lvl = i;
      break;
    }
  }
  return lvl;
}

export function xpProgress(skill: SkillState): { into: number; need: number; pct: number } {
  if (skill.level >= 99) return { into: 0, need: 1, pct: 1 };
  const cur = xpForLevel(skill.level);
  const next = xpForLevel(skill.level + 1);
  const into = skill.xp - cur;
  const need = Math.max(1, next - cur);
  return { into, need, pct: Math.min(1, into / need) };
}

export interface LevelUpEvent {
  skill: SkillId;
  level: number;
}

/** Add XP; returns any level-ups that occurred. */
export function addSkillXp(skills: Skills, skill: SkillId, amount: number): LevelUpEvent[] {
  if (amount <= 0) return [];
  const s = skills[skill];
  if (s.level >= 99) return [];
  s.xp += amount;
  const events: LevelUpEvent[] = [];
  let newLvl = levelFromXp(s.xp);
  if (newLvl > 99) newLvl = 99;
  while (s.level < newLvl) {
    s.level += 1;
    events.push({ skill, level: s.level });
  }
  return events;
}

export function skillLabel(id: SkillId): string {
  if (id === 'attack') return 'Attack';
  if (id === 'strength') return 'Strength';
  if (id === 'defense') return 'Defense';
  return 'Fishing';
}
