import type { Surface } from "@/config/surfaces";
import type { InlineKeyboardButton, ReplyKeyboard } from "@/lib/telegram/api";
import { bstocksUrl, launchpadUrl, stockLink } from "@/lib/links";
import { handoffUrl, type App } from "@/lib/handoff";
import type { AssistantAction } from "@/services/assistant";
import { UI } from "./copy";

/**
 * Navigation without typing.
 *
 * A bot that only answers slash commands is a command line with a worse font: people try it once,
 * cannot remember `/dca 25 NVDA weekly` a week later, and stop. Two things fix that, and neither
 * needs a Mini App.
 *
 * The persistent keyboard replaces the phone keyboard with a row of buttons, so the common paths
 * are one thumb away and nothing has to be remembered. Inline buttons under each card carry the
 * next step, so reading a price and buying it are one tap apart rather than one recalled command
 * apart.
 */

/* ------------------------------------------------------------------ *
 * Callback data
 * ------------------------------------------------------------------ */

/**
 * Telegram allows 64 bytes of `callback_data`, and a token address alone is 42 of them. So the
 * encoding is a one or two letter verb, a colon, and one argument, and it is parsed strictly:
 * this is attacker-supplied text like anything else that arrives from a chat.
 */
export type Action =
  | { kind: "markets"; page?: number; sort?: "move" | "volume" | "name" }
  | { kind: "news"; symbol?: string }
  | { kind: "earn" | "baskets" | "gift" | "status" | "wallet" | "watchlist" | "settings" | "cancel" | "search" | "dca" }
  | { kind: "activity"; address?: string }
  | { kind: "watch" | "unwatch"; symbol: string }
  | { kind: "plan"; symbol: string; amount?: number; days?: number }
  | { kind: "help" }
  | { kind: "stats" }
  | { kind: "menu" }
  | { kind: "portfolio"; address?: string }
  | { kind: "pools" }
  | { kind: "ask" }
  | { kind: "price"; symbol: string }
  | { kind: "buy"; symbol: string }
  | { kind: "sell"; symbol: string }
  | { kind: "top" }
  | { kind: "new" }
  | { kind: "token"; address: string }
  /** "I confirm" in front of an action, carrying that action so it can continue afterwards. */
  | { kind: "confirm"; next: Action };

const SYMBOL = /^[A-Za-z0-9.\-]{1,12}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function encode(action: Action): string {
  switch (action.kind) {
    case "markets":
      return action.page !== undefined || action.sort !== undefined ? `m:${action.sort ?? "move"}:${action.page ?? 0}` : "m";
    case "news": return action.symbol ? `nw:${action.symbol}` : "news";
    case "earn": case "baskets": case "gift": case "status": case "wallet": case "watchlist":
    case "settings": case "cancel": case "search": case "dca": return action.kind;
    case "activity": return action.address ? `ac:${action.address}` : "activity";
    case "watch": return `wa:${action.symbol}`;
    case "unwatch": return `wr:${action.symbol}`;
    case "plan": return `d:${action.symbol}${action.amount !== undefined ? `:${action.amount}` : ""}${action.days !== undefined ? `:${action.days}` : ""}`;
    case "help":
      return "h";
    case "stats":
      return "st";
    case "menu":
      return "n";
    case "portfolio":
      return action.address ? `pf:${action.address}` : "pf";
    case "pools":
      return "pl";
    case "ask":
      return "aq";
    case "top":
      return "lt";
    case "new":
      return "ln";
    case "price":
      return `p:${action.symbol}`;
    case "buy":
      return `b:${action.symbol}`;
    case "sell":
      return `s:${action.symbol}`;
    case "token":
      return `t:${action.address}`;
    case "confirm":
      return `c:${encode(action.next)}`;
  }
}

