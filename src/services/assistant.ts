import { env } from "@/config/env";

/**
 * Free text, answered by the BStocks assistant over its own chat endpoint.
 *
 * The assistant is a pure function on the other side (a system prompt, a history, a tool list and a
 * context; it knows nothing about HTTP), so a second transport costs nothing there. What it costs
 * is here: that endpoint meters by request IP, and behind a webhook every Telegram user on earth
 * arrives from Telegram's datacenter. So this module keeps its own per-user cap on top, and the
 * shared upstream bucket stays the reason `ASSISTANT_ENABLED` is a deliberate switch.
 *
 * The important half is `actions`. The assistant does not answer a question about buying by
 * describing a form; it returns a typed draft, built server-side from validated tool input, with
 * the address resolved there rather than written by the model. That is what lets this bot turn
 * "buy fifty dollars of NVDA" into a button without ever parsing an address out of model output.
 */

/** Only the action kinds this bot knows how to turn into a button. Others are ignored, not guessed. */
export interface TradeAction {
  kind: "trade";
  side: "buy" | "sell";
  symbol: string;
  name: string;
  assetAddress: string;
  amountUsd?: number;
  quantity?: number;
  payWith?: "USDC" | "ETH";
  /**
   * What the app already priced when it built the draft: the estimated output, the route that won,
   * and the network fee. Carrying it through is what lets the bot show a figure it did not have to
   * read out of a sentence.
   */
  indicative?: {
    priceUsd?: number | null;
    estOut?: string;
    provider?: string;
    feeUsd?: number | null;
  };
}

export interface NewsAction {
  kind: "news";
  scope: string;
  symbol?: string;
  items: Array<{ title: string; url: string; source: string }>;
}

export interface OtherAction {
  kind: "basket" | "autoinvest" | "gift" | "earn";
}

export type AssistantAction = TradeAction | NewsAction | OtherAction;

export interface AssistantAnswer {
  reply: string;
  actions: AssistantAction[];
  /** Set when the endpoint refused rather than answered, so the caller can say so plainly. */
  refusal?: string;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askAssistant(history: AssistantTurn[]): Promise<AssistantAnswer> {
  const url = new URL("/api/assistant/chat", env().BSTOCKS_URL).toString();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-8) }),
      // The turn is bounded at forty seconds on the other side, with four tool rounds inside it.
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    });
    const body = (await res.json()) as {
      ok?: boolean;
      reply?: string;
      actions?: AssistantAction[];
      errors?: string[];
    };
    if (body.ok && body.reply) {
      return { reply: body.reply, actions: sane(body.actions) };
    }
    return { reply: "", actions: [], refusal: body.errors?.[0] ?? "I could not answer that right now." };
  } catch {
    return { reply: "", actions: [], refusal: "I could not reach the app to answer that. Try again in a moment." };
  }
}

/**
 * Drops anything shaped wrong before it reaches a renderer.
 *
 * The endpoint builds these server-side and they should always be well formed, but this bot renders
 * them as buttons a person will tap, so "should" is not the standard. An address that is not an
 * address, or a link that is not http, does not become a button.
 */
function sane(actions: AssistantAction[] | undefined): AssistantAction[] {
  if (!Array.isArray(actions)) return [];
  const out: AssistantAction[] = [];
  for (const action of actions.slice(0, 4)) {
    if (!action || typeof action !== "object") continue;
    if (action.kind === "trade") {
      const trade = action as TradeAction;
      if (!/^0x[0-9a-fA-F]{40}$/.test(trade.assetAddress ?? "")) continue;
      if (trade.side !== "buy" && trade.side !== "sell") continue;
      out.push(trade);
      continue;
    }
    if (action.kind === "news") {
      const news = action as NewsAction;
      const items = (news.items ?? []).filter((i) => typeof i?.url === "string" && /^https?:\/\//i.test(i.url));
      if (items.length > 0) out.push({ ...news, items: items.slice(0, 5) });
      continue;
    }
    if (["basket", "autoinvest", "gift", "earn"].includes(action.kind)) out.push(action);
  }
  return out;
}
