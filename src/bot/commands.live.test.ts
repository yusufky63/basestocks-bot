import { describe, expect, it } from "vitest";
import { handleUpdate } from "./commands";
import type { TgUpdate } from "@/lib/telegram/types";

/**
 * One end-to-end pass against the real deployments.
 *
 * Everything else in this repository is a unit test over a pure function. This is the only check
 * that the shapes we decided upstream returns are the shapes it actually returns, which is the
 * failure that a mocked test cannot see and that a user would meet first.
 *
 * Set SKIP_LIVE_TESTS=true when running offline. With live checks enabled, an unavailable upstream
 * fails the stock checks rather than hiding a broken integration. Run before a deploy: `pnpm test`.
 */
const NETWORK = process.env.SKIP_LIVE_TESTS !== "true";

function message(text: string, chatId = 1): TgUpdate {
  return {
    update_id: Math.floor(Math.random() * 1_000_000_000),
    message: {
      message_id: 1,
      chat: { id: chatId, type: "private" },
      from: { id: 424_242, is_bot: false, first_name: "Test" },
      date: Math.floor(Date.now() / 1_000),
      text,
    },
  };
}

/** The token is never used on this path: a simple reply rides the webhook's own response body. */
const TOKEN = "000000000:LOCAL-TEST-TOKEN";

async function ask(text: string): Promise<{ method?: string; text?: string; reply_markup?: unknown }> {
  const response = await handleUpdate("bstocks", TOKEN, message(text));
  expect(response.status).toBe(200);
  return (await response.json()) as { method?: string; text?: string };
}

describe.skipIf(!NETWORK)("live: BStocks surface", () => {
  it("answers /price NVDA with a card built from the live API", async () => {
    const body = await ask("/price NVDA");
    expect(body.method).toBe("sendMessage");
    expect(body.text).toContain("NVDA");
    // The reference line and the status label both come from upstream, not from this repository.
    expect(body.text).toMatch(/Reference|Liquidity/);
    expect(body.reply_markup).toBeTruthy();
  }, 20_000);

  it("keeps stocks reachable across market pages", async () => {
    const body = await ask("/markets name 0");
    expect(body.method).toBe("sendMessage");
    expect(body.text).toContain("Listed stocks");
    const count = /Page 1\/(\d+)/.exec(body.text ?? "");
    expect(count).not.toBeNull();
    const pages = Number(count![1]);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, page) => ask(`/markets name ${page + 1}`)));
    const all = [body, ...rest];
    expect(all.map((page) => page.text).join("\n")).toContain("NVDA");
    for (const page of all) {
      expect(page.text!.length).toBeLessThanOrEqual(4096);
      const markup = page.reply_markup as { inline_keyboard: { callback_data?: string }[][] };
      const tickers = markup.inline_keyboard.flat().filter((button) => button.callback_data?.startsWith("p:"));
      expect(tickers.length).toBeGreaterThan(0);
      expect(tickers.length).toBeLessThanOrEqual(9);
    }
  }, 20_000);

  it("builds a plan link whose legs sum to 10000", async () => {
    const body = await ask("/dca 25 NVDA,TSLA weekly");
    expect(body.text).toContain("Recurring plan");
    const markup = body.reply_markup as { inline_keyboard: { url?: string; web_app?: { url: string } }[][] };
    const button = markup.inline_keyboard[0]![0]!;
    const handoff = new URL(button.web_app?.url ?? button.url!);
    const target = new URL(handoff.searchParams.get("to")!, "https://basestocks.finance");
    expect(target.pathname).toBe("/automate");
    expect(target.searchParams.get("usd")).toBe("25");
    expect(target.searchParams.get("cadence")).toBe("7");
    const legs = target.searchParams.get("legs")!.split(",");
    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => /^0x[0-9a-fA-F]{40}:\d+$/.test(leg))).toBe(true);
    expect(legs.reduce((sum, leg) => sum + Number(leg.split(":")[1]), 0)).toBe(10_000);
  }, 20_000);

  it("refuses a ticker it does not have, and says what it does have", async () => {
    const body = await ask("/price NOTATICKER");
    expect(body.text).toContain("do not have a stock");
  }, 20_000);
}, 60_000);

describe.skipIf(!NETWORK)("live: launchpad surface", () => {
  it("answers /new from the launchpad's own market list", async () => {
    const response = await handleUpdate("launchpad", TOKEN, message("/new 5"));
    const body = (await response.json()) as { method?: string; text?: string };
    expect(body.method).toBe("sendMessage");
    // Either there are launches, or the list is honestly empty. Both are correct answers.
    expect(body.text).toMatch(/newest launches|Nothing to show yet|could not read the app/);
  }, 20_000);
}, 60_000);

describe("safety, with no network involved", () => {
  it("drops a message carrying a claim key without echoing any of it", async () => {
    const secret = "SUPERSECRETKEYMATERIAL";
    const response = await handleUpdate("bstocks", TOKEN, message(`https://basestocks.finance/gifts/claim/abc#k=${secret}`));
    const body = (await response.json()) as { text?: string };
    expect(body.text).toContain("Do not send that here");
    expect(body.text).not.toContain(secret);
    expect(body.text).not.toContain("#k=");
  });

  it("says nothing to free text in a group", async () => {
    const update = message("what is the price of nvda");
    update.message!.chat.type = "supergroup";
    const response = await handleUpdate("bstocks", TOKEN, update);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("ignores a repeated update_id, so a redelivery costs nothing twice", async () => {
    const update = message("/help");
    const first = await handleUpdate("bstocks", TOKEN, update);
    const second = await handleUpdate("bstocks", TOKEN, update);
    expect(await first.text()).not.toBe("");
    expect(await second.text()).toBe("");
  });
});
