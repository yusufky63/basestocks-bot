import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { handleUpdate, parseDca } from "./commands";
import { resetEnvCache } from "@/config/env";
import { getWallet, setWallet } from "./wallet";
import { getPrompt, getWatchlist, updateWatchlist } from "./preferences";
import { decode, encode } from "./nav";
import { marketsCard } from "./render";
import { ELIGIBILITY_NOTE } from "./copy";
import { destination } from "@/lib/handoff";
import type { V1Stock } from "@/services/bstocks";
import type { TgUpdate } from "@/lib/telegram/types";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const stocks: V1Stock[] = ["NVDA", "TSLA", "AAPL"].map((symbol, i) => ({
  address: address(i + 1), symbol, tokenSymbol: `${symbol}c`, name: ["NVIDIA", "Tesla", "Apple"][i]!,
  decimals: 18, multiplier: "1000000000000000000", multiplierPrecision: "1000000000000000000", dexPriceUsd: 120,
  dexChange24hPct: 2 + i, dexUpdatedAt: Date.now(), liquidityUsd: 2_000_000, volume24hUsd: 50_000,
  reference: null, displayUsd: 120, displaySource: "market", status: { code: "tradable", label: "Live", detail: "Deep pool" },
  totalSupply: "1000000000000000000000", transferPaused: false, tags: [],
}));
let sequence = 900_000;
let user = 900_000;
let editFails = false;
const calls: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  user = ++sequence;
  editFails = false;
  calls.length = 0;
  vi.stubEnv("ASSISTANT_ENABLED", "false");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("TELEGRAM_BSTOCKS_USERNAME", "BaseStocksTestBot");
  resetEnvCache();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: input, body });
    if (url.hostname === "api.telegram.org") return Response.json(editFails && url.pathname.endsWith("editMessageText") ? { ok: false, error_code: 400, description: "message can't be edited" } : { ok: true, result: { message_id: 10 } });
    if (url.pathname === "/api/v1/stocks") return Response.json({ data: { count: stocks.length, stocks } });
    if (url.pathname.startsWith("/api/v1/portfolio/")) return Response.json({ data: { owner: address(99), totalValueUsd: 120, change24hPct: 2, usdc: null, earnValueUsd: 0, liquidityValueUsd: 0, holdings: [] } });
    if (url.pathname === "/api/basename/reverse") return Response.json({ name: null });
    if (url.pathname === "/api/basename/resolve") return Response.json({ resolved: null });
    if (url.pathname.startsWith("/api/activity/")) return Response.json({ items: [{ type: "buy", symbol: "NVDA", amountUsd: 25, txHash: `0x${"a".repeat(64)}`, timestamp: 1_700_000_000, verified: true }] });
    return Response.json({}, { status: 503 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

function update(text: string, privateChat = true): TgUpdate {
  return { update_id: ++sequence, message: { message_id: 1, chat: { id: privateChat ? user : -100, type: privateChat ? "private" : "supergroup" }, from: { id: user }, date: 1_700_000_000, text } };
}
async function ask(text: string, privateChat = true) {
  const response = await handleUpdate("bstocks", "local-test-token", update(text, privateChat));
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
async function tap(data: string, inline = false) {
  const message = update("").message!;
  const response = await handleUpdate("bstocks", "local-test-token", { update_id: ++sequence, callback_query: { id: String(sequence), from: { id: user }, data, ...(inline ? { inline_message_id: "shared-card" } : { message }) } });
  const raw = await response.text();
  return raw ? JSON.parse(raw) : calls.filter((c) => c.url.endsWith("editMessageText")).at(-1)?.body;
}

describe("private chat flows against the BaseStocks HTTP shapes", () => {
  it("prices a bare ticker without enabling the assistant", async () => {
    const reply = await ask("NVDA");
    expect(reply.text).toContain("NVIDIA");
    expect(reply.reply_markup.inline_keyboard.flat().some((button: { callback_data: string }) => button.callback_data === "wa:NVDA")).toBe(true);
  });
  it("preserves trade buttons on a stock deep link", async () => {
    const reply = await ask("/start stock_NVDA");
    expect(reply.reply_markup.inline_keyboard.flat().some((button: { callback_data: string }) => button.callback_data === "b:NVDA")).toBe(true);
  });
  it("guides wallet entry and cancels the pending step", async () => {
    await ask("/wallet");
    expect(await getPrompt("bstocks", user)).toBe("wallet");
    await ask(address(99));
    expect(await getWallet(user)).toBe(address(99));
    expect(await getPrompt("bstocks", user)).toBeNull();
    await ask("/wallet");
    await tap("cancel");
    expect(await getPrompt("bstocks", user)).toBeNull();
  });
  it("does not substitute a saved wallet for an invalid explicitly requested one", async () => {
    await setWallet(user, address(99));
    const reply = await ask("/portfolio invalid.base.eth");
    expect(reply.text).toContain("could not be resolved");
    expect(calls.some((c) => c.url.includes("/api/v1/portfolio/"))).toBe(false);
  });
  it("keeps watchlist adds idempotent and isolated between users", async () => {
    await ask("/watch NVDA");
    await ask("/watch NVDA");
    expect(await getWatchlist(user)).toEqual([address(1)]);
    expect(await getWatchlist(user + 100_000)).toEqual([]);
    await ask("/unwatch NVDA");
    expect(await getWatchlist(user)).toEqual([]);
  });
  it("retains concurrent additions", async () => {
    await Promise.all([updateWatchlist(user, address(1), true), updateWatchlist(user, address(2), true)]);
    expect(await getWatchlist(user)).toEqual([address(1), address(2)]);
  });
  it("reads public activity and builds a verified explorer URL", async () => {
    await setWallet(user, address(99));
    const reply = await ask("/activity");
    expect(reply.text).toContain("Confirmed");
    expect(reply.text).toContain(`https://basescan.org/tx/0x${"a".repeat(64)}`);
  });
  it("completes ticker → amount → cadence and hands over exact plan fields", async () => {
    expect((await ask("/dca")).text).toContain("1/3");
    expect((await tap("d:NVDA")).text).toContain("2/3");
    expect((await tap("d:NVDA:25")).text).toContain("3/3");
    const card = await tap("d:NVDA:25:7");
    const handoff = new URL(card.reply_markup.inline_keyboard[0][0].web_app.url);
    const target = new URL(destination("bstocks", handoff.searchParams.get("to")!)!);
    expect(target.pathname).toBe("/automate");
    expect(target.searchParams.get("usd")).toBe("25");
    expect(target.searchParams.get("cadence")).toBe("7");
    expect(target.searchParams.get("legs")).toBe(`${address(1)}:10000`);
  });
  it("refuses partial and duplicate resolved plans", async () => {
    expect((await ask("/dca 25 NVDA,UNKNOWN weekly")).text).toContain("No plan link");
    expect((await ask("/dca 25 NVDA,NVDAc weekly")).text).toContain("same stock");
    expect((await ask("/dca 3 NVDA,TSLA,AAPL weekly")).text).toContain("at least $1 per stock");
  });
  it("keeps a typed wallet when moving between portfolio and activity", async () => {
    await setWallet(user, address(99));
    const reply = await ask(`/portfolio ${address(88)}`);
    const buttons = reply.reply_markup.inline_keyboard.flat();
    const activity = buttons.find((button: { callback_data?: string }) => button.callback_data?.startsWith("ac:"));
    await tap(activity.callback_data);
    expect(calls.at(-2)?.url).toContain(`/api/activity/${address(88)}`);
    expect(await getWallet(user)).toBe(address(99));
  });
});

describe("Telegram delivery and privacy", () => {
  it.each(["wallet", "portfolio", "activity", "watchlist", "settings", "forget", "clearwatchlist"])("refuses /%s in groups before reading personal data", async (command) => {
    const reply = await ask(`/${command}`, false);
    expect(reply.text).toContain("private chat");
    expect(calls).toHaveLength(0);
  });
  it("ignores commands addressed to another bot", async () => {
    expect(await ask("/markets@SomeOtherBot", false)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("supports inline-message callbacks without assuming a private chat", async () => {
    const reply = await tap("p:NVDA", true);
    expect(reply.inline_message_id).toBe("shared-card");
    expect(reply.chat_id).toBeUndefined();
    expect(reply.text).toContain(ELIGIBILITY_NOTE);
    expect(reply.reply_markup.inline_keyboard.flat().some((button: { web_app?: unknown; callback_data?: string }) => button.web_app || button.callback_data?.startsWith("wa:"))).toBe(false);
  });
  it("never edits a shared inline card into someone's saved holdings", async () => {
    await tap("pf", true);
    expect(calls.some((c) => c.url.endsWith("editMessageText"))).toBe(false);
    expect(calls.at(-1)?.body.text).toContain("private chat");
  });
  it("sends a new card if Telegram refuses to edit the old one", async () => {
    editFails = true;
    const reply = await tap("p:NVDA");
    expect(reply.method).toBe("sendMessage");
    expect(reply.text).toContain("NVIDIA");
  });
  it("filters a gift claim key before saving a prompted wallet", async () => {
    await ask("/wallet");
    const reply = await ask("https://basestocks.finance/gifts/claim/abc#k=SECRETKEY");
    expect(reply.text).not.toContain("SECRETKEY");
    expect(await getWallet(user)).toBeNull();
  });
  it("never relays a claim key from inline search to the launchpad", async () => {
    await handleUpdate("launchpad", "local-test-token", { update_id: ++sequence, inline_query: { id: "q", from: { id: user }, offset: "", query: "https://basestocks.finance/gifts/claim/abc#k=SECRETKEY" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("api.telegram.org");
    expect(calls[0]?.body.results).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("SECRETKEY");
  });
});

describe("bounded navigation", () => {
  it.each(["25 NVDA,NVDA weekly", "0.50 NVDA weekly", "25 NVDA, weekly", "25 NVDA<script> weekly", "1e3 NVDA weekly", `25 ${Array.from({ length: 13 }, (_, i) => `S${i}`).join(",")} weekly`])("rejects malformed or silently lossy plan %s", (value) => expect(parseDca(value)).toBeNull());
  it("keeps large market universes inside one Telegram message per page", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...stocks[0]!, symbol: `S${i}`, address: address(i + 1) }));
    const card = marketsCard(many, 999, "name");
    expect(card.text.length).toBeLessThan(4096);
    expect(card.text).toContain("Page 12/12");
    for (const button of card.keyboard!.flat()) if (button.callback_data) {
      expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
      expect(decode(button.callback_data)).not.toBeNull();
    }
  });
  it("bounds callback nesting and plan inputs", () => {
    expect(decode("c:".repeat(3000) + "b:NVDA")).toBeNull();
    expect(decode("d:NVDA:999999:7")).toBeNull();
    expect(decode("d:NVDA:7")).toBeNull();
    expect(decode(encode({ kind: "plan", symbol: "NVDA", amount: 25, days: 7 }))).toEqual({ kind: "plan", symbol: "NVDA", amount: 25, days: 7 });
  });
});
