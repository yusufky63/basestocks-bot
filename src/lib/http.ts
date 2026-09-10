/**
 * The only way this service reads an upstream product.
 *
 * It is GET-only on purpose, and there is deliberately no sibling that can POST. Both sibling apps
 * gate their write and quote routes on the caller's country header; a request made from here would
 * carry this deployment's region instead of the user's, so a compliance control would answer for
 * the wrong person. Everything actionable is handed to the user as a link they open themselves,
 * where their own request carries their own headers.
 *
 * `src/lib/boundary.test.ts` fails the build if anything outside this file and the Telegram client
 * calls `fetch` directly.
 */
export interface ReadOptions {
  /** Hard ceiling. A bot that waits is a bot that gets its update redelivered. */
  timeoutMs?: number;
  /** Seconds the platform may reuse this response. Upstream sets its own edge cache too. */
  revalidate?: number;
}

export async function readJson<T>(url: string, opts: ReadOptions = {}): Promise<T | null> {
  const { timeoutMs = 6_000, revalidate = 30 } = opts;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "basestocks-bot/0.1 (+https://basestocks.finance)" },
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // An upstream being slow or down is an ordinary condition for a bot, not an exception. The
    // caller decides what to say; throwing here would turn a degraded reply into no reply at all.
    return null;
  }
}

/** Builds a URL with only the params that have a value, so no `?limit=undefined` reaches upstream. */
export function withQuery(base: string, path: string, params: Record<string, string | number | undefined> = {}): string {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}
