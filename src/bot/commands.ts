import { after } from "next/server";
import type { Surface } from "@/config/surfaces";
import { env } from "@/config/env";
import { Telegram, webhookAck, webhookReply, type SendMessageParams } from "@/lib/telegram/api";
import type { TgChat, TgMessage, TgUpdate, TgUser } from "@/lib/telegram/types";
import { b, code, esc } from "@/lib/telegram/html";
import { LIMITS, meter } from "@/lib/rate-limit";
import { claimOnce } from "@/lib/store";
import { compactUsd, move, pad, shortAddress, usd } from "@/lib/format";
import { automateLink, evenLegs, launchpadCreateLink, stockLink } from "@/lib/links";
import { isTradable, listStocks, readActivity, readPortfolio, readStats, reverseBasename, type V1Stock } from "@/services/bstocks";
import { listMarkets, listLaunchStocks, readToken, type Market } from "@/services/launchpad";
import { askAssistant } from "@/services/assistant";
import { KEYBOARD_ALIASES, actionButtons, decode, encode, menuCard, replyKeyboard, signButton } from "./nav";
import { confirmEligibility, eligibilityCard, hasConfirmed } from "./eligibility";
import { appendTurns, clearHistory, loadHistory } from "./history";
import { THINKING, assistantCard, refusalCard } from "./assistant-card";
import { forgetWallet, getWallet, setWallet, toAddress } from "./wallet";
import { COPY, UI } from "./copy";
import { CLAIM_HELP, KEY_WARNING, inspectForClaim } from "./claim";
import { isAddress, resolveStock } from "./resolve";
import { clearWatchlist, getPrompt, getWatchlist, setPrompt, updateWatchlist } from "./preferences";
import { activityCard, watchlistCard } from "./personal-cards";
import { planCard } from "./plan";
import { marketListCard, marketsCard, portfolioCard, stockCard, tokenCard, type Card } from "./render";
import { earnCard, helpCard, newsCard, poolsCard, statusCard, templatesCard } from "./ecosystem-cards";
import { readEarn, readNews, readPools, readStatus, readTemplates } from "@/services/ecosystem";
import registration from "@/lib/telegram/registration.json";

const PERSONAL_COMMANDS = new Set(registration.personalCommands);

export interface Ctx {
  surface: Surface;
  tg: Telegram;
  chat: TgChat;
  from: TgUser | undefined;
  threadId: number | undefined;
  isPrivate: boolean;
  args: string;
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export async function handleUpdate(surface: Surface, token: string, update: TgUpdate): Promise<Response> {
  // Telegram redelivers only when it did not receive a 2xx, which is rare once the handler answers
  // before it works. It is still worth one claim: a redelivered update that costs an upstream read
  // or a model call must not be paid for twice.
  const first = await claimOnce(`upd:${surface}:${update.update_id}`, 600);
  if (!first) return webhookAck();

  const tg = new Telegram(token);

  if (update.my_chat_member) return handleMembership(surface, tg, update);
  if (update.inline_query) return handleInline(surface, tg, update);
  if (update.callback_query) return handleCallback(surface, tg, update);

  const message = update.message;
  if (!message?.text) return webhookAck();
  return handleMessage(surface, tg, message);
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

async function handleMessage(surface: Surface, tg: Telegram, message: TgMessage): Promise<Response> {
  const text = message.text ?? "";

  // Before anything parses, logs or echoes: a claim key in a message is a gift somebody can steal.
  const claim = inspectForClaim(text);
  if (claim.kind === "key-present") {
    return reply(message, { text: KEY_WARNING, preview: { is_disabled: true } });
  }

  const isPrivate = message.chat.type === "private";
  if (message.from?.is_bot) return webhookAck();
  const mention = /^\/[A-Za-z0-9_]+@([A-Za-z0-9_]+)/.exec(text.trim())?.[1];
  if (mention) {
    const expected = surface === "bstocks" ? env().TELEGRAM_BSTOCKS_USERNAME : env().TELEGRAM_LAUNCHPAD_USERNAME;
    const username = expected ?? await tg.username();
    if (!username || username.toLowerCase() !== mention.toLowerCase()) return webhookAck();
  }
  // A persistent-keyboard button sends its own label as ordinary text, so the label table is read
  // before anything else treats the message as prose.
  let parsed = parseCommand(text) ?? (isPrivate ? KEYBOARD_ALIASES[text.trim()] : undefined) ?? null;

  if (!parsed) {
    if (claim.kind === "claim-link" && surface === "bstocks") {
      return reply(message, { text: CLAIM_HELP, preview: { is_disabled: true } });
    }
    // Free text is only ever answered in a private chat. In a group the bot speaks when spoken to,
    // and it is never given a stranger's message as an instruction.
    if (!isPrivate) return webhookAck();
    const pending = message.from ? await getPrompt(surface, message.from.id) : null;
    if (pending) parsed = { command: pending, args: text.trim() };
    else if (surface === "launchpad") parsed = { command: isAddress(text.trim()) ? "token" : "search", args: text.trim() };
    else if (isAddress(text.trim()) || /^[a-z0-9-]+\.base\.eth$/i.test(text.trim())) parsed = { command: "portfolio", args: text.trim() };
    else if (/^\$?[A-Za-z0-9.\-]{1,12}$/.test(text.trim()) || !env().ASSISTANT_ENABLED) parsed = { command: "search", args: text.trim() };
    else return assistantReply(tg, message);
  }

  if (isPrivate && message.from && (parseCommand(text) || KEYBOARD_ALIASES[text.trim()])) await setPrompt(surface, message.from.id, null);

  const identity = String(message.from?.id ?? message.chat.id);
  const verdict = await meter("cmd", identity, LIMITS.command);
  if (!verdict.allowed) {
    return reply(message, { text: esc("One moment, that is a lot of commands. Try again in a minute."), preview: { is_disabled: true } });
  }

  const ctx: Ctx = {
    surface,
    tg,
    chat: message.chat,
    from: message.from,
    threadId: message.message_thread_id,
    isPrivate,
    args: parsed.args,
  };

  const card = await route(parsed.command, ctx);
  if (!card) return webhookAck();
  return reply(message, card);
}

/** A command, with the `@botname` suffix Telegram adds in groups stripped off. */
export function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{1,64}))?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match?.[1]) return null;
  return { command: match[1].toLowerCase(), args: (match[3] ?? "").trim() };
}


