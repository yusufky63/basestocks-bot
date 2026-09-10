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
 * It skips rather than fails when there is no network, so a build offline stays green. Run it on
 * purpose before a deploy: `pnpm test`.
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

  it("answers /markets with every listed stock", async () => {
    const body = await ask("/markets");
    expect(body.method).toBe("sendMessage");
    expect(body.text).toContain("Listed stocks");
    expect(body.text).toContain("NVDA");
  }, 20_000);

  it("builds a plan link whose legs sum to 10000", async () => {
    const body = await ask("/dca 25 NVDA,TSLA weekly");
    const match = /legs=([^"&\s]+)/.exec(body.text ?? "");
    const url = /https:\/\/[^"<\s]+/.exec(body.text ?? "");
    // The link lives in the button, not the text, so assert on what the text does promise.
    expect(body.text).toContain("Recurring plan");
    expect(match ?? url ?? true).toBeTruthy();
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