export function decode(data: string | undefined): Action | null {
  if (!data || data.length > 64) return null;
  if (/^c:c:/.test(data)) return null;
  if (data === "news") return { kind: "news" };
  const simple = ["earn", "baskets", "gift", "status", "wallet", "watchlist", "activity", "settings", "cancel", "search", "dca"] as const;
  for (const kind of simple) if (data === kind) return { kind };
  const market = /^m:(move|volume|name):(\d{1,3})$/.exec(data);
  if (market) return { kind: "markets", sort: market[1] as "move" | "volume" | "name", page: Number(market[2]) };
  const plan = /^d:([A-Za-z0-9.\-]{1,12})(?::(10|25|50|100))?(?::(1|7|14|30))?$/.exec(data);
  if (plan?.[3] && !plan[2]) return null;
  if (plan) return { kind: "plan", symbol: plan[1]!, ...(plan[2] ? { amount: Number(plan[2]) } : {}), ...(plan[3] ? { days: Number(plan[3]) } : {}) };
  if (data === "m") return { kind: "markets" };
  if (data === "h") return { kind: "help" };
  if (data === "st") return { kind: "stats" };
  if (data === "n") return { kind: "menu" };
  if (data === "pf") return { kind: "portfolio" };
  if (data === "pl") return { kind: "pools" };
  if (data === "aq") return { kind: "ask" };
  if (data === "lt") return { kind: "top" };
  if (data === "ln") return { kind: "new" };

  // Not `split(":", 2)`: that truncates rather than keeping the tail, which would turn `c:b:NVDA`
  // into `c` plus `b` and quietly drop the symbol.
  const at = data.indexOf(":");
  if (at <= 0) return null;
  const verb = data.slice(0, at);
  const argument = data.slice(at + 1);
  if (!argument) return null;

  if (verb === "c") {
    const next = decode(argument);
    // Only an action worth gating may sit behind a confirmation, so a crafted `c:` cannot be used
    // to reach anything else.
    if (!next || (next.kind !== "buy" && next.kind !== "sell" && next.kind !== "token")) return null;
    return { kind: "confirm", next };
  }
  if (verb === "t") return ADDRESS.test(argument) ? { kind: "token", address: argument } : null;
  if (verb === "pf" || verb === "ac") return ADDRESS.test(argument) ? { kind: verb === "pf" ? "portfolio" : "activity", address: argument } : null;
  if (!SYMBOL.test(argument)) return null;
  if (verb === "nw") return { kind: "news", symbol: argument };
  if (verb === "wa") return { kind: "watch", symbol: argument };
  if (verb === "wr") return { kind: "unwatch", symbol: argument };
  if (verb === "p") return { kind: "price", symbol: argument };
  if (verb === "b") return { kind: "buy", symbol: argument };
  if (verb === "s") return { kind: "sell", symbol: argument };
  return null;
}

/* ------------------------------------------------------------------ *
 * The persistent keyboard
 * ------------------------------------------------------------------ */

/**
 * Labels are what the person's client actually sends back as message text, so each one has to map
 * to something the router understands. Keeping that map here, next to the labels, is what stops a
 * button from becoming a message the bot stares at blankly.
 */
export const KEYBOARD_ALIASES: Record<string, { command: string; args: string }> = {
  "🏠 Menu": { command: "menu", args: "" },
  "⭐ Watchlist": { command: "watchlist", args: "" },
  "📰 News": { command: "news", args: "" },
  "🔎 Search": { command: "search", args: "" },
  "📈 Markets": { command: "markets", args: "" },
  "📊 Stats": { command: "stats", args: "" },
  "💼 Portfolio": { command: "portfolio", args: "" },
  "🔥 Top": { command: "top", args: "" },
  "🆕 New": { command: "new", args: "" },
  "❓ Help": { command: "help", args: "" },
};

