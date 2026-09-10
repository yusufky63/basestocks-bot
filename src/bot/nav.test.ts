import { describe, expect, it } from "vitest";
import { KEYBOARD_ALIASES, actionButtons, decode, encode, marketButtons, replyKeyboard, stockButtons } from "./nav";
import type { Action } from "./nav";

/**
 * `callback_data` arrives from a chat, so it is parsed the way any other outside string is: strictly,
 * with anything unrecognised becoming null rather than a best guess. The 64-byte ceiling is
 * Telegram's, and exceeding it fails at send time rather than at tap time, which is the worse place
 * to find out.
 */
describe("callback data", () => {
  const cases: Action[] = [
    { kind: "markets" },
    { kind: "help" },
    { kind: "stats" },
    { kind: "menu" },
    { kind: "top" },
    { kind: "new" },
    { kind: "price", symbol: "NVDA" },
    { kind: "buy", symbol: "TSLA" },
    { kind: "sell", symbol: "INTC" },
    { kind: "token", address: `0x${"a".repeat(40)}` },
  ];

  it.each(cases)("round-trips %o", (action) => {
    expect(decode(encode(action))).toEqual(action);
  });

  it("never exceeds Telegram's 64-byte ceiling, address included", () => {
    for (const action of cases) {
      expect(Buffer.byteLength(encode(action), "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("refuses anything it does not recognise", () => {
    expect(decode(undefined)).toBeNull();
    expect(decode("")).toBeNull();
    expect(decode("x:NVDA")).toBeNull();
    expect(decode("p:")).toBeNull();
    expect(decode("p:../../etc/passwd")).toBeNull();
    expect(decode("p:<script>")).toBeNull();
    expect(decode("p:" + "A".repeat(40))).toBeNull();
  });

  it("round-trips a confirmation with the action waiting behind it", () => {
    const gated = { kind: "confirm", next: { kind: "buy", symbol: "NVDA" } } as const;
    expect(decode(encode(gated))).toEqual(gated);
    expect(Buffer.byteLength(encode({ kind: "confirm", next: { kind: "token", address: `0x${"a".repeat(40)}` } }), "utf8")).toBeLessThanOrEqual(64);
  });

  it("lets a confirmation gate only the actions worth gating", () => {
    // Otherwise a crafted `c:` prefix would be a way to reach anything at all.
    expect(decode("c:m")).toBeNull();
    expect(decode("c:h")).toBeNull();
    expect(decode("c:c:b:NVDA")).toBeNull();
    expect(decode("c:")).toBeNull();
  });

  it("keeps the tail of a nested payload instead of truncating it", () => {
    // `split(":", 2)` would have turned c:b:NVDA into c plus b and dropped the symbol silently.
    const decoded = decode("c:b:NVDA");
    expect(decoded).toEqual({ kind: "confirm", next: { kind: "buy", symbol: "NVDA" } });
  });

  it("refuses a token argument that is not an address", () => {
    expect(decode("t:NVDA")).toBeNull();
    expect(decode(`t:0x${"z".repeat(40)}`)).toBeNull();
    expect(decode(`t:0x${"a".repeat(39)}`)).toBeNull();
  });
});

describe("the persistent keyboard", () => {
  it("uses labels the router can turn back into commands", () => {
    for (const surface of ["bstocks", "launchpad"] as const) {
      for (const row of replyKeyboard(surface).keyboard) {
        for (const button of row) {
          expect(KEYBOARD_ALIASES[button.text]).toBeDefined();
        }
      }
    }
  });

  it("stays up rather than collapsing behind an icon", () => {
    expect(replyKeyboard("bstocks").is_persistent).toBe(true);
  });
});

describe("card buttons", () => {
  it("offers buy and sell only when a stock can actually be filled", () => {
    const tradable = stockButtons("NVDA", `0x${"a".repeat(40)}`, true).flat().map((b) => b.text);
    const not = stockButtons("NVDA", `0x${"a".repeat(40)}`, false).flat().map((b) => b.text);
    expect(tradable).toContain("Buy NVDA");
    expect(not).not.toContain("Buy NVDA");
    expect(not).toContain("Open in app");
  });

  it("lays the market table out three tickers to a row", () => {
    const rows = marketButtons(["A", "B", "C", "D"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(3);
    expect(rows[1]).toHaveLength(1);
  });
});

describe("assistant actions", () => {
  it("turns a drafted trade into one tap, with the side the draft chose", () => {
    const rows = actionButtons([
      { kind: "trade", side: "buy", symbol: "NVDA", name: "NVIDIA", assetAddress: `0x${"b".repeat(40)}`, amountUsd: 50 },
    ]);
    expect(rows[0]?.[0]?.text).toBe("Buy $50 NVDA");
    expect(rows[0]?.[0]?.url).toContain("trade=buy");
  });

  it("links a cited headline to where the feed pointed, not to anything the model wrote", () => {
    const rows = actionButtons([
      { kind: "news", scope: "stock", items: [{ title: "t", url: "https://example.test/a", source: "Reuters" }] },
    ]);
    expect(rows[0]?.[0]?.url).toBe("https://example.test/a");
  });

  it("caps how many buttons one answer can produce", () => {
    const many = Array.from({ length: 8 }, () => ({ kind: "earn" as const }));
    expect(actionButtons(many).length).toBeLessThanOrEqual(4);
  });
});
