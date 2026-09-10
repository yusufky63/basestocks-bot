import { describe, expect, it } from "vitest";
import { resolveStock, splitTickers, normalizeQuery } from "./resolve";
import type { V1Stock } from "@/services/bstocks";

let nextAddress = 1;
function stock(symbol: string, name: string, address = `0x${(nextAddress++).toString(16).padStart(40, "0")}`): V1Stock {
  return {
    address,
    symbol,
    tokenSymbol: `${symbol}c`,
    name,
    decimals: 8,
    multiplier: "1000000000000000000",
    multiplierPrecision: "1000000000000000000",
    dexPriceUsd: 1,
    dexChange24hPct: 0,
    dexUpdatedAt: null,
    liquidityUsd: null,
    volume24hUsd: null,
    reference: null,
    displayUsd: 1,
    displaySource: "market",
    status: { code: "live", label: "Live", detail: "" },
    totalSupply: "1",
    transferPaused: false,
    tags: [],
  };
}

const UNIVERSE = [
  stock("NVDA", "NVIDIA Corporation"),
  stock("TSLA", "Tesla, Inc."),
  stock("INTC", "Intel Corporation"),
  stock("COIN", "Coinbase Global, Inc."),
  stock("AAPL", "Apple Inc."),
];

describe("resolveStock", () => {
  it("matches a plain ticker", () => {
    expect(resolveStock(UNIVERSE, "nvda").stock?.symbol).toBe("NVDA");
  });

  it("strips a cashtag", () => {
    expect(resolveStock(UNIVERSE, "$TSLA").stock?.symbol).toBe("TSLA");
  });

  it("matches the token symbol", () => {
    expect(resolveStock(UNIVERSE, "NVDAc").stock?.symbol).toBe("NVDA");
  });

  /**
   * The reason this module exists. Token symbols are the ticker plus a lowercase c, so a
   * strip-the-trailing-c rule applied first would turn INTC into INT and find nothing, and would
   * make COIN ambiguous. Exact matches are tried in full, before any stripping.
   */
  it("does not mangle a ticker that ends in C", () => {
    expect(resolveStock(UNIVERSE, "INTC").stock?.symbol).toBe("INTC");
    expect(resolveStock(UNIVERSE, "INTCc").stock?.symbol).toBe("INTC");
  });

  it("does not confuse COIN with a token suffix", () => {
    expect(resolveStock(UNIVERSE, "COIN").stock?.symbol).toBe("COIN");
    expect(resolveStock(UNIVERSE, "COINc").stock?.symbol).toBe("COIN");
  });

  it("matches a company name", () => {
    expect(resolveStock(UNIVERSE, "Apple").stock?.symbol).toBe("AAPL");
    expect(resolveStock(UNIVERSE, "nvidia").stock?.symbol).toBe("NVDA");
  });

  it("matches an address, case insensitively", () => {
    const target = UNIVERSE[0]!;
    expect(resolveStock(UNIVERSE, target.address.toUpperCase().replace("0X", "0x")).stock?.symbol).toBe("NVDA");
  });

  it("returns nothing for an unknown address rather than guessing a neighbour", () => {
    expect(resolveStock(UNIVERSE, `0x${"1".repeat(40)}`).stock).toBeNull();
  });

  it("resolves a unique name prefix", () => {
    expect(resolveStock(UNIVERSE, "co").stock?.symbol).toBe("COIN");
  });

  it("offers suggestions rather than guessing when several could match", () => {
    // "or" appears inside both "NVIDIA Corporation" and "Intel Corporation" and starts neither.
    const { stock: hit, suggestions } = resolveStock(UNIVERSE, "or");
    expect(hit).toBeNull();
    expect(suggestions.map((s) => s.symbol)).toEqual(expect.arrayContaining(["NVDA", "INTC"]));
  });

  it("treats an empty query as no match", () => {
    expect(resolveStock(UNIVERSE, "   ").stock).toBeNull();
  });
});

describe("normalizeQuery", () => {
  it("drops characters that could only be there to break something", () => {
    expect(normalizeQuery("  $NV<DA>  ")).toBe("NVDA");
  });
});

describe("splitTickers", () => {
  it("accepts commas and spaces, and caps the fan-out", () => {
    expect(splitTickers("NVDA, TSLA AAPL")).toEqual(["NVDA", "TSLA", "AAPL"]);
    expect(splitTickers("a b c d e f g h i j", 3)).toHaveLength(3);
  });
});