export function replyKeyboard(surface: Surface): ReplyKeyboard {
  const rows =
    surface === "bstocks"
      ? [[{ text: "📈 Markets" }, { text: "⭐ Watchlist" }], [{ text: "💼 Portfolio" }, { text: "📰 News" }], [{ text: "🏠 Menu" }, { text: "❓ Help" }]]
      : [[{ text: "🔥 Top" }, { text: "🆕 New" }], [{ text: "🔎 Search" }, { text: "🏠 Menu" }]];
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder:
      surface === "bstocks" ? "Ask me anything, or tap a button" : "Paste a token address, or tap a button",
  };
}

/* ------------------------------------------------------------------ *
 * Card buttons
 * ------------------------------------------------------------------ */

/**
 * Opens a page without leaving Telegram, where Telegram allows it.
 *
 * A `web_app` button renders the page inside Telegram: on a phone that is a WebView in the app, on
 * desktop and web an iframe. The wallet connects there, the site runs its own eligibility check
 * against the user's own request, and nobody is handed to a browser tab and lost.
 *
 * Two conditions. Telegram refuses `web_app` on an inline keyboard outside a private chat, so a
 * group gets a plain link. And the site has to allow being framed, which for the web and desktop
 * clients means naming `web.telegram.org` in its `frame-ancestors`; a phone does not care because a
 * WebView is not a frame.
 */
export function webAppOrUrl(url: string, isPrivate: boolean): InlineKeyboardButton {
  return isPrivate ? { text: "", web_app: { url } } : { text: "", url };
}

/**
 * A button for something that ends in a signature.
 *
 * Deliberately never a `web_app` button. Rendering the site inside Telegram was tried and it does
 * not work for signing: the WebView has no injected provider, a passkey cannot open its popup, and
 * a WalletConnect round trip returns to a session that no longer exists. So a trade goes out to
 * `/open`, which offers the jump into an app that has a wallet.
 *
 * The rule, stated once: reading happens inside Telegram, signing happens in the wallet.
 */
export function signButton(
  text: string,
  app: App,
  path: string,
  label: string,
  // Defaults to the form that works everywhere. Telegram refuses `web_app` on an inline keyboard
  // outside a private chat and rejects the whole message to say so, and an inline query result is
  // never in a private chat, so the safe value has to be the default and the nice one opt-in.
  isPrivate = false,
): InlineKeyboardButton {
  const url = handoffUrl(app, path, label);
  // In a private chat it opens as a Mini App, keeping Telegram's header, close button and theme
  // rather than reading as being dumped into a browser.
  return isPrivate ? { text, style: "primary", web_app: { url } } : { text, style: "primary", url };
}

/** Under a price card: the two things somebody reading a price wants next. */
export function stockButtons(symbol: string, address: string, tradable: boolean): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  if (tradable) {
    rows.push([
      { text: `Buy ${symbol}`, style: "success", callback_data: encode({ kind: "buy", symbol }) },
      { text: `Sell ${symbol}`, style: "danger", callback_data: encode({ kind: "sell", symbol }) },
    ]);
  }
  rows.push([
    { text: "Open in app", url: stockLink(address) },
    {
      text: "Share",
      switch_inline_query_chosen_chat: { query: symbol, allow_user_chats: true, allow_group_chats: true },
    },
  ]);
  rows.push([{ text: "← All markets", callback_data: encode({ kind: "markets" }) }]);
  rows.splice(rows.length - 1, 0, [
    { text: "↻ Refresh", callback_data: encode({ kind: "price", symbol }) },
    { text: "📰 News", callback_data: encode({ kind: "news", symbol }) },
    { text: "Recurring plan", callback_data: encode({ kind: "plan", symbol }) },
  ]);
  return rows;
}

/** Under the markets table: a tappable row per stock, three to a line. */
export function marketButtons(symbols: string[]): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (let at = 0; at < symbols.length; at += 3) {
    rows.push(
      symbols.slice(at, at + 3).map((symbol) => ({
        text: symbol,
        callback_data: encode({ kind: "price", symbol }),
      })),
    );
  }
  return rows;
}

