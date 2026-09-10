import { describe, expect, it } from "vitest";
import { inspectForClaim } from "./claim";
import { parseCommand, parseDca } from "./commands";

describe("inspectForClaim", () => {
  /**
   * Whoever holds the key holds the gift. A bot that parses, logs or echoes a message containing
   * one has handed the gift to the fastest reader in the chat, so the key check runs before
   * anything else looks at the text at all.
   */
  it("flags a claim key wherever it appears", () => {
    expect(inspectForClaim("https://basestocks.finance/gifts/claim/abc123#k=SECRET").kind).toBe("key-present");
    expect(inspectForClaim("hey look at this #k=SECRET thanks").kind).toBe("key-present");
    expect(inspectForClaim("HTTPS://BASESTOCKS.FINANCE/GIFTS/CLAIM/ABC123#K=SECRET").kind).toBe("key-present");
  });

  it("recognises a claim link that carries no key", () => {
    const verdict = inspectForClaim("someone sent me https://basestocks.finance/gifts/claim/abc123def");
    expect(verdict).toEqual({ kind: "claim-link", id: "abc123def" });
  });

  it("recognises a claim link on a preview deployment too, since that is still a real gift", () => {
    expect(inspectForClaim("https://preview.example.com/gifts/claim/xyz789ab").kind).toBe("claim-link");
  });

  it("says nothing about ordinary text", () => {
    expect(inspectForClaim("/price NVDA").kind).toBe("none");
    expect(inspectForClaim("what is the k value here").kind).toBe("none");
  });
});

describe("parseCommand", () => {
  it("reads a bare command", () => {
    expect(parseCommand("/price NVDA")).toEqual({ command: "price", args: "NVDA" });
  });

  it("strips the @botname suffix Telegram adds in groups", () => {
    expect(parseCommand("/price@BaseStocksBot NVDA")).toEqual({ command: "price", args: "NVDA" });
  });

  it("lowercases the command and keeps the arguments as typed", () => {
    expect(parseCommand("/PRICE  NvDa ")).toEqual({ command: "price", args: "NvDa" });
  });

  it("handles a command with no arguments", () => {
    expect(parseCommand("/markets")).toEqual({ command: "markets", args: "" });
  });

  it("is not a command when it does not start with a slash", () => {
    expect(parseCommand("price NVDA")).toBeNull();
    expect(parseCommand("what is /price")).toBeNull();
  });
});

describe("parseDca", () => {
  it("reads amount, tickers and cadence", () => {
    expect(parseDca("25 NVDA weekly")).toEqual({
      usd: 25,
      tickers: ["NVDA"],
      cadenceDays: 7,
      cadenceLabel: "every week",
    });
  });

  it("accepts several tickers and a dollar sign", () => {
    expect(parseDca("$50 NVDA,TSLA monthly")).toMatchObject({ usd: 50, tickers: ["NVDA", "TSLA"], cadenceDays: 30 });
  });

  it("refuses input it would have to guess at, rather than sending a link that drops a leg", () => {
    expect(parseDca("NVDA weekly")).toBeNull();
    expect(parseDca("25 NVDA")).toBeNull();
    expect(parseDca("25 NVDA fortnightly")).toBeNull();
    expect(parseDca("-5 NVDA weekly")).toBeNull();
    expect(parseDca("")).toBeNull();
  });
});
