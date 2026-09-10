import type { Surface } from "@/config/surfaces";
import type { InlineKeyboardButton, ReplyKeyboard } from "@/lib/telegram/api";
import { bstocksUrl, launchpadUrl, stockLink } from "@/lib/links";
import { handoffUrl, type App } from "@/lib/handoff";
import type { AssistantAction } from "@/services/assistant";

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
  | { kind: "markets" }
  | { kind: "help" }
  | { kind: "stats" }
  | { kind: "menu" }
  | { kind: "portfolio" }
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
      return "m";
    case "help":
      return "h";
    case "stats":
      return "st";
    case "menu":
      return "n";
    case "portfolio":
      return "pf";
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
  if (!data) return null;
  if (data === "m") return { kind: "markets" };
  if (data === "h") return { kind: "help" };
  if (data === "st") return { kind: "stats" };
  if (data === "n") return { kind: "menu" };
  if (data === "pf") return { kind: "portfolio" };
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
  if (!SYMBOL.test(argument)) return null;
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
      ? [[{ text: "📈 Markets" }, { text: "💼 Portfolio" }], [{ text: "📊 Stats" }, { text: "❓ Help" }]]
      : [[{ text: "🔥 Top" }, { text: "🆕 New" }], [{ text: "❓ Help" }]];
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
  return isPrivate ? { text, web_app: { url } } : { text, url };
}

/** Under a price card: the two things somebody reading a price wants next. */
export function stockButtons(symbol: string, address: string, tradable: boolean): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  if (tradable) {
    rows.push([
      { text: `Buy ${symbol}`, callback_data: encode({ kind: "buy", symbol }) },
      { text: `Sell ${symbol}`, callback_data: encode({ kind: "sell", symbol }) },
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
export function actionButtons(actions: AssistantAction[]): InlineKeyboardButton[][] {
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
        ),
      ]);
      continue;
    }
    if (action.kind === "news") {
      rows.push(action.items.slice(0, 2).map((item) => ({ text: item.source.slice(0, 20), url: item.url })));
      continue;
    }
    if (action.kind === "basket") rows.push([{ text: "Open the basket builder", url: bstocksUrl("/build") }]);
    if (action.kind === "autoinvest") rows.push([{ text: "Open the plan wizard", url: bstocksUrl("/automate") }]);
    if (action.kind === "gift") rows.push([{ text: "Open gifts", url: bstocksUrl("/gifts") }]);
    if (action.kind === "earn") rows.push([{ text: "Open Earn", url: bstocksUrl("/earn") }]);
  }
  return rows.slice(0, 4);
}

/** The one card that exists to be tapped rather than read. */
export function menuCard(surface: Surface): { text: string; keyboard: InlineKeyboardButton[][] } {
  if (surface === "launchpad") {
    return {
      text: [
        "<b>What would you like to see?</b>",
        "",
        "Or paste a token address and I will price it.",
      ].join("\n"),
      keyboard: [
        [
          { text: "🔥 Top by volume", callback_data: encode({ kind: "top" }) },
          { text: "🆕 Newest", callback_data: encode({ kind: "new" }) },
        ],
        [{ text: "Open the launchpad", url: launchpadUrl("/markets") }],
      ],
    };
  }
  return {
    text: [
      "<b>What would you like to do?</b>",
      "",
      "Or just tell me in your own words: <i>what moved today, buy fifty dollars of NVDA, invest weekly in tech</i>.",
    ].join("\n"),
    keyboard: [
      [
        { text: "📈 Markets", callback_data: encode({ kind: "markets" }) },
        { text: "📊 Stats", callback_data: encode({ kind: "stats" }) },
      ],
      [{ text: "Open the app", url: bstocksUrl("/markets") }],
    ],
  };
}
