import { b, code, esc, link } from "@/lib/telegram/html";
import type { InlineKeyboardButton, ReplyKeyboard, SendMessageParams } from "@/lib/telegram/api";
import { ago, compactUsd, move, pad, padStart, pct, shortAddress, usd } from "@/lib/format";
import { stockLink, launchpadTokenLink, launchpadMarketsLink } from "@/lib/links";
import type { Portfolio, V1Stock } from "@/services/bstocks";
import { isTradable } from "@/services/bstocks";
import { BASE_FEE_BPS, feeBpsAt, secondsUntilFairFee, type Market } from "@/services/launchpad";
import { encode, launchpadListButtons, marketButtons, signButton, stockButtons } from "./nav";

/** A rendered reply: the text plus whatever buttons and preview belong with it. */
export interface Card {
  text: string;
  keyboard?: InlineKeyboardButton[][];
  preview?: SendMessageParams["link_preview_options"];
  /**
   * Sent only where it is worth replacing the phone keyboard: the first message of a private chat.
   * Attaching it to every reply would re-send the same rows forever for no benefit.
   */
  replyKeyboard?: ReplyKeyboard;
  /** A callback reply edits the message that was tapped instead of adding one below it. */
  editable?: boolean;
}

/**
 * The multiplier as a plain number.
 *
 * One token is not one share, and the ratio moves on splits and dividends. The API returns the
 * value and its precision as decimal strings so no caller has to guess a scale; dividing here is
 * the one place that conversion happens.
 */
export function multiplierX(stock: V1Stock): number | null {
  try {
    const value = BigInt(stock.multiplier);
    const precision = BigInt(stock.multiplierPrecision);
    if (precision === 0n) return null;
    return Number((value * 10_000n) / precision) / 10_000;
  } catch {
    return null;
  }
}

function referenceLine(stock: V1Stock): string {
  const ref = stock.reference;
  if (!ref || ref.totalReturnUsd === null) return "—";
  const state = ref.isPaused ? "frozen, corporate action" : ref.isStale ? "holding" : "live";
  return `${usd(ref.totalReturnUsd)} (${state})`;
}

/**
 * One stock, as a chat card.
 *
 * The link preview does the picture: Telegram fetches the stock page's own share card, which the
 * app already renders, so there is no image to build or host here and the caption keeps the full
 * 4096 characters that a photo message would cut to 1024.
 */
export function stockCard(stock: V1Stock): Card {
  const href = stockLink(stock.address);
  const rows: [string, string][] = [
    ["Reference", referenceLine(stock)],
    ["Liquidity", compactUsd(stock.liquidityUsd)],
    ["24h volume", compactUsd(stock.volume24hUsd)],
    ["Status", stock.status.label],
  ];
  const x = multiplierX(stock);

  const lines = [
    `${b(`${stock.symbol} · ${stock.name}`)}`,
    `${b(usd(stock.dexPriceUsd ?? stock.displayUsd))}  ${esc(move(stock.dexChange24hPct))}`,
    "",
    `<pre>${rows.map(([k, v]) => `${esc(pad(k, 11))}${esc(v)}`).join("\n")}</pre>`,
  ];

  if (x !== null && Math.abs(x - 1) > 0.0001) {
    lines.push(`One token is ${b(`${x.toFixed(4)} shares`)} after splits and dividends.`);
  }
  if (stock.reference?.isStale) {
    lines.push(i0("The reference feed publishes on trading days and holds its last value otherwise."));
  }
  if (!isTradable(stock)) {
    lines.push(i0(stock.status.detail));
  }
  if (stock.dexUpdatedAt) lines.push(i0(`DEX updated ${ago(stock.dexUpdatedAt)}.`));
  if (stock.reference?.updatedAt) lines.push(i0(`Reference updated ${ago(stock.reference.updatedAt)}.`));

  return {
    text: lines.join("\n"),
    keyboard: stockButtons(stock.symbol, stock.address, isTradable(stock)),
    preview: { url: href, prefer_small_media: true },
    editable: true,
  };
}

function i0(text: string): string {
  return `<i>${esc(text)}</i>`;
}

