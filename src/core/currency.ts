import type { CoinPurse } from './types';

/** 100 copper → 1 silver; 100 silver → 1 gold. */
export const COPPER_PER_SILVER = 100;
export const SILVER_PER_GOLD = 100;
/** Copper in one gold (100 × 100). */
export const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD;

export function emptyPurse(): CoinPurse {
  return { gold: 0, silver: 0, copper: 0 };
}

/** Total value of a purse in copper. */
export function totalCopper(purse: CoinPurse): number {
  return (
    Math.max(0, purse.gold) * COPPER_PER_GOLD +
    Math.max(0, purse.silver) * COPPER_PER_SILVER +
    Math.max(0, purse.copper)
  );
}

/**
 * Collapse overflow: copper ≥ 100 → silver, silver ≥ 100 → gold.
 * Mutates and returns the same purse. Floors negative denoms to 0.
 */
export function normalizeCoins(purse: CoinPurse): CoinPurse {
  let copper = Math.max(0, Math.floor(purse.copper));
  let silver = Math.max(0, Math.floor(purse.silver));
  let gold = Math.max(0, Math.floor(purse.gold));

  silver += Math.floor(copper / COPPER_PER_SILVER);
  copper = copper % COPPER_PER_SILVER;

  gold += Math.floor(silver / SILVER_PER_GOLD);
  silver = silver % SILVER_PER_GOLD;

  purse.copper = copper;
  purse.silver = silver;
  purse.gold = gold;
  return purse;
}

/** Add raw denomination amounts, then normalize. */
export function addCoins(
  purse: CoinPurse,
  amount: { gold?: number; silver?: number; copper?: number },
): CoinPurse {
  purse.gold += amount.gold ?? 0;
  purse.silver += amount.silver ?? 0;
  purse.copper += amount.copper ?? 0;
  return normalizeCoins(purse);
}

/** Add a copper-equivalent amount (e.g. loot, rewards), then normalize. */
export function addCopper(purse: CoinPurse, copperAmount: number): CoinPurse {
  if (copperAmount === 0) return normalizeCoins(purse);
  purse.copper += Math.floor(copperAmount);
  return normalizeCoins(purse);
}

/**
 * Spend copper-equivalent from the wallet (largest denoms first after
 * converting to copper total). Returns true if successful.
 */
export function trySpendCopper(purse: CoinPurse, costCopper: number): boolean {
  const cost = Math.max(0, Math.floor(costCopper));
  if (cost === 0) {
    normalizeCoins(purse);
    return true;
  }
  const total = totalCopper(purse);
  if (total < cost) return false;
  const remaining = total - cost;
  purse.gold = Math.floor(remaining / COPPER_PER_GOLD);
  let left = remaining % COPPER_PER_GOLD;
  purse.silver = Math.floor(left / COPPER_PER_SILVER);
  purse.copper = left % COPPER_PER_SILVER;
  return true;
}

/** Set purse from a copper total (useful for tests / save repair). */
export function setFromCopper(purse: CoinPurse, copperTotal: number): CoinPurse {
  const t = Math.max(0, Math.floor(copperTotal));
  purse.gold = Math.floor(t / COPPER_PER_GOLD);
  let left = t % COPPER_PER_GOLD;
  purse.silver = Math.floor(left / COPPER_PER_SILVER);
  purse.copper = left % COPPER_PER_SILVER;
  return purse;
}

/** Short display: "1g 2s 3c" (omits zero dens except all-zero → "0c"). */
export function formatCoins(purse: CoinPurse): string {
  normalizeCoins(purse);
  const parts: string[] = [];
  if (purse.gold > 0) parts.push(`${purse.gold}g`);
  if (purse.silver > 0) parts.push(`${purse.silver}s`);
  if (purse.copper > 0 || parts.length === 0) parts.push(`${purse.copper}c`);
  return parts.join(' ');
}
