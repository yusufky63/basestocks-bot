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