/** Every listed stock, biggest mover first, in a monospace block so the columns line up. */
export function marketsCard(stocks: V1Stock[], page = 0, sort: "move" | "volume" | "name" = "move"): Card {
  const sorted = [...stocks].sort((x, y) => sort === "name" ? x.symbol.localeCompare(y.symbol) : sort === "volume" ? (y.volume24hUsd ?? -Infinity) - (x.volume24hUsd ?? -Infinity) : (y.dexChange24hPct ?? -Infinity) - (x.dexChange24hPct ?? -Infinity));
  const pages = Math.max(1, Math.ceil(sorted.length / 9));
  const current = Math.max(0, Math.min(pages - 1, page));
  const visible = sorted.slice(current * 9, current * 9 + 9);
  const body = visible
    .map((s) => {
      const price = padStart(usd(s.dexPriceUsd ?? s.displayUsd), 10);
      const change = padStart(s.dexChange24hPct === null ? "—" : pct(s.dexChange24hPct, 1), 8);
      const liq = padStart(compactUsd(s.liquidityUsd), 8);
      const flag = isTradable(s) ? "" : `  ${s.status.code}`;
      return `${pad(s.symbol, 6)}${price}${change}${liq}${flag}`;
    })
    .join("\n");

  return {
    text: [
      b("Listed stocks"),
      esc(`${stocks.length} stocks · ${sort === "move" ? "24h move" : sort === "volume" ? "24h volume" : "A–Z"} · Page ${current + 1}/${pages}`),
      `<pre>${esc(`${pad("", 6)}${padStart("price", 10)}${padStart("24h", 8)}${padStart("liq", 8)}`)}\n${esc(body)}</pre>`,
      i0("Liquidity is beside each row because a thin pool moves on a small order."),
    ].join("\n"),
    // Tapping a ticker is the whole reason this table is worth sending: reading a row and pricing
    // it should not be two different acts of remembering.
    keyboard: [
      ...marketButtons(visible.map((s) => s.symbol)),
      [
        ...((current > 0) ? [{ text: "‹ Previous", callback_data: encode({ kind: "markets", page: current - 1, sort }) }] : []),
        { text: "↻ Refresh", callback_data: encode({ kind: "markets", page: current, sort }) },
        ...((current + 1 < pages) ? [{ text: "Next ›", callback_data: encode({ kind: "markets", page: current + 1, sort }) }] : []),
      ],
      (["move", "volume", "name"] as const).map((order) => ({ text: `${order === sort ? "✓ " : ""}${order === "move" ? "24h move" : order === "volume" ? "Volume" : "A–Z"}`, callback_data: encode({ kind: "markets", sort: order, page: 0 }) })),
    ],
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * Launchpad
 * ------------------------------------------------------------------ */

/**
 * The anti-snipe line.
 *
 * A pool is live from its first block, so "tradable" is never the question. The question is what a
 * trade costs right now, and for the first twenty seconds the answer is most of the order. This
 * line is the reason the launchpad bot exists, so it goes above the price, not below it.
 */
export function feeLine(market: Market, now = Date.now()): string | null {
  const left = secondsUntilFairFee(market.launchedAt, now);
  if (left <= 0) return null;
  const bps = feeBpsAt(market.launchedAt, now);
  return `⏳ ${b(`${(bps / 100).toFixed(0)}% fee right now`)} · settles at 1% in ${left}s. Buying before then pays the difference.`;
}

/**
 * One launchpad token.
 *
 * Every string here except the address was chosen by whoever paid the launch fee, so all of it is
 * escaped and none of the creator's own links (`website`, `twitter`, `telegram`) is rendered as a
 * clickable link. The only anchors are the ones this file builds.
 */
export function tokenCard(
  market: Market,
  now = Date.now(),
  side?: "buy" | "sell",
  isPrivate = false,
): Card {
  const href = launchpadTokenLink(market.token);
  const fee = feeLine(market, now);

  const rows: [string, string][] = [
    ["Price", usd(market.priceUsd)],
    ["24h", market.change24hPercent === null ? "—" : move(market.change24hPercent)],
    ["FDV", compactUsd(market.fdvUsd)],
    ["24h vol", compactUsd(market.volume24hUsd)],
    ["Holders", String(market.holders)],
    ["Trades", String(market.trades)],
    ["Paired", market.stock.ticker],
    ["Launched", ago(market.launchedAt)],
  ];

  const lines = [
    b(`${market.name} (${market.symbol})`),
    ...(fee ? ["", fee] : []),
    "",
    `<pre>${rows.map(([k, v]) => `${esc(pad(k, 10))}${esc(v)}`).join("\n")}</pre>`,
    `${esc("Contract")} ${code(market.token)}`,
    `${esc("Creator")} ${code(shortAddress(market.creator))}`,
  ];

  if (market.description) {
    lines.push("", i0(market.description.slice(0, 240)));
  }
  lines.push(
    "",
    i0(`Buying needs ${market.stock.ticker} in your wallet: these pools quote in the stock, not in USDC or ETH.`),
  );

  return {
    text: lines.join("\n"),
    editable: true,
    keyboard: [
      [
        signButton(
          fee
            ? `Open (wait ${secondsUntilFairFee(market.launchedAt, now)}s)`
            : side
              ? `${side === "buy" ? "Buy" : "Sell"} ${market.symbol}`
              : `Trade ${market.symbol}`,
          "launchpad",
          `/token/${market.token}`,
          `Trade ${market.symbol}`,
          isPrivate,
        ),
        { text: "Share", switch_inline_query_chosen_chat: { query: market.symbol, allow_user_chats: true, allow_group_chats: true } },
      ],
      [{ text: `More paired with ${market.stock.ticker}`, url: launchpadMarketsLink(market.stock.address) }],
      [{ text: "↻ Refresh fee & price", callback_data: encode({ kind: "token", address: market.token }) }, { text: "← Top tokens", callback_data: "lt" }],
    ],
    preview: { url: href, prefer_small_media: true },
  };
}

/** A ranked list. `title` says what the ranking means, because volume alone does not. */
export function marketListCard(title: string, note: string, markets: Market[], now = Date.now()): Card {
  if (markets.length === 0) {
    return { text: [b(title), "", esc("Nothing to show yet.")].join("\n"), preview: { is_disabled: true } };
  }
  const body = markets
    .map((m, index) => {
      const rank = padStart(`${index + 1}.`, 3);
      const symbol = pad(m.symbol.slice(0, 10), 11);
      const price = padStart(usd(m.priceUsd), 11);
      const change = padStart(m.change24hPercent === null ? "—" : pct(m.change24hPercent, 1), 8);
      const hot = feeBpsAt(m.launchedAt, now) > BASE_FEE_BPS ? " ⏳" : "";
      return `${rank} ${symbol}${price}${change}${hot}`;
    })
    .join("\n");

  const anyHot = markets.some((m) => feeBpsAt(m.launchedAt, now) > BASE_FEE_BPS);

  return {
    text: [
      b(title),
      `<pre>${esc(body)}</pre>`,
      ...(anyHot ? [i0("⏳ marks a token still inside its twenty second anti snipe window.")] : []),
      i0(note),
      "",
      link("All markets", launchpadMarketsLink()),
    ].join("\n"),
    keyboard: launchpadListButtons(markets.map((m) => ({ symbol: m.symbol, token: m.token }))),
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * A wallet's own position
 * ------------------------------------------------------------------ */

/**
 * Somebody's holdings, as a chat card.
 *
 * Ordered by value rather than by ticker, because the first three rows are the answer to "how am I
 * doing" and the rest is detail. USDC, Earn and liquidity are shown separately from the stocks so
 * the total is not a number nobody can reconstruct.
 */
export function portfolioCard(
  portfolio: Portfolio,
  label: string,
  buttons: InlineKeyboardButton[][],
): Card {
  const holdings = [...portfolio.holdings].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 24);

  const lines = [
    b(label),
    `${b(usd(portfolio.totalValueUsd))}  ${esc(move(portfolio.change24hPct))}`,
  ];

  if (holdings.length > 0) {
    const rows = holdings
      .map((h) => {
        const shares = Number(h.shares) / 10 ** h.decimals;
        return `${pad(h.symbol, 7)}${padStart(shares.toFixed(4), 11)}${padStart(usd(h.valueUsd), 10)}${padStart(h.change24hPct === null ? "—" : pct(h.change24hPct, 1), 8)}`;
      })
      .join("\n");
    lines.push(
      "",
      `<pre>${esc(`${pad("", 7)}${padStart("shares", 11)}${padStart("value", 10)}${padStart("24h", 8)}`)}\n${esc(rows)}</pre>`,
    );
  } else {
    lines.push("", esc("No tokenized stocks in this wallet yet."));
  }

  const side: [string, number][] = [
    ["USDC", portfolio.usdc?.valueUsd ?? 0],
    ["Earn", portfolio.earnValueUsd],
    ["Liquidity", portfolio.liquidityValueUsd],
  ];
  const shown = side.filter(([, value]) => value > 0.005);
  if (shown.length > 0) {
    lines.push(`<pre>${shown.map(([k, v]) => `${esc(pad(k, 11))}${esc(usd(v))}`).join("\n")}</pre>`);
  }

  // Shares, not tokens: one token is not one share once a split or a dividend has moved the
  // multiplier, and the API returns the scaled figure so nothing here has to guess.
  lines.push(i0("Share-equivalents, already scaled by each stock's multiplier."));
  if (portfolio.holdings.length > holdings.length) lines.push(i0(`Showing ${holdings.length} of ${portfolio.holdings.length} holdings. Open the app to see all of them.`));

  return { text: lines.join("\n"), keyboard: buttons, preview: { is_disabled: true }, editable: true };
}
