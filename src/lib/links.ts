import { env } from "@/config/env";

/**
 * Every action this bot offers is a URL, and this file is the only place one is built.
 *
 * That is the whole custody and compliance story in one sentence: the bot cannot sign, cannot
 * approve and cannot pick an address, because all it ever produces is a link the user opens
 * themselves. Their request then carries their own headers, and the eligibility gate in each
 * sibling app runs exactly as it does for a visitor who arrived by typing the address.
 *
 * The parameter names below are the ones the two apps already parse. They are not invented here,
 * and a change on either side is a change here too.
 */

export function bstocksUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  return build(env().BSTOCKS_URL, path, params);
}

export function launchpadUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  return build(env().LAUNCHPAD_URL, path, params);
}

function build(base: string, path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** A stock's page, optionally with the trade panel already on the right side. */
export function stockLink(address: string, side?: "buy" | "sell"): string {
  return bstocksUrl(`/stocks/${address}`, { trade: side });
}

export interface Leg {
  address: string;
  /** Basis points of the plan. The wizard silently degrades unless the legs sum to 10000. */
  bps: number;
}

/**
 * A recurring plan, handed over entirely in the URL.
 *
 * `parseAutomateLegs` on the BStocks side reads `legs=<address>:<bps>,…`; it wants the weights to
 * sum to 10000 and drops the whole plan when they do not, which would land the user in an empty
 * wizard with no explanation. So this throws instead of emitting a link that fails quietly.
 */
export function automateLink(legs: Leg[], opts: { usd: number; cadenceDays: number; name?: string }): string {
  if (legs.length === 0) throw new Error("automateLink: at least one leg");
  const total = legs.reduce((sum, l) => sum + l.bps, 0);
  if (total !== 10_000) throw new Error(`automateLink: legs must sum to 10000 bps, got ${total}`);
  return bstocksUrl("/automate", {
    legs: legs.map((l) => `${l.address}:${l.bps}`).join(","),
    usd: opts.usd,
    cadence: opts.cadenceDays,
    name: opts.name,
  });
}

/** Splits a plan evenly, giving the remainder to the first leg so the total is exactly 10000. */
export function evenLegs(addresses: string[]): Leg[] {
  if (addresses.length === 0) return [];
  const each = Math.floor(10_000 / addresses.length);
  const legs = addresses.map((address) => ({ address, bps: each }));
  const first = legs[0];
  if (first) first.bps += 10_000 - each * addresses.length;
  return legs;
}

export function launchpadTokenLink(token: string): string {
  return launchpadUrl(`/token/${token}`);
}

export function launchpadMarketsLink(stock?: string): string {
  return launchpadUrl("/markets", { stock });
}

/**
 * The create form, prefilled.
 *
 * Metadata pinning deliberately stays on the other side of this link: the launchpad's pin route is
 * rate limited per caller and sits behind its region gate, so pinning from here would spend one
 * shared budget for every user and would present this deployment's region instead of theirs.
 */
export function launchpadCreateLink(fields: { name?: string; symbol?: string; stock?: string }): string {
  return launchpadUrl("/create", fields);
}

export function basescanTx(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}