/**
 * The `?start=` payload, which Telegram limits to 64 characters of `A-Za-z0-9_-`.
 *
 * Only the prefixes below mean anything; everything else, including the `src_*` values used purely
 * for attribution, falls through to the ordinary welcome. Parsing is strict because this is a
 * string a stranger chose: it decides which command runs.
 */
export function parseStartPayload(raw: string): { command: string; args: string } | null {
  const payload = raw.trim();
  if (!payload || payload.length > 64 || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;

  const at = payload.indexOf("_");
  if (at <= 0) return null;
  const kind = payload.slice(0, at);
  const rest = payload.slice(at + 1);
  if (!rest) return null;

  if (kind === "stock" && /^[A-Za-z0-9.-]{1,12}$/.test(rest)) return { command: "price", args: rest };
  if (kind === "buy" && /^[A-Za-z0-9.-]{1,12}$/.test(rest)) return { command: "buy", args: rest };
  if (kind === "token" && /^0x[0-9a-fA-F]{40}$/.test(rest)) return { command: "token", args: rest };
  if (kind === "wallet" && /^0x[0-9a-fA-F]{40}$/.test(rest)) return { command: "portfolio", args: rest };
  return null;
}

async function route(command: string, ctx: Ctx): Promise<Card | null> {
  if (PERSONAL_COMMANDS.has(command) && !ctx.isPrivate) return { text: esc(UI.privateOnly), preview: { is_disabled: true } };
  const shared: Record<string, (c: Ctx) => Promise<Card> | Card> = {
    cancel: async (c) => {
      if (c.from && c.isPrivate) await setPrompt(c.surface, c.from.id, null);
      return { ...menuCard(c.surface, c.isPrivate), editable: true };
    },
    reset: async (c) => {
      await clearHistory(c.chat.id);
      return { text: esc("Forgotten. We can start again."), preview: { is_disabled: true } };
    },
    /**
     * `/start` with a payload, which is Telegram's own deep-link mechanism.
     *
     * `t.me/<bot>?start=stock_NVDA` opens the bot already showing NVDA, so a link shared anywhere
     * lands somebody on the thing it was about rather than on a greeting. The payload is 64
     * characters of `A-Za-z0-9_-`, so it is parsed strictly and anything unrecognised falls through
     * to the ordinary welcome rather than erroring.
     */
    start: async (c) => {
      const deep = parseStartPayload(c.args);
      if (deep) {
        const card = await route(deep.command, { ...c, args: deep.args });
        // The keyboard still comes with the first message, whatever that first message turned out
        // to be: it is the thing that makes the bot usable without typing.
        // Reply and inline keyboards are mutually exclusive. Keep the deep-linked card actionable.
        if (card) return card;
      }
      return {
        text: COPY[c.surface].start,
        preview: { is_disabled: true },
        replyKeyboard: c.isPrivate ? replyKeyboard(c.surface) : undefined,
      };
    },
    menu: (c) => {
      const card = menuCard(c.surface, c.isPrivate);
      return { text: card.text, keyboard: card.keyboard, preview: { is_disabled: true }, editable: true };
    },
    // The BStocks help is a card with buttons; the launchpad's stays prose until it has as many
    // paths worth offering.
    help: (c) => (c.surface === "bstocks" ? helpCard() : { text: COPY[c.surface].help, preview: { is_disabled: true } }),
  };
  const table = ctx.surface === "bstocks" ? BSTOCKS_COMMANDS : LAUNCHPAD_COMMANDS;
  const handler = shared[command] ?? table[command];
  if (!handler) {
    // Silence in a group: an unknown slash command is usually meant for a different bot.
    if (!ctx.isPrivate) return null;
    return ctx.surface === "bstocks" ? helpCard() : { text: COPY[ctx.surface].help, preview: { is_disabled: true } };
  }
  const card = await handler(ctx);
  if (card.replyKeyboard || command === "start") return card;
  const keyboard = [...(card.keyboard ?? [])];
  if (command !== "menu" && command !== "cancel") keyboard.push([{ text: "🏠 Menu", callback_data: "n" }, { text: "❓ Help", callback_data: "h" }]);
  return { ...card, keyboard, editable: true };
}

/* ------------------------------------------------------------------ *
 * BStocks commands
 * ------------------------------------------------------------------ */

const BSTOCKS_COMMANDS: Record<string, (c: Ctx) => Promise<Card>> = {
  price: async (ctx) => {
    if (!ctx.args) return BSTOCKS_COMMANDS.markets!(ctx);
    const stocks = await listStocks();
    if (stocks.length === 0) return upstreamDown();
    const { stock, suggestions } = resolveStock(stocks, ctx.args);
    if (!stock) return notFound(ctx.args, suggestions);
    const card = stockCard(stock);
    if (ctx.isPrivate && ctx.from) {
      const saved = (await getWatchlist(ctx.from.id)).includes(stock.address.toLowerCase());
      card.keyboard?.splice(1, 0, [{ text: saved ? "★ Watching · Remove" : "☆ Watch", callback_data: encode({ kind: saved ? "unwatch" : "watch", symbol: stock.symbol }) }]);
    }
    return card;
  },

  markets: async (ctx) => {
    const stocks = await listStocks();
    if (stocks.length === 0) return upstreamDown();
    const parts = /^(move|volume|name) (\d{1,3})$/.exec(ctx.args);
    return marketsCard(stocks, parts ? Number(parts[2]) : 0, parts ? parts[1] as "move" | "volume" | "name" : "move");
  },

  search: async (ctx) => {
    if (!ctx.args) {
      if (ctx.isPrivate && ctx.from) await setPrompt(ctx.surface, ctx.from.id, "search");
      return { text: UI.searchPrompt, keyboard: [[{ text: "Cancel", callback_data: "cancel" }]] };
    }
    const stocks = await listStocks();
    if (!stocks.length) return upstreamDown();
    const result = resolveStock(stocks, ctx.args);
    if (ctx.isPrivate && ctx.from) await setPrompt(ctx.surface, ctx.from.id, null);
    if (result.stock) return BSTOCKS_COMMANDS.price!({ ...ctx, args: result.stock.symbol });
    return notFound(ctx.args, result.suggestions);
  },

  watchlist: async (ctx) => {
    if (!ctx.from) return upstreamDown();
    const addresses = await getWatchlist(ctx.from.id);
    if (!addresses.length) return watchlistCard([], []);
    const stocks = await listStocks();
    return stocks.length ? watchlistCard(stocks, addresses) : upstreamDown();
  },
  watch: (ctx) => changeWatch(ctx, true),
  unwatch: (ctx) => changeWatch(ctx, false),
  clearwatchlist: async (ctx) => {
    if (ctx.from && !(await clearWatchlist(ctx.from.id))) return { text: esc(UI.storageUnavailable) };
    return watchlistCard([], []);
  },
  settings: async () => ({ text: UI.settings, keyboard: [[{ text: "Wallet", callback_data: "wallet" }, { text: "Watchlist", callback_data: "watchlist" }]] }),
  activity: async (ctx) => {
    const typed = ctx.args ? await toAddress(ctx.args) : null;
    if (ctx.args && !typed) return { text: esc(UI.invalidWallet) };
    const address = typed?.address ?? (ctx.from ? await getWallet(ctx.from.id) : null);
    if (!address) return BSTOCKS_COMMANDS.wallet!({ ...ctx, args: "" });
    const items = await readActivity(address);
    return items ? activityCard(items, address) : upstreamDown();
  },

  buy: (ctx) => stockHandoff(ctx, "buy"),
  sell: (ctx) => stockHandoff(ctx, "sell"),
  /** Kept because it was published before `buy` existed, and an advertised command should not vanish. */
  open: (ctx) => stockHandoff(ctx, "buy"),

  /**
   * A recurring plan, handed over entirely in a URL.
   *
   * The wizard on the other side reads the legs, the amount and the cadence, so the whole command
   * is a link builder. It refuses rather than guesses when the input is ambiguous, because a plan
   * link that quietly drops a leg is worse than one that was never sent.
   */
  dca: async (ctx) => {
    if (!ctx.args) {
      const stocks = await listStocks();
      return stocks.length ? planCard(stocks.slice(0, 24)) : upstreamDown();
    }
    const parsed = parseDca(ctx.args);
    if (!parsed) {
      return {
        text: esc(UI.planInvalid),
        preview: { is_disabled: true },
      };
    }
    const stocks = await listStocks();
    if (stocks.length === 0) return upstreamDown();

    const resolved: V1Stock[] = [];
    const missing: string[] = [];
    for (const ticker of parsed.tickers) {
      const { stock } = resolveStock(stocks, ticker);
      if (stock) resolved.push(stock);
      else missing.push(ticker);
    }
    if (missing.length > 0) return { text: `${esc(UI.planMissing)}\n\n${esc(missing.join(", "))}` };
    if (new Set(resolved.map((s) => s.address.toLowerCase())).size !== resolved.length) return { text: esc(UI.planDuplicates) };

    const legs = evenLegs(resolved.map((s) => s.address));
    if (legs.some((leg) => parsed.usd * leg.bps / 10_000 < 1)) return { text: esc(UI.planInvalid) };
    const href = automateLink(legs, {
      usd: parsed.usd,
      cadenceDays: parsed.cadenceDays,
      name: resolved.length === 1 ? `${resolved[0]?.symbol} plan` : "Basket plan",
    });

    const lines = [
      b("Recurring plan"),
      "",
      `${esc(`$${parsed.usd} ${parsed.cadenceLabel}, split evenly across`)} ${b(resolved.map((s) => s.symbol).join(", "))}`,
    ];
    lines.push(
      "",
      esc("The link opens the wizard already filled in. The contract enforces the amount, the cadence, the routes and the minimum you receive, and it can never sell."),
    );

    return {
      text: lines.join("\n"),
      keyboard: [[signButton("Review plan in BaseStocks", "bstocks", new URL(href).pathname + new URL(href).search, "Recurring plan", ctx.isPrivate)]],
      preview: { url: href, prefer_small_media: true },
    };
  },

  /**
   * Counted activity, over the window the app itself publishes.
   *
   * `/api/v1/stats` returns several windows; 7d is the one worth a chat message, because 24h on a
   * young product is usually a row of zeros that reads as "nothing works" rather than "quiet day".
   */
  /**
   * Remembers an address so the portfolio card has something to read.
   *
   * Read-only, unverified, and said plainly to be so. Everything it shows is already public on
   * Base, so a signature here would be friction protecting data that is not protected anywhere
   * else. The day the bot can act on a wallet's behalf, this stops being enough.
   */
  wallet: async (ctx) => {
    if (!ctx.isPrivate) {
      return { text: esc("Wallets are a private-chat thing. Message me directly and we will set it up."), preview: { is_disabled: true } };
    }
    if (!ctx.from) return upstreamDown();

    if (!ctx.args) {
      const current = await getWallet(ctx.from.id);
      if (!current) {
        await setPrompt(ctx.surface, ctx.from.id, "wallet");
        return {
          text: UI.walletPrompt,
          keyboard: [[{ text: "Cancel", callback_data: "cancel" }]],
          preview: { is_disabled: true },
        };
      }
      const name = await reverseBasename(current);
      await setPrompt(ctx.surface, ctx.from.id, "wallet");
      return {
        text: [
          b("Your wallet"),
          "",
          code(current),
          ...(name ? [esc(name)] : []),
          "",
          esc("/portfolio shows what is in it. /forget drops it."),
          esc("Send a new address or Basename to replace it, or /cancel to keep it."),
        ].join("\n"),
        keyboard: [[{ text: "Portfolio", callback_data: encode({ kind: "portfolio" }) }]],
        preview: { is_disabled: true },
      };
    }

    const resolved = await toAddress(ctx.args);
    if (!resolved) {
      return { text: esc("That is not an address or a Basename. Try /wallet 0x... or /wallet alice.base.eth"), preview: { is_disabled: true } };
    }
    if (!(await setWallet(ctx.from.id, resolved.address))) return { text: esc(UI.storageUnavailable) };
    await setPrompt(ctx.surface, ctx.from.id, null);
    return {
      text: [
        b("Saved"),
        "",
        code(resolved.address),
        ...(resolved.name ? [esc(resolved.name)] : []),
        "",
        esc("A bookmark, not a login: it proves nothing and lets me do nothing on your behalf. /forget drops it."),
      ].join("\n"),
      keyboard: [[{ text: "Show my portfolio", callback_data: encode({ kind: "portfolio" }) }]],
      preview: { is_disabled: true },
    };
  },

  me: (ctx) => BSTOCKS_COMMANDS.portfolio!(ctx),

  forget: async (ctx) => {
    if (ctx.from && !(await forgetWallet(ctx.from.id))) return { text: esc(UI.storageUnavailable) };
    return { text: esc("Dropped. I no longer have an address for you."), preview: { is_disabled: true } };
  },

  /** Holdings, value and the day's move, for a saved wallet or one typed inline. */
  portfolio: async (ctx) => {
    if (!ctx.isPrivate) {
      return { text: esc("I never show anybody's holdings in a group. Message me directly."), preview: { is_disabled: true } };
    }
    const typed = ctx.args ? await toAddress(ctx.args) : null;
    if (ctx.args && !typed) return { text: esc(UI.invalidWallet), preview: { is_disabled: true } };
    const address = typed?.address ?? (ctx.from ? await getWallet(ctx.from.id) : null);
    if (!address) {
      return BSTOCKS_COMMANDS.wallet!({ ...ctx, args: "" });
    }

    const [portfolio, name] = await Promise.all([readPortfolio(address), reverseBasename(address)]);
    if (!portfolio) return upstreamDown();

    return portfolioCard(portfolio, name ?? shortAddress(address), [
      [
        signButton("Open portfolio", "bstocks", "/portfolio", "Your portfolio", ctx.isPrivate),
        { text: "Markets", callback_data: encode({ kind: "markets" }) },
      ],
      [{ text: "Recent activity", callback_data: encode({ kind: "activity", address }) }, { text: "↻ Refresh", callback_data: encode({ kind: "portfolio", address }) }],
    ]);
  },

  earn: async () => {
    const view = await readEarn();
    return view ? earnCard(view) : upstreamDown();
  },

  news: async (ctx) => {
    // A ticker narrows it to that stock's wire; without one it is the Base and Coinbase
    // tokenized-stock feed, which is the one that actually moves these names.
    if (!ctx.args) return newsCard(await readNews({ scope: "ecosystem" }), "Base and Coinbase");
    const stocks = await listStocks();
    const { stock, suggestions } = resolveStock(stocks, ctx.args);
    if (!stock) return notFound(ctx.args, suggestions);
    return newsCard(await readNews({ symbol: stock.symbol }), `${stock.symbol} headlines`);
  },

  status: async () => {
    const report = await readStatus();
    return report ? statusCard(report) : upstreamDown();
  },

  baskets: async () => {
    const [templates, stocks] = await Promise.all([readTemplates(), listStocks()]);
    if (templates.length === 0) return upstreamDown();
    return templatesCard(templates, symbolLookup(stocks));
  },

  pools: async () => {
    const [pools, stocks] = await Promise.all([readPools(), listStocks()]);
    return poolsCard(pools, symbolLookup(stocks));
  },

  gift: async (ctx) => {
    const lines = [
      b("Give stock to someone"),
      "",
      esc("Send it to a Basename or an address, or make a claim link for somebody with no wallet at all: the stock waits in an ownerless escrow until they open the link, and they claim it with a passkey wallet created on the spot."),
      "",
      esc("A gift pool is the same idea for a group: one deposit, many equal claims, one per wallet, and whatever nobody takes comes back to you."),
    ];
    return {
      text: lines.join("\n"),
      keyboard: [
        [signButton("Open gifts", "bstocks", "/gifts", "Give stock", ctx.isPrivate)],
        [{ text: "Open pools", callback_data: encode({ kind: "pools" }) }],
      ],
      preview: { is_disabled: true },
    };
  },

  stats: async () => {
    const stats = await readStats();
    const window = stats?.windows?.["7d"];
    if (!window) return upstreamDown();
    const rows: [string, string][] = [
      ["Trades", numberOr(window.trades)],
      ["Volume", window.tradeVolumeUsd === undefined ? "—" : compactUsd(window.tradeVolumeUsd)],
      ["Wallets", numberOr(window.wallets)],
      ["Plan runs", numberOr(window.planRuns)],
      ["Gift links", numberOr(window.linksCreated)],
      ["Claimed", numberOr((window.linksClaimed ?? 0) + (window.poolClaims ?? 0))],
    ].filter(([, value]) => value !== "—") as [string, string][];

    return {
      text: [
        b("Last seven days"),
        `<pre>${rows.map(([k, v]) => `${esc(pad(k, 11))}${esc(v)}`).join("\n")}</pre>`,
        `<i>${esc("Every figure is counted only after the app matched the record to its receipt on Base.")}</i>`,
      ].join("\n"),
      preview: { is_disabled: true },
    };
  },
};

/** Addresses to tickers, for the cards that hold an allocation or a pool leg rather than a stock. */
function symbolLookup(stocks: V1Stock[]): (address: string) => string | null {
  const map = new Map(stocks.map((s) => [s.address.toLowerCase(), s.symbol]));
  return (address: string) => map.get(address.toLowerCase()) ?? null;
}

function numberOr(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "—";
}

async function changeWatch(ctx: Ctx, add: boolean): Promise<Card> {
  if (!ctx.from) return upstreamDown();
  if (!ctx.args) return BSTOCKS_COMMANDS.watchlist!(ctx);
  const stocks = await listStocks();
  if (!stocks.length) return upstreamDown();
  const { stock, suggestions } = resolveStock(stocks, ctx.args);
  if (!stock) return notFound(ctx.args, suggestions);
  if (!(await updateWatchlist(ctx.from.id, stock.address, add))) return { text: esc(UI.watchFull) };
  return add ? BSTOCKS_COMMANDS.price!({ ...ctx, args: stock.symbol }) : watchlistCard(stocks, await getWatchlist(ctx.from.id));
}

export interface DcaRequest {
  usd: number;
  tickers: string[];
  cadenceDays: number;
  cadenceLabel: string;
}

const CADENCE: Record<string, { days: number; label: string }> = {
  daily: { days: 1, label: "every day" },
  weekly: { days: 7, label: "every week" },
  biweekly: { days: 14, label: "every two weeks" },
  monthly: { days: 30, label: "every month" },
};

export function parseDca(args: string): DcaRequest | null {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (!/^\$?\d+(?:\.\d{1,2})?$/.test(parts[0] ?? "")) return null;
  const usd = Number(parts[0]?.replace(/^\$/, ""));
  if (!Number.isFinite(usd) || usd <= 0 || usd > 1_000_000) return null;
  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  const cadence = CADENCE[last];
  if (!cadence) return null;
  const tickers = parts.slice(1, -1).join(" ").split(/[,\s]+/).map((ticker) => ticker.replace(/^\$/, ""));
  if (tickers.length === 0 || tickers.length > 12 || tickers.some((ticker) => !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker))) return null;
  if (new Set(tickers.map((ticker) => ticker.toUpperCase())).size !== tickers.length || usd < tickers.length) return null;
  return { usd, tickers, cadenceDays: cadence.days, cadenceLabel: cadence.label };
}

