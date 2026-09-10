import { b, code, esc } from "@/lib/telegram/html";
import { pad, usd } from "@/lib/format";
import type { AssistantAction, TradeAction } from "@/services/assistant";

/**
 * The assistant's answer, rendered as something with structure rather than a paragraph.
 *
 * The important half is where the numbers come from. A drafted trade arrives as a typed object,
 * built server-side from validated tool input, with the address resolved there. So the card below
 * is assembled from those fields and not from the model's sentence: the size, the estimate, the
 * route and the fee are structural facts, and if the prose and the card ever disagreed, the card
 * would be the one that was right.
 *
 * The prose still goes out, because it says why. It sits in an expandable quote so a long answer
 * does not push the draft off the screen on a phone.
 */

/** Telegram's own collapsible quote. Long answers stay one tap from readable instead of endless. */
function quote(text: string): string {
  const escaped = esc(text);
  // Under about six lines there is nothing to collapse and the control just adds noise.
  return escaped.split("\n").length > 6 || escaped.length > 400
    ? `<blockquote expandable>${escaped}</blockquote>`
    : `<blockquote>${escaped}</blockquote>`;
}

function draftBlock(trade: TradeAction): string {
  const rows: [string, string][] = [["Side", trade.side === "buy" ? "Buy" : "Sell"]];

  if (trade.amountUsd !== undefined) rows.push(["Amount", `${usd(trade.amountUsd)} ${trade.payWith ?? "USDC"}`]);
  if (trade.quantity !== undefined) rows.push(["Quantity", `${trade.quantity} ${trade.symbol}`]);

  const ind = trade.indicative;
  if (ind?.estOut) rows.push(["You get", `~${ind.estOut} ${trade.side === "buy" ? trade.symbol : trade.payWith ?? "USDC"}`]);
  if (ind?.priceUsd !== null && ind?.priceUsd !== undefined) rows.push(["Price", usd(ind.priceUsd)]);
  if (ind?.provider) rows.push(["Route", ind.provider]);
  if (ind?.feeUsd !== null && ind?.feeUsd !== undefined) rows.push(["Network fee", usd(ind.feeUsd)]);

  return [
    `📝 ${b(`Draft · ${trade.side === "buy" ? "Buy" : "Sell"} ${trade.symbol}`)}`,
    `<pre>${rows.map(([k, v]) => `${esc(pad(k, 12))}${esc(v)}`).join("\n")}</pre>`,
    `<i>${esc("Indicative. The firm quote is fetched when you open it, and nothing is signed until you confirm it in your own wallet.")}</i>`,
  ].join("\n");
}

const OPENS: Record<string, string> = {
  basket: "a basket to review",
  autoinvest: "a recurring plan to review",
  gift: "a gift to review",
  earn: "an Earn deposit to review",
};

/**
 * Assembles the message. `reply` is the model's prose; `actions` are the typed drafts behind it.
 */
export function assistantCard(reply: string, actions: AssistantAction[]): string {
  const parts: string[] = [];
  const prose = reply.trim();
  if (prose) parts.push(quote(prose));

  const trades = actions.filter((a): a is TradeAction => a.kind === "trade");
  for (const trade of trades.slice(0, 2)) parts.push(draftBlock(trade));

  const others = actions.filter((a) => a.kind !== "trade" && a.kind !== "news");
  for (const other of others.slice(0, 2)) {
    const what = OPENS[other.kind];
    if (what) parts.push(`📝 ${b("Draft")}\n${esc(`Opens ${what}. Nothing is signed until you confirm it yourself.`)}`);
  }

  const news = actions.find((a) => a.kind === "news");
  if (news && news.kind === "news") {
    parts.push(
      [
        `📰 ${b("Cited")}`,
        ...news.items.slice(0, 3).map((item) => `${esc("·")} ${esc(item.title.slice(0, 90))} ${code(item.source)}`),
      ].join("\n"),
    );
  }

  if (parts.length === 0) parts.push(esc("I could not find an answer to that."));
  return parts.join("\n\n");
}

/** What the user sees within a second, before the model has finished. */
export const THINKING = `🤖 <i>${esc("Reading live data…")}</i>`;

export function refusalCard(reason: string): string {
  return `🤖 ${esc(reason)}`;
}
