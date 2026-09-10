import { env } from "@/config/env";
import { readJson, withQuery } from "@/lib/http";

/**
 * The BStocks public API, as this bot consumes it.
 *
 * Only the read endpoints under `/api/v1`, which are documented as keyless, CORS-open and cached at
 * the edge. Nothing here touches a route that prepares something signable: those are gated on the
 * caller's country, and a call made from this deployment would answer for the wrong region.
 *
 * Every response is `{ data, meta }`, and `meta.cacheSeconds` says how long the body stays valid,
 * which is what the `revalidate` values below are set from rather than guessed.
 */
const V1_CACHE = {
  stocks: 30,
  stats: 300,
} as const;

export interface V1Reference {
  totalReturnUsd: number | null;
  updatedAt: number | null;
  isStale: boolean;
  isPaused: boolean;
}

export interface V1Stock {
  address: string;
  symbol: string;
  tokenSymbol: string;
  name: string;
  decimals: number;
  multiplier: string;
  multiplierPrecision: string;
  dexPriceUsd: number | null;
  dexChange24hPct: number | null;
  dexUpdatedAt: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  reference: V1Reference | null;
  displayUsd: number | null;
  displaySource: "market" | "reference" | "none";
  status: { code: string; label: string; detail: string };
  totalSupply: string;
  transferPaused: boolean;
  tags: string[];
  logoUrl?: string;
}

interface Envelope<T> {
  data: T;
  meta?: { cacheSeconds?: number; generatedAt?: number };
}

/**
 * `data` is an object with a `stocks` array, not the array itself. Worth stating, because assuming
 * the flatter shape is exactly the mistake the live test in `src/bot/commands.live.test.ts` caught:
 * a unit test with a hand-written fixture would have agreed with the wrong guess forever.
 */
export async function listStocks(): Promise<V1Stock[]> {
  const body = await readJson<Envelope<{ count: number; stocks: V1Stock[] }>>(
    withQuery(env().BSTOCKS_URL, "/api/v1/stocks"),
    { revalidate: V1_CACHE.stocks },
  );
  const stocks = body?.data?.stocks;
  return Array.isArray(stocks) ? stocks : [];
}

/** A window of counted activity. Every figure is counted only from a record matched to its receipt. */
export interface StatsWindow {
  trades?: number;
  wallets?: number;
  tradeVolumeUsd?: number;
  planRuns?: number;
  linksCreated?: number;
  linksClaimed?: number;
  poolClaims?: number;
  earnDeposits?: number;
}

export interface V1Stats {
  generatedAt?: number;
  windows?: Partial<Record<"24h" | "7d" | "30d" | "all", StatsWindow>>;
}

export async function readStats(): Promise<V1Stats | null> {
  const body = await readJson<Envelope<V1Stats>>(withQuery(env().BSTOCKS_URL, "/api/v1/stats"), {
    revalidate: V1_CACHE.stats,
  });
  return body?.data ?? null;
}

export interface HealthReport {
  ok?: boolean;
  alerts?: string[];
  storage?: { tablesReady?: boolean; missing?: string[] };
  deploy?: { commit?: string };
}

/** Read fresh: an alert that is five minutes old is not an alert. */
export async function readHealth(): Promise<HealthReport | null> {
  return readJson<HealthReport>(withQuery(env().BSTOCKS_URL, "/api/health"), { revalidate: 0, timeoutMs: 8_000 });
}

/**
 * The app's own status vocabulary, not a second opinion invented here.
 *
 * `tradable` and `thin` can be filled; `very-thin` can technically be filled and should not be
 * offered as if it could be filled well; `no-pool` has no route, `not-issued` has no supply, and
 * `paused` means the issuer stopped transfers.
 */
export type TradingStatus = "tradable" | "thin" | "very-thin" | "no-pool" | "not-issued" | "paused";

const FILLABLE: TradingStatus[] = ["tradable", "thin"];

export function isTradable(stock: V1Stock): boolean {
  return FILLABLE.includes(stock.status.code as TradingStatus) && !stock.transferPaused;
}

/* ------------------------------------------------------------------ *
 * A wallet's own position
 * ------------------------------------------------------------------ */

export interface Holding {
  address: string;
  symbol: string;
  shares: string;
  decimals: number;
  priceUsd: number | null;
  priceSource: string;
  valueUsd: number;
  change24hPct: number | null;
  weightBps: number;
}

export interface Portfolio {
  owner: string;
  totalValueUsd: number;
  change24hPct: number | null;
  usdc: { raw: string; valueUsd: number } | null;
  earnValueUsd: number;
  liquidityValueUsd: number;
  holdings: Holding[];
}

/**
 * Any wallet's tokenized-stock position, read from the chain.
 *
 * Public by design and public in fact: this endpoint takes an address in the path and needs no key,
 * because every number in it is already on Base for anyone to read. That is what lets the bot show
 * somebody their own holdings without ever asking them to prove anything, and it is also why the
 * address a user gives the bot is a bookmark rather than a login.
 */
export async function readPortfolio(address: string): Promise<Portfolio | null> {
  const body = await readJson<Envelope<Portfolio>>(
    withQuery(env().BSTOCKS_URL, `/api/v1/portfolio/${address}`),
    { revalidate: 15 },
  );
  return body?.data ?? null;
}

/** The name a wallet has chosen, when it has one. Cheap, cached, and never required. */
export async function reverseBasename(address: string): Promise<string | null> {
  const body = await readJson<{ name?: string | null }>(
    withQuery(env().BSTOCKS_URL, "/api/basename/reverse", { address }),
    { revalidate: 3_600 },
  );
  return body?.name ?? null;
}

/** `alice.base.eth` to an address. Returns null for anything that does not resolve. */
export async function resolveBasename(name: string): Promise<string | null> {
  const body = await readJson<{ resolved?: { address?: string } | null }>(
    withQuery(env().BSTOCKS_URL, "/api/basename/resolve", { name }),
    { revalidate: 3_600 },
  );
  const address = body?.resolved?.address;
  return typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null;
}