/**
 * The one place a stock trade is handed over.
 *
 * This is what `/buy` and `/sell` are: not a trade, a link. The bot has no key, and both the quote
 * and the eligibility check belong to a request the user makes themselves, from their own device,
 * carrying their own region. The app opens with the side already chosen and the amount still theirs
 * to set, and nothing is signed until they confirm it in their own wallet.
 */
async function stockHandoff(ctx: Ctx, side: "buy" | "sell"): Promise<Card> {
  const verb = side === "buy" ? "Buy" : "Sell";
  if (!ctx.args) {
    return BSTOCKS_COMMANDS.markets!(ctx);
  }
  const stocks = await listStocks();
  if (stocks.length === 0) return upstreamDown();
  const { stock, suggestions } = resolveStock(stocks, ctx.args);
  if (!stock) return notFound(ctx.args, suggestions);

  // The notice, once, in front of the thing it is about. See src/bot/eligibility.ts for what this
  // confirmation is and, more importantly, what it is not.
  if (ctx.from && !(await hasConfirmed(ctx.from.id))) {
    return eligibilityCard(
      encode({ kind: "confirm", next: { kind: side, symbol: stock.symbol } }),
      `${verb} ${stock.symbol}`,
    );
  }

  // Still used for the link preview card, which is a picture rather than a destination.
  const href = stockLink(stock.address, side);
  const lines = [
    b(`${verb} ${stock.symbol} · ${stock.name}`),
    `${b(usd(stock.dexPriceUsd ?? stock.displayUsd))}  ${esc(move(stock.dexChange24hPct))}`,
    "",
  ];

  if (!isTradable(stock)) {
    // Say why before offering a button that opens a panel which cannot fill anything.
    lines.push(
      `${esc(stock.status.label)}: ${esc(stock.status.detail)}`,
      "",
      esc("The panel still opens, but no route can fill an order at this size right now."),
    );
  } else {
    lines.push(
      esc(
        side === "buy"
          ? "The app opens on the buy side with the amount still yours to set. It asks every route at once, shows you a firm quote, simulates the transaction, and nothing is signed until you confirm it in your own wallet."
          : "The app opens on the sell side. It asks every route at once and shows you a firm quote before anything is signed in your own wallet.",
      ),
    );
  }


  return {
    text: lines.join("\n"),
    keyboard: [
      // Out to a wallet, never into Telegram's own browser: that WebView has no provider to sign
      // with, which is the whole reason `/open` exists.
      [signButton(`${verb} ${stock.symbol}`, "bstocks", `/stocks/${stock.address}?trade=${side}`, `${verb} ${stock.symbol}`, ctx.isPrivate)],
      [
        { text: "Price", callback_data: encode({ kind: "price", symbol: stock.symbol }) },
        { text: "Share", switch_inline_query_chosen_chat: { query: stock.symbol, allow_user_chats: true, allow_group_chats: true } },
      ],
    ],
    preview: { url: href, prefer_small_media: true },
  };
}

