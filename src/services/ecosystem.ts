import { env } from "@/config/env";
import { readJson, withQuery } from "@/lib/http";

/**
 * The rest of the app, as the bot reads it.
 *
 * Everything here is a public GET on `basestocks.finance`, the same endpoints the site's own pages
 * and the developer API serve. Nothing in this file can write, and none of these routes is behind
 * the region gate, because none of them builds something signable.
 */

interface Envelope<T> {
  data: T;
  meta?: { cacheSeconds?: number };
}

/* ------------------------------------------------------------------ *
 * Earn
 * ------------------------------------------------------------------ */

export interface EarnOpportunity {
  id: string;
  provider: string;
  title: string;
  type: string;
  variableApyPct: number | null;
  rewardsAprPct: number | null;
  tvlUsd: number | null;
  riskLabel: string;
  risks?: string[];
}

export interface EarnView {
  count: number;
  opportunities: EarnOpportunity[];
  /** Named rather than hidden: a venue that did not answer is not a venue with no yield. */
  unavailableProviders: string[];
}

export async function readEarn(): Promise<EarnView | null> {
  const body = await readJson<Envelope<EarnView>>(withQuery(env().BSTOCKS_URL, "/api/v1/earn"), {
    revalidate: 120,
  });
  return body?.data ?? null;
}

/* ------------------------------------------------------------------ *
 * News
 * ------------------------------------------------------------------ */

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  ticker?: string;
}

/**
 * Titles and links, nothing else.
 *
 * A headline is data from a feed the app does not control, so it is escaped like any other outside
 * string and its link is only ever rendered as the feed gave it. The bot never summarises one in
 * its own voice, which would turn somebody else's claim into this brand's.
 */
export async function readNews(opts: { symbol?: string; scope?: "ecosystem" | "market"; limit?: number } = {}): Promise<Headline[]> {
  const body = await readJson<Envelope<{ items: Headline[] }>>(
    withQuery(env().BSTOCKS_URL, "/api/v1/news", {
      symbol: opts.symbol,
      scope: opts.symbol ? undefined : (opts.scope ?? "ecosystem"),
      limit: opts.limit ?? 6,
    }),
    { revalidate: 300 },
  );
  return body?.data?.items ?? [];
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export interface StatusCheck {
  id: string;
  group: string;
  name: string;
  status: "ok" | "degraded" | "down" | string;
  latencyMs?: number;
  detail?: string;
}

export interface StatusReport {
  overall: string;
  checks: StatusCheck[];
  generatedAt?: number;
}

export async function readStatus(): Promise<StatusReport | null> {
  return readJson<StatusReport>(withQuery(env().BSTOCKS_URL, "/api/status"), { revalidate: 60 });
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export interface Template {
  id: string;
  slug: string;
  name: string;
  description: string;
  active: boolean;
  allocations: { assetAddress: string; weightBps: number }[];
}

/**
 * Starter baskets, which the app is careful to call templates rather than recommendations. The bot
 * repeats that word for the same reason.
 */
export async function readTemplates(): Promise<Template[]> {
  const body = await readJson<{ templates: Template[] }>(withQuery(env().BSTOCKS_URL, "/api/templates"), {
    revalidate: 600,
  });
  return (body?.templates ?? []).filter((t) => t.active);
}

/* ------------------------------------------------------------------ *
 * Gift pools
 * ------------------------------------------------------------------ */

export interface PoolEntry {
  pool: {
    id: string;
    onchainId: string;
    creator: string;
    slots: number;
    legs: { token: string; amountPerClaim: string }[];
    gateMode?: string;
    expiresAt?: string | null;
    closedAt?: string | null;
  };
  claimed?: number;
  remaining?: number;
}

export async function readPools(): Promise<PoolEntry[]> {
  const body = await readJson<{ pools: PoolEntry[] }>(withQuery(env().BSTOCKS_URL, "/api/pools"), {
    revalidate: 60,
  });
  return body?.pools ?? [];
}
