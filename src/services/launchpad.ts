import { env } from "@/config/env";
import { readJson, withQuery } from "@/lib/http";

/**
 * The StockPair launchpad's public API, as this bot consumes it.
 *
 * Read routes only. `POST /api/quote` and `POST /api/metadata` are both behind the launchpad's own
 * region gate; calling either from here would present this deployment's country instead of the
 * user's and turn a compliance control into a hole. Quotes and pins happen on the other side of a
 * link, in the user's own browser.
 */

/** Mirrors the launchpad's `MarketView`. Fields this bot does not render are omitted. */
export interface Market {
  token: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  creator: string;
  stock: { address: string; symbol: string; ticker: string; decimals: number };
  launchedAt: string;
  priceInStock: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  change24hPercent: number | null;
  volume24hUsd: number | null;
  trades24h: number;
  volumeUsd: number | null;
  trades: number;
  holders: number;
  stockUsd: number | null;
  stockFeedStatus: "live" | "holding" | "unknown";
  lastTradeAt: string | null;
  txHash: string;
}

export interface MarketsPage {
  markets: Market[];
  /** The indexer's progress, not the response's clock. Worth showing when it lags. */
  asOf: string;
}

export type MarketOrder = "newest" | "volume24h";

export async function listMarkets(opts: {
  orderBy?: MarketOrder;
  limit?: number;
  q?: string;
  stock?: string;
  creator?: string;
} = {}): Promise<MarketsPage | null> {
  return readJson<MarketsPage>(
    withQuery(env().LAUNCHPAD_URL, "/api/markets", {
      orderBy: opts.orderBy,
      limit: opts.limit,
      q: opts.q,
      stock: opts.stock,
      creator: opts.creator,
    }),
    { revalidate: 30 },
  );
}

export type TokenLookup =
  | { status: "indexed"; market: Market; details?: unknown }
  | { status: "indexing"; launch: { token: string; stockSymbol: string | null; stockTicker: string | null } }
  | null;

export async function readToken(address: string): Promise<TokenLookup> {
  return readJson<TokenLookup>(withQuery(env().LAUNCHPAD_URL, `/api/tokens/${address}`), { revalidate: 15 });
}

export interface LaunchStock {
  address: string;
  symbol: string;
  ticker: string;
  name: string;
  decimals: number;
  enabled: boolean;
  priceUsd: number | null;
  feedStatus: "live" | "holding" | "unknown";
  launches: number;
}

export async function listLaunchStocks(): Promise<LaunchStock[]> {
  const body = await readJson<{ stocks: LaunchStock[] }>(withQuery(env().LAUNCHPAD_URL, "/api/stocks"), {
    revalidate: 300,
  });
  return body?.stocks ?? [];
}

/* ------------------------------------------------------------------ *
 * The twenty second rule
 * ------------------------------------------------------------------ */

/** From `StockPairHook.sol`: 9900 bps at launch, 100 bps after, linear in between. */
export const ANTI_SNIPE_SECONDS = 20;
export const START_FEE_BPS = 9_900;
export const BASE_FEE_BPS = 100;

/**
 * The hook's fee at a given moment, computed the same way the contract does.
 *
 * A pool is live from its first block, so a token *can* be traded at once. What changes over the
 * first twenty seconds is the price of doing it: the fee starts at 99% of the stock side and decays
 * linearly to 1%. Showing this is the single most useful thing the launchpad bot does, because the
 * alternative is a user buying into a 74% fee because a message said the token was live.
 *
 * Read from `launchedAt` rather than from a quote so a card costs no upstream call. A quote will
 * report the same number from the chain when the user is actually about to trade.
 */
export function feeBpsAt(launchedAt: string, now = Date.now()): number {
  const started = Date.parse(launchedAt);
  if (!Number.isFinite(started)) return BASE_FEE_BPS;
  const elapsed = Math.floor((now - started) / 1_000);
  if (elapsed >= ANTI_SNIPE_SECONDS) return BASE_FEE_BPS;
  if (elapsed <= 0) return START_FEE_BPS;
  return START_FEE_BPS - Math.floor(((START_FEE_BPS - BASE_FEE_BPS) * elapsed) / ANTI_SNIPE_SECONDS);
}

/** Whole seconds until the fee settles at 1%. Zero once it has. */
export function secondsUntilFairFee(launchedAt: string, now = Date.now()): number {
  const started = Date.parse(launchedAt);
  if (!Number.isFinite(started)) return 0;
  const elapsed = (now - started) / 1_000;
  return Math.max(0, Math.ceil(ANTI_SNIPE_SECONDS - elapsed));
}