/* ------------------------------------------------------------------ *
 * Launchpad commands
 * ------------------------------------------------------------------ */

const LAUNCHPAD_COMMANDS: Record<string, (c: Ctx) => Promise<Card>> = {
  top: async (ctx) => {
    const limit = clampCount(ctx.args, 10);
    const page = await listMarkets({ orderBy: "volume24h", limit });
    if (!page) return upstreamDown();
    return marketListCard(
      `Top ${page.markets.length} by 24h volume`,
      "Ranked by traded value in the last day, which is attention rather than quality: volume in a permissionless pool is trivially wash traded.",
      page.markets,
    );
  },

  new: async (ctx) => {
    const limit = clampCount(ctx.args, 10);
    const page = await listMarkets({ orderBy: "newest", limit });
    if (!page) return upstreamDown();
    return marketListCard(
      `${page.markets.length} newest launches`,
      "Newest first. A token inside its first twenty seconds charges most of your order as a fee.",
      page.markets,
    );
  },

  token: async (ctx) => {
    if (!ctx.args) return { text: esc("Which token? Try /token 0x… or /token SYMBOL"), preview: { is_disabled: true } };
    const market = await findMarket(ctx.args);
    if (market === "indexing") {
      return {
        text: [
          b("Just launched"),
          "",
          esc("The launch is confirmed onchain but the indexer has not stored it yet. Try again in a few seconds."),
        ].join("\n"),
        preview: { is_disabled: true },
      };
    }
    if (!market) {
      return { text: esc(`No token matched "${ctx.args}". /search finds one by name or symbol.`), preview: { is_disabled: true } };
    }
    return tokenCard(market, Date.now(), undefined, ctx.isPrivate);
  },

  buy: (ctx) => tokenHandoff(ctx, "buy"),
  sell: (ctx) => tokenHandoff(ctx, "sell"),

  creator: async (ctx) => {
    if (!ctx.args) return { text: esc("Whose tokens? Try /creator 0x..."), preview: { is_disabled: true } };
    const address = ctx.args.trim();
    if (!isAddress(address)) return { text: esc("That is not an address."), preview: { is_disabled: true } };
    const page = await listMarkets({ creator: address, limit: 10, orderBy: "newest" });
    if (!page) return upstreamDown();
    return marketListCard(
      `Launched by ${shortAddress(address)}`,
      "Newest first. A creator earns 70% of the fee on every swap in their own pools.",
      page.markets,
    );
  },

  search: async (ctx) => {
    if (!ctx.args) {
      if (ctx.isPrivate && ctx.from) await setPrompt(ctx.surface, ctx.from.id, "search");
      return { text: UI.searchPrompt, keyboard: [[{ text: "Cancel", callback_data: "cancel" }]] };
    }
    if (ctx.isPrivate && ctx.from) await setPrompt(ctx.surface, ctx.from.id, null);
    const page = await listMarkets({ q: ctx.args.slice(0, 64), limit: 10, orderBy: "volume24h" });
    if (!page) return upstreamDown();
    if (page.markets.length === 1 && page.markets[0]) return tokenCard(page.markets[0], Date.now(), undefined, ctx.isPrivate);
    return marketListCard(`Matches for "${ctx.args.slice(0, 32)}"`, "Best match by 24h volume first.", page.markets);
  },

  /**
   * Collects the fields and hands over a prefilled create link.
   *
   * The metadata pin stays on the other side deliberately: the launchpad meters pinning per caller
   * and puts it behind its region gate, so pinning from here would spend one shared allowance for
   * everybody and would present this deployment's region instead of the user's.
   */
  launch: async (ctx) => {
    const parts = ctx.args.split(/\s+/).filter(Boolean);
    const stocks = await listLaunchStocks();
    const enabled = stocks.filter((s) => s.enabled);

    if (parts.length < 3) {
      return {
        text: [
          b("Launch a token"),
          "",
          esc("Try /launch MyToken MTK NVDA — a name, a symbol, and the stock it trades against."),
          "",
          enabled.length > 0 ? `${esc("Available stocks:")} ${b(enabled.map((s) => s.ticker).join(", "))}` : "",
          "",
          esc("One transaction creates the token, opens the pool and locks the entire supply as liquidity forever. It costs 0.0001 ETH and you sign it yourself."),
        ]
          .filter(Boolean)
          .join("\n"),
        preview: { is_disabled: true },
      };
    }

    const [name, symbol, tickerRaw] = parts;
    const ticker = (tickerRaw ?? "").toUpperCase().replace(/^\$/, "");
    const stock = enabled.find((s) => s.ticker.toUpperCase() === ticker || s.symbol.toUpperCase() === ticker);
    if (!stock) {
      return {
        text: [
          esc(`"${tickerRaw}" is not a stock tokens can be paired with here.`),
          enabled.length > 0 ? `${esc("Available:")} ${b(enabled.map((s) => s.ticker).join(", "))}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        preview: { is_disabled: true },
      };
    }

    const href = launchpadCreateLink({ name, symbol, stock: stock.address });
    return {
      text: [
        b("Launch a token"),
        "",
        `${esc("Name")} ${b(name ?? "")}`,
        `${esc("Symbol")} ${b(symbol ?? "")}`,
        `${esc("Paired with")} ${b(stock.ticker)}`,
        "",
        esc("The link opens the create form with those filled in. You add the image, pin the metadata from your own browser and sign the launch. I never hold a key and never send a transaction."),
      ].join("\n"),
      keyboard: [[{ text: "Open the create form", url: href }]],
      preview: { url: href, prefer_small_media: true },
    };
  },
};

/**
 * A launchpad trade, handed over the same way, with one addition that matters more here.
 *
 * These pools charge 99% of the stock side in their first second, decaying to 1% over twenty. So a
 * trade button on a fresh token is an invitation to lose most of an order, and `tokenCard` puts the
 * countdown above the price and writes the wait into the button label rather than under it.
 *
 * The other thing worth saying out loud: buying needs the paired tokenized stock in the wallet
 * already. There is no USDC or ETH route into these pools, and finding that out at the trade panel
 * is a worse place to find it out than here.
 */
async function tokenHandoff(ctx: Ctx, side: "buy" | "sell"): Promise<Card> {
  if (!ctx.args) {
    return { text: esc(`Which token? Try /${side} 0x… or /${side} SYMBOL`), preview: { is_disabled: true } };
  }
  const market = await findMarket(ctx.args);
  if (market === "indexing") {
    return {
      text: [
        b("Just launched"),
        "",
        esc("The launch is confirmed onchain but the indexer has not stored it yet, so I cannot price it. Try again in a few seconds."),
      ].join("\n"),
      preview: { is_disabled: true },
    };
  }
  if (!market) {
    return { text: esc(`No token matched "${ctx.args.slice(0, 32)}". /search finds one by name or symbol.`), preview: { is_disabled: true } };
  }
  // Trading here means holding the paired tokenized stock, so the same notice applies even though
  // the token itself is permissionless.
  if (ctx.from && !(await hasConfirmed(ctx.from.id))) {
    return eligibilityCard(
      encode({ kind: "confirm", next: { kind: "token", address: market.token } }),
      `${side === "buy" ? "Buy" : "Sell"} ${market.symbol}`,
    );
  }
  return tokenCard(market, Date.now(), side, ctx.isPrivate);
}

function clampCount(args: string, fallback: number): number {
  const n = Number(args.trim().split(/\s+/)[0]);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, 25);
}

async function findMarket(query: string): Promise<Market | "indexing" | null> {
  if (isAddress(query)) {
    const lookup = await readToken(query.trim());
    if (!lookup) return null;
    if (lookup.status === "indexing") return "indexing";
    return lookup.market;
  }
  const page = await listMarkets({ q: query.slice(0, 64), limit: 5, orderBy: "volume24h" });
  const exact = page?.markets.find((m) => m.symbol.toUpperCase() === query.trim().toUpperCase());
  return exact ?? page?.markets[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Inline mode
 * ------------------------------------------------------------------ */

/**
 * Inline results work in chats the bot was never added to, write nothing and know nothing about who
 * asked. That combination is why they carry the eligibility and not-advice lines in the body: they
 * land where the bot's description was never read.
 */
async function handleInline(surface: Surface, tg: Telegram, update: TgUpdate): Promise<Response> {
  const query = update.inline_query;
  if (!query) return webhookAck();
  // An inline query can also contain a gift secret; never forward it as an upstream search.
  if (inspectForClaim(query.query).kind === "key-present") {
    await tg.answerInlineQuery(query.id, [], 0);
    return webhookAck();
  }

  const verdict = await meter("inline", String(query.from.id), LIMITS.command);
  if (!verdict.allowed) {
    await tg.answerInlineQuery(query.id, []);
    return webhookAck();
  }

  const results =
    surface === "bstocks" ? await inlineStocks(query.query) : await inlineTokens(query.query);
  await tg.answerInlineQuery(query.id, results, 60);
  return webhookAck();
}

async function inlineStocks(raw: string): Promise<unknown[]> {
  const stocks = await listStocks();
  const query = raw.trim().replace(/^\$+/, "").toUpperCase();
  const matched = query
    ? stocks.filter((s) => s.symbol.toUpperCase().includes(query) || s.name.toUpperCase().includes(query))
    : stocks;
  // An inline result lands in a chat where nobody read the bot's description, so this is the one
  // place the full notice still travels with the card.
  return matched.slice(0, 20).map((s) => {
    const card = stockCard(s);
    const text = `${card.text}\n\n<i>${esc(COPY.bstocks.footer)}</i>`;
    return {
      type: "article",
      id: s.address,
      title: `${s.symbol} · ${s.dexPriceUsd === null ? "—" : `$${s.dexPriceUsd.toFixed(2)}`}`,
      description: `${s.name} · ${s.status.label}`,
      thumbnail_url: s.logoUrl,
      input_message_content: { message_text: text, parse_mode: "HTML" },
      reply_markup: card.keyboard ? { inline_keyboard: card.keyboard } : undefined,
    };
  });
}

async function inlineTokens(raw: string): Promise<unknown[]> {
  const page = await listMarkets({ q: raw.trim().slice(0, 64) || undefined, limit: 20, orderBy: "volume24h" });
  return (page?.markets ?? []).map((m) => {
    const card = tokenCard(m);
    const text = `${card.text}\n\n<i>${esc(COPY.launchpad.footer)}</i>`;
    return {
      type: "article",
      id: m.token,
      title: `${m.symbol} · ${m.priceUsd === null ? "—" : `$${m.priceUsd.toFixed(6)}`}`,
      description: `${m.name} · paired with ${m.stock.ticker} · ${m.holders} holders`,
      input_message_content: { message_text: text, parse_mode: "HTML" },
      reply_markup: card.keyboard ? { inline_keyboard: card.keyboard } : undefined,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Membership
 * ------------------------------------------------------------------ */

async function handleMembership(surface: Surface, tg: Telegram, update: TgUpdate): Promise<Response> {
  const event = update.my_chat_member;
  if (!event) return webhookAck();
  const status = event.new_chat_member.status;
  if (status !== "member" && status !== "administrator") return webhookAck();
  if (event.chat.type === "private") return webhookAck();

  await tg.sendMessage({
    chat_id: event.chat.id,
    text: [
      b(`${COPY[surface].name} bot`),
      "",
      esc("Added. I answer slash commands here and nothing else: I do not read ordinary messages, I never answer with anybody's wallet or balances in a group, and I cannot sign anything."),
      "",
      esc("/help lists what I can do."),
    ].join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  return webhookAck();
}

/* ------------------------------------------------------------------ *
 * Assistant bridge
 * ------------------------------------------------------------------ */

/**
 * Free text, answered by the BStocks assistant.
 *
 * Off unless `ASSISTANT_ENABLED` is set, and for a reason worth writing down: that endpoint meters
 * by request IP, so behind a webhook every Telegram user on earth would share this deployment's
 * bucket and one person could spend the website's daily allowance. Until it can be told who is
 * asking, this stays a deliberate opt-in with its own per-user cap on top.
 *
 * The turn can take most of a minute, which is longer than a webhook should hold, so the response
 * is acknowledged first and the answer arrives as its own message.
 */
async function assistantReply(tg: Telegram, message: TgMessage): Promise<Response> {
  const identity = String(message.from?.id ?? message.chat.id);
  const verdict = await meter("ai", identity, LIMITS.assistant);
  if (!verdict.allowed) {
    return reply(message, { text: esc("That is a lot of questions in a minute. Give it a moment."), preview: { is_disabled: true } });
  }
  const daily = await meter("ai-day", identity, { limit: env().ASSISTANT_DAILY_LIMIT_PER_USER, windowSec: 86_400 });
  if (!daily.allowed) {
    return reply(message, { text: esc("You have reached today's limit for questions. Everything still works in the app."), preview: { is_disabled: true } });
  }

  const question = (message.text ?? "").slice(0, 1_000);
  after(async () => {
    // A placeholder first, edited into the answer. The typing bubble lapses after about five
    // seconds and a turn can run for forty, so on its own it leaves the chat looking dead.
    const placeholder = await tg.sendAndTrack({
      chat_id: message.chat.id,
      message_thread_id: message.message_thread_id,
      text: THINKING,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    const history = await loadHistory(message.chat.id);
    const answer = await askAssistant([...history, { role: "user", content: question }]);

    const text = answer.refusal ? refusalCard(answer.refusal) : assistantCard(answer.reply, answer.actions);
    const buttons = answer.refusal ? [] : actionButtons(answer.actions, message.chat.type === "private");
    if (!answer.refusal) await appendTurns(message.chat.id, question, answer.reply);

    const payload = {
      chat_id: message.chat.id,
      text,
      parse_mode: "HTML" as const,
      link_preview_options: { is_disabled: true },
      reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    };

    // Editing keeps one message where a person is already looking. If the placeholder never landed
    // there is nothing to edit, so the answer arrives on its own.
    if (placeholder !== null) await tg.editMessageText({ ...payload, message_id: placeholder });
    else await tg.sendMessage({ ...payload, message_thread_id: message.message_thread_id });
  });
  return webhookAck();
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

/**
 * A tap on an inline button.
 *
 * Two things have to happen and only one of them can ride the webhook response, so the spinner is
 * stopped with a real call and the card itself is returned as the body. Navigation edits the
 * message that was tapped rather than adding another one below it, which is what makes a chat feel
 * like a screen instead of a transcript.
 */
async function handleCallback(surface: Surface, tg: Telegram, update: TgUpdate): Promise<Response> {
  const query = update.callback_query;
  if (!query) return webhookAck();

  let action = decode(query.data);
  const message = query.message;
  if (!action || (!message && !query.inline_message_id) || (message && message.date === 0)) {
    await tg.answerCallback(query.id, UI.callbackUnavailable);
    return webhookAck();
  }

  const publicKinds = new Set(["markets", "price", "buy", "sell", "news", "help", "menu", "stats", "status", "earn", "baskets", "gift", "pools", "top", "new", "token", "confirm", "dca", "plan", "cancel"]);
  if (!message && !publicKinds.has(action.kind)) {
    await tg.answerCallback(query.id, UI.privateOnly);
    return webhookAck();
  }
  const bstocksOnly = new Set(["price", "markets", "news", "stats", "status", "earn", "baskets", "gift", "pools", "dca", "plan", "watch", "unwatch", "watchlist", "portfolio", "wallet", "activity", "settings"]);
  if ((surface === "launchpad" && bstocksOnly.has(action.kind)) || (surface === "bstocks" && ["top", "new", "token"].includes(action.kind))) {
    await tg.answerCallback(query.id, UI.callbackUnavailable);
    return webhookAck();
  }

  const verdict = await meter("cb", String(query.from.id), LIMITS.command);
  if (!verdict.allowed) {
    await tg.answerCallback(query.id, "Please wait a moment before trying again.");
    return webhookAck();
  }
  await tg.answerCallback(query.id);

  if (action.kind === "confirm") {
    await confirmEligibility(query.from.id);
    action = action.next;
  }

  const ctx: Ctx = {
    surface,
    tg,
    // Inline messages may live in any chat; never infer that they are private from the clicker.
    chat: message?.chat ?? { id: 0, type: "group" },
    from: query.from,
    threadId: message?.message_thread_id,
    isPrivate: message?.chat.type === "private",
    args: "symbol" in action ? action.symbol ?? "" : "address" in action ? action.address ?? "" : "",
  };

  if (ctx.isPrivate) await setPrompt(surface, query.from.id, null);
  if (action.kind === "markets") ctx.args = `${action.sort ?? "move"} ${action.page ?? 0}`;

  const command =
    action.kind === "price"
      ? "price"
      : action.kind === "buy"
        ? "buy"
        : action.kind === "sell"
          ? "sell"
          : action.kind === "token"
            ? "token"
            : action.kind;

  let card: Card | null;
  if (action.kind === "plan") {
    const stocks = await listStocks();
    const { stock } = resolveStock(stocks, action.symbol);
    if (!stock) card = stocks.length ? notFound(action.symbol, []) : upstreamDown();
    else if (action.amount && action.days) {
      const cadence = Object.entries(CADENCE).find(([, value]) => value.days === action.days)?.[0];
      card = cadence ? await route("dca", { ...ctx, args: `${action.amount} ${stock.symbol} ${cadence}` }) : null;
    } else card = planCard(stocks, { ...action, symbol: stock.symbol });
  } else card = await route(command, ctx);
  if (!card) return webhookAck();
  if (!message) card = { ...card, text: `${card.text}\n\n<i>${esc(COPY[surface].footer)}</i>` };

  // Editing keeps one card on screen; a card that cannot be edited (a different shape, or a
  // message too old for Telegram to change) simply arrives as a new message instead.
  if (card.editable || !message) {
    const edited = await tg.editCard({
      ...(message ? { chat_id: message.chat.id, message_id: message.message_id } : { inline_message_id: query.inline_message_id }),
      text: card.text,
      link_preview_options: card.preview ?? { is_disabled: true },
      reply_markup: { inline_keyboard: card.keyboard ?? [] },
    });
    if (edited) return webhookAck();
  }
  return message ? reply(message, card) : webhookAck();
}

/* ------------------------------------------------------------------ *
 * Replies
 * ------------------------------------------------------------------ */

/**
 * Answers by putting the method call in the webhook's own response body.
 *
 * That is one HTTP round trip instead of two, which on a cold serverless instance is most of the
 * time a user waits. The trade Telegram documents is that the result is invisible, which is fine
 * for a reply and is why long work uses `after` and a real send instead.
 */
function reply(message: TgMessage, card: Card): Response {
  const params: SendMessageParams = {
    chat_id: message.chat.id,
    text: card.text,
    parse_mode: "HTML",
    // A forum group routes by topic. Without this the reply lands in General and the bot gets
    // removed, which is the cheapest avoidable mistake on this platform.
    message_thread_id: message.message_thread_id,
    link_preview_options: card.preview ?? { is_disabled: true },
    reply_markup: card.replyKeyboard ?? (card.keyboard ? { inline_keyboard: card.keyboard } : undefined),
  };
  return webhookReply(params);
}

function upstreamDown(): Card {
  return {
    text: esc("I could not read the app just now. That is usually brief; try again in a moment."),
    preview: { is_disabled: true },
  };
}

function notFound(query: string, suggestions: V1Stock[]): Card {
  const lines = [esc(`I do not have a stock called "${query.slice(0, 32)}".`)];
  if (suggestions.length > 0) {
    lines.push("", `${esc("Did you mean")} ${b(suggestions.map((s) => s.symbol).join(", "))}?`);
  } else {
    lines.push("", esc("/markets lists everything I know about."));
  }
  return { text: lines.join("\n"), keyboard: suggestions.length ? [suggestions.map((stock) => ({ text: stock.symbol, callback_data: encode({ kind: "price", symbol: stock.symbol }) }))] : [[{ text: "Browse markets", callback_data: "m" }]], preview: { is_disabled: true } };
}

