import { describe, expect, it } from "vitest";
import { baseAppLink, destination, handoffUrl, isAllowedPath, metaMaskLink } from "./handoff";

/**
 * `/open` takes a path from a query string and offers to open it. A page that will open whatever it
 * is handed is an open redirect with a friendly face, and one wearing this brand's name is worth
 * more to a phisher than most. So the allowlist is the security boundary and it is tested as one.
 */
describe("isAllowedPath", () => {
  const address = `0x${"a".repeat(40)}`;

  it("accepts the paths the bot actually builds", () => {
    expect(isAllowedPath(`/stocks/${address}`)).toBe(true);
    expect(isAllowedPath(`/stocks/${address}?trade=buy`)).toBe(true);
    expect(isAllowedPath(`/token/${address}`)).toBe(true);
    expect(isAllowedPath("/markets")).toBe(true);
    expect(isAllowedPath("/portfolio")).toBe(true);
    expect(isAllowedPath("/automate?legs=0xabc:10000&usd=25&cadence=7")).toBe(true);
  });

  it("refuses another origin, however it is dressed up", () => {
    expect(isAllowedPath("https://evil.test/steal")).toBe(false);
    expect(isAllowedPath("//evil.test/steal")).toBe(false);
    expect(isAllowedPath("/\\evil.test")).toBe(false);
    expect(isAllowedPath("javascript:alert(1)")).toBe(false);
    expect(isAllowedPath("/markets@evil.test")).toBe(false);
  });

  it("refuses a path that only looks like one of ours", () => {
    expect(isAllowedPath("/stocks/0xnot-an-address")).toBe(false);
    expect(isAllowedPath(`/stocks/${address}/../../admin`)).toBe(false);
    expect(isAllowedPath("/marketsandmore")).toBe(false);
    expect(isAllowedPath("/admin")).toBe(false);
    expect(isAllowedPath("")).toBe(false);
  });
});

describe("destination", () => {
  it("puts an allowed path on our own origin", () => {
    expect(destination("bstocks", "/markets")).toBe("https://basestocks.finance/markets");
    expect(destination("launchpad", `/token/0x${"b".repeat(40)}`)).toBe(
      `https://launchpad.basestocks.finance/token/0x${"b".repeat(40)}`,
    );
  });

  it("returns nothing for a path the allowlist refuses, rather than a best effort", () => {
    expect(destination("bstocks", "https://evil.test")).toBeNull();
  });
});

describe("wallet links", () => {
  it("opens inside the Base app, with the destination encoded rather than concatenated", () => {
    const link = baseAppLink("https://basestocks.finance/stocks/0xabc?trade=buy");
    expect(link.startsWith("cbwallet://miniapp?url=")).toBe(true);
    // The `?` and `=` of the inner URL must not read as parameters of the outer one.
    expect(link).toContain("%3Ftrade%3Dbuy");
  });

  it("hands MetaMask a bare host and path, which is the shape its universal link takes", () => {
    expect(metaMaskLink("https://basestocks.finance/markets")).toBe(
      "https://metamask.app.link/dapp/basestocks.finance/markets",
    );
  });
});

describe("handoffUrl", () => {
  it("carries the app and the path, never a whole URL somebody else could set", () => {
    const url = new URL(handoffUrl("bstocks", "/markets", "Buy NVDA"));
    expect(url.origin).toBe("https://bot.basestocks.finance");
    expect(url.pathname).toBe("/open");
    expect(url.searchParams.get("app")).toBe("bstocks");
    expect(url.searchParams.get("to")).toBe("/markets");
    expect(url.searchParams.get("label")).toBe("Buy NVDA");
  });

  it("is an https link, because Telegram accepts nothing else in a button", () => {
    expect(handoffUrl("launchpad", "/markets").startsWith("https://")).toBe(true);
  });
});
