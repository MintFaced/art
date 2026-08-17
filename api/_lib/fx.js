// NZD is the master currency. USD checkout converts at the rate of the hour.
let cache = null;
let at = 0;
const TTL = 60 * 60 * 1000;

export async function nzdToUsd() {
  if (cache && Date.now() - at < TTL) return cache;
  const r = await fetch('https://open.er-api.com/v6/latest/NZD');
  if (!r.ok) throw new Error('fx unavailable');
  const j = await r.json();
  const rate = j?.rates?.USD;
  if (!rate) throw new Error('fx missing USD');
  cache = rate;
  at = Date.now();
  return rate;
}

// Stripe wants the smallest unit. NZD and USD are both 2 decimal places.
export const toMinorUnits = (amount) => Math.round(amount * 100);