export function launchpadListButtons(tokens: { symbol: string; token: string }[]): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (let at = 0; at < tokens.length; at += 2) {
    rows.push(
      tokens.slice(at, at + 2).map((t) => ({
        text: t.symbol.slice(0, 12),
        callback_data: encode({ kind: "token", address: t.token }),
      })),
    );
  }
  rows.push([
    { text: "🔥 Top", callback_data: encode({ kind: "top" }) },
    { text: "🆕 New", callback_data: encode({ kind: "new" }) },
  ]);
  return rows;
}

/**
 * The buttons a drafted action becomes.
 *
 * This is the whole point of relaying the assistant rather than only its prose: a drafted trade
 * arrives with the address already resolved server-side, so the bot can offer it as one tap into
 * the app without ever reading an address out of model output. The tap opens a page. It does not
 * place an order, and nothing here can.
 */
export function actionButtons(actions: AssistantAction[], isPrivate = false): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (const action of actions) {
    if (action.kind === "trade") {
      const verb = action.side === "buy" ? "Buy" : "Sell";
      const size = action.amountUsd ? ` $${action.amountUsd}` : "";
      rows.push([
        signButton(
          `${verb}${size} ${action.symbol}`,
          "bstocks",
          `/stocks/${action.assetAddress}?trade=${action.side}`,
          `${verb} ${action.symbol}`,
          isPrivate,
        ),
      ]);
      continue;
    }
    if (action.kind === "news") {
      rows.push(action.items.slice(0, 2).map((item) => ({ text: item.source.slice(0, 20), url: item.url })));
      continue;
    }
    if (action.kind === "basket") rows.push([signButton("Open the basket builder", "bstocks", "/build", "Build a basket", isPrivate)]);
    if (action.kind === "autoinvest") rows.push([signButton("Open the plan wizard", "bstocks", "/automate", "Recurring plan", isPrivate)]);
    if (action.kind === "gift") rows.push([signButton("Open gifts", "bstocks", "/gifts", "Give stock", isPrivate)]);
    if (action.kind === "earn") rows.push([signButton("Open Earn", "bstocks", "/earn", "Explore Earn", isPrivate)]);
  }
  return rows.slice(0, 4);
}

/** The one card that exists to be tapped rather than read. */
export function menuCard(surface: Surface, isPrivate = true): { text: string; keyboard: InlineKeyboardButton[][] } {
  if (surface === "launchpad") {
    return {
      text: UI.launchpadMenu,
      keyboard: [
        [
          { text: "🔥 Top by volume", callback_data: encode({ kind: "top" }) },
          { text: "🆕 Newest", callback_data: encode({ kind: "new" }) },
        ],
        [{ text: "Open the launchpad", url: launchpadUrl("/markets") }],
        [{ text: "🔎 Search", callback_data: "search" }, { text: "❓ Help", callback_data: "h" }],
      ],
    };
  }
  return {
    text: UI.menu,
    keyboard: [
      [
        { text: "📈 Markets", callback_data: encode({ kind: "markets" }) },
        { text: "📰 News", callback_data: "news" },
      ],
      ...(isPrivate ? [[{ text: "⭐ Watchlist", callback_data: "watchlist" }, { text: "💼 Portfolio", callback_data: "pf" }]] : []),
      [{ text: "🔁 Recurring plan", callback_data: "dca" }, { text: "🧺 Baskets", callback_data: "baskets" }],
      [{ text: "💵 Earn", callback_data: "earn" }, { text: "🎁 Gifts & pools", callback_data: "gift" }],
      [{ text: "📊 Stats", callback_data: "st" }, { text: "Service status", callback_data: "status" }],
      ...(isPrivate ? [[{ text: "⚙️ Settings", callback_data: "settings" }, { text: "❓ Help", callback_data: "h" }]] : []),
      [{ text: "Open BaseStocks", style: "primary", url: bstocksUrl("/markets") }],
    ],
  };
}
