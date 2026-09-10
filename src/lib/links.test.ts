import { describe, expect, it } from "vitest";
import { automateLink, evenLegs, launchpadCreateLink, launchpadTokenLink, stockLink } from "./links";

const NVDA = `0x${"a".repeat(40)}`;
const TSLA = `0x${"b".repeat(40)}`;
const AAPL = `0x${"c".repeat(40)}`;

describe("stockLink", () => {
  it("points at the stock page and can open the trade panel", () => {
    expect(stockLink(NVDA)).toBe(`https://basestocks.finance/stocks/${NVDA}`);
    expect(stockLink(NVDA, "buy")).toBe(`https://basestocks.finance/stocks/${NVDA}?trade=buy`);
  });
});

describe("evenLegs", () => {
  it("always sums to exactly 10000, remainder to the first leg", () => {
    for (const count of [1, 2, 3, 4, 6, 7, 8]) {
      const legs = evenLegs(Array.from({ length: count }, (_, index) => `0x${String(index).repeat(40)}`));
      expect(legs.reduce((sum, l) => sum + l.bps, 0)).toBe(10_000);
    }
  });

  it("gives three legs 3334/3333/3333 rather than losing a basis point", () => {
    expect(evenLegs([NVDA, TSLA, AAPL]).map((l) => l.bps)).toEqual([3_334, 3_333, 3_333]);
  });

  it("returns nothing for an empty plan", () => {
    expect(evenLegs([])).toEqual([]);
  });
});

describe("automateLink", () => {
  it("builds the parameters the plan wizard already parses", () => {
    const url = new URL(automateLink([{ address: NVDA, bps: 10_000 }], { usd: 25, cadenceDays: 7, name: "NVDA plan" }));
    expect(url.pathname).toBe("/automate");
    expect(url.searchParams.get("legs")).toBe(`${NVDA}:10000`);
    expect(url.searchParams.get("usd")).toBe("25");
    expect(url.searchParams.get("cadence")).toBe("7");
    expect(url.searchParams.get("name")).toBe("NVDA plan");
  });

  /**
   * The wizard drops a plan whose weights do not sum to 10000 and shows an empty form instead,
   * with no explanation. Refusing here is the difference between a bug the user reports and a bug
   * the user blames on themselves.
   */
  it("refuses to emit a link whose legs do not sum to 10000", () => {
    expect(() => automateLink([{ address: NVDA, bps: 5_000 }], { usd: 25, cadenceDays: 7 })).toThrow(/10000/);
    expect(() => automateLink([], { usd: 25, cadenceDays: 7 })).toThrow();
  });

  it("round-trips an even split", () => {
    const url = new URL(automateLink(evenLegs([NVDA, TSLA]), { usd: 50, cadenceDays: 30 }));
    expect(url.searchParams.get("legs")).toBe(`${NVDA}:5000,${TSLA}:5000`);
  });
});

describe("launchpad links", () => {
  it("points at the token page", () => {
    expect(launchpadTokenLink(NVDA)).toBe(`https://launchpad.basestocks.finance/token/${NVDA}`);
  });

  it("prefills the create form without pinning anything", () => {
    const url = new URL(launchpadCreateLink({ name: "My Token", symbol: "MTK", stock: NVDA }));
    expect(url.pathname).toBe("/create");
    expect(url.searchParams.get("name")).toBe("My Token");
    expect(url.searchParams.get("symbol")).toBe("MTK");
    expect(url.searchParams.get("stock")).toBe(NVDA);
  });

  it("omits an empty field rather than sending it blank", () => {
    expect(new URL(launchpadCreateLink({ name: "", symbol: "MTK" })).searchParams.has("name")).toBe(false);
  });
});
