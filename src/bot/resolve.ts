import type { V1Stock } from "@/services/bstocks";

/**
 * Turns whatever somebody typed into one listed stock.
 *
 * The trap this exists to avoid: B20 token symbols are the ticker plus a lowercase `c`, so `NVDA`
 * is the equity and `NVDAc` is the token. A naive "strip the trailing c" rule turns `INTC` into
 * `INT` and finds nothing, and it would happily match `COIN` against the wrong row. So exact
 * matches on both symbols are tried first, in full, and the strip is only ever a last resort.
 */
export interface Resolution {
  stock: V1Stock | null;
  /** Near misses worth offering back when nothing matched exactly. */
  suggestions: V1Stock[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/^\$+/, "").replace(/[^0-9a-zA-Z.\- ]/g, "").trim();
}

export function resolveStock(stocks: V1Stock[], raw: string): Resolution {
  const query = normalizeQuery(raw);
  if (!query) return { stock: null, suggestions: [] };

  if (ADDRESS.test(query)) {
    const byAddress = stocks.find((s) => s.address.toLowerCase() === query.toLowerCase());
    return { stock: byAddress ?? null, suggestions: [] };
  }

  const upper = query.toUpperCase();

  const exact =
    stocks.find((s) => s.symbol.toUpperCase() === upper) ??
    stocks.find((s) => s.tokenSymbol.toUpperCase() === upper);
  if (exact) return { stock: exact, suggestions: [] };

  const byName = stocks.filter((s) => s.name.toUpperCase().startsWith(upper));
  if (byName.length === 1 && byName[0]) return { stock: byName[0], suggestions: [] };

  // Only now, and only when the input actually ends in a lowercase c, is the token suffix stripped.
  if (/c$/.test(query) && query.length > 2) {
    const stripped = query.slice(0, -1).toUpperCase();
    const hit = stocks.find((s) => s.symbol.toUpperCase() === stripped);
    if (hit) return { stock: hit, suggestions: [] };
  }

  const contains = stocks.filter(
    (s) =>
      s.symbol.toUpperCase().includes(upper) ||
      s.tokenSymbol.toUpperCase().includes(upper) ||
      s.name.toUpperCase().includes(upper),
  );
  if (contains.length === 1 && contains[0]) return { stock: contains[0], suggestions: [] };
  return { stock: null, suggestions: [...byName, ...contains].slice(0, 6) };
}

/** Splits `NVDA,TSLA` or `NVDA TSLA` into candidate tickers, capped so one message cannot fan out. */
export function splitTickers(raw: string, max = 8): string[] {
  return raw
    .split(/[,\s]+/)
    .map((t) => normalizeQuery(t))
    .filter(Boolean)
    .slice(0, max);
}

export function isAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}
