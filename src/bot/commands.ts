import { after } from "next/server";
import type { Surface } from "@/config/surfaces";
import { env } from "@/config/env";
import { Telegram, webhookAck, webhookReply, type SendMessageParams } from "@/lib/telegram/api";
import type { TgChat, TgMessage, TgUpdate, TgUser } from "@/lib/telegram/types";
import { b, esc } from "@/lib/telegram/html";
import { LIMITS, meter } from "@/lib/rate-limit";
import { claimOnce } from "@/lib/store";
import { compactUsd, move, pad, usd } from "@/lib/format";
import { automateLink, evenLegs, launchpadCreateLink, stockLink } from "@/lib/links";
import { isTradable, listStocks, readStats, type V1Stock } from "@/services/bstocks";
import { listMarkets, listLaunchStocks, readToken, type Market } from "@/services/launchpad";
import { askAssistant } from "@/services/assistant";
import { KEYBOARD_ALIASES, actionButtons, decode, menuCard, replyKeyboard } from "./nav";
import { COPY } from "./copy";
import { CLAIM_HELP, KEY_WARNING, inspectForClaim } from "./claim";
import { isAddress, resolveStock, splitTickers } from "./resolve";
import { marketListCard, marketsCard, stockCard, tokenCard, type Card } from "./render";

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
  // A persistent-keyboard button sends its own label as ordinary text, so the label table is read
  // before anything else treats the message as prose.
  const parsed = parseCommand(text) ?? KEYBOARD_ALIASES[text.trim()] ?? null;

  if (!parsed) {
    if (claim.kind === "claim-link" && surface === "bstocks") {
      return reply(message, { text: CLAIM_HELP, preview: { is_disabled: true } });
    }
    // Free text is only ever answered in a private chat. In a group the bot speaks when spoken to,
    // and it is never given a stranger's message as an instruction.
    if (isPrivate && env().ASSISTANT_ENABLED) return assistantReply(tg, message);
    return webhookAck();
  }

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

async function route(command: string, ctx: Ctx): Promise<Card | null> {
  const shared: Record<string, (c: Ctx) => Promise<Card> | Card> = {
    start: (c) => ({
      text: COPY[c.surface].start,
      preview: { is_disabled: true },
      // The one message where replacing the phone keyboard is worth the rows it costs.
      replyKeyboard: c.isPrivate ? replyKeyboard(c.surface) : undefined,
    }),
    menu: (c) => {
      const card = menuCard(c.surface);
      return { text: card.text, keyboard: card.keyboard, preview: { is_disabled: true }, editable: true };
    },
    help: (c) => ({ text: COPY[c.surface].help, preview: { is_disabled: true } }),
  };
  const table = ctx.surface === "bstocks" ? BSTOCKS_COMMANDS : LAUNCHPAD_COMMANDS;
  const handler = shared[command] ?? table[command];
  if (!handler) {
    // Silence in a group: an unknown slash command is usually meant for a different bot.
    if (!ctx.isPrivate) return null;
    return { text: COPY[ctx.surface].help, preview: { is_disabled: true } };
  }
  return handler(ctx);
}

/* ------------------------------------------------------------------ *
 * BStocks commands
 * ------------------------------------------------------------------ */

const BSTOCKS_COMMANDS: Record<string, (c: Ctx) => Promise<Card>> = {
  price: async (ctx) => {
    if (!ctx.args) return { text: esc("Which stock? Try /price NVDA"), preview: { is_disabled: true } };
    const stocks = await listStocks();
    if (stocks.length === 0) return upstreamDown();
    const { stock, suggestions } = resolveStock(stocks, ctx.args);
    if (!stock) return notFound(ctx.args, suggestions);
    return stockCard(stock);
  },

  markets: async () => {
    const stocks = await listStocks();
    if (stocks.length === 0) return upstreamDown();
    return marketsCard(stocks);
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
    const parsed = parseDca(ctx.args);
    if (!parsed) {
      return {
        text: [
          b("Build a recurring plan"),
          "",
          esc("Try /dca 25 NVDA weekly, or /dca 50 NVDA,TSLA,AAPL monthly."),
          "",
          esc("I only build the link. The plan itself is created and signed by you in the app, and you can pause, cancel or revoke it at any time."),
        ].join("\n"),
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
    if (resolved.length === 0) return notFound(parsed.tickers.join(", "), []);

    const href = automateLink(evenLegs(resolved.map((s) => s.address)), {
      usd: parsed.usd,
      cadenceDays: parsed.cadenceDays,
      name: resolved.length === 1 ? `${resolved[0]?.symbol} plan` : "Basket plan",
    });

    const lines = [
      b("Recurring plan"),
      "",
      `${esc(`$${parsed.usd} ${parsed.cadenceLabel}, split evenly across`)} ${b(resolved.map((s) => s.symbol).join(", "))}`,
    ];
    if (missing.length > 0) lines.push(`<i>${esc(`Not listed, left out: ${missing.join(", ")}`)}</i>`);
    lines.push(
      "",
      esc("The link opens the wizard already filled in. The contract enforces the amount, the cadence, the routes and the minimum you receive, and it can never sell."),
      "",
      `<i>${esc(COPY.bstocks.footer)}</i>`,
    );

    return {
      text: lines.join("\n"),
      keyboard: [[{ text: "Open the plan wizard", url: href }]],
      preview: { url: href, prefer_small_media: true },
    };
  },

  /**
   * Counted activity, over the window the app itself publishes.
   *
   * `/api/v1/stats` returns several windows; 7d is the one worth a chat message, because 24h on a
   * young product is usually a row of zeros that reads as "nothing works" rather than "quiet day".
   */
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

function numberOr(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "—";
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
  if (parts.length < 2) return null;
  const usd = Number(parts[0]?.replace(/^\$/, ""));
  if (!Number.isFinite(usd) || usd <= 0 || usd > 1_000_000) return null;
  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  const cadence = CADENCE[last];
  if (!cadence) return null;
  const tickers = splitTickers(parts.slice(1, -1).join(" "));
  if (tickers.length === 0) return null;
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
    return { text: esc(`Which stock? Try /${side} NVDA`), preview: { is_disabled: true } };
  }
  const stocks = await listStocks();
  if (stocks.length === 0) return upstreamDown();
  const { stock, suggestions } = resolveStock(stocks, ctx.args);
  if (!stock) return notFound(ctx.args, suggestions);

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

  lines.push("", `<i>${esc(COPY.bstocks.footer)}</i>`);

  return {
    text: lines.join("\n"),
    keyboard: [
      [
        { text: `${verb} ${stock.symbol}`, url: href },
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
    return tokenCard(market);
  },

  buy: (ctx) => tokenHandoff(ctx, "buy"),
  sell: (ctx) => tokenHandoff(ctx, "sell"),

  search: async (ctx) => {
    if (!ctx.args) return { text: esc("Search for what? Try /search doge"), preview: { is_disabled: true } };
    const page = await listMarkets({ q: ctx.args.slice(0, 64), limit: 10, orderBy: "volume24h" });
    if (!page) return upstreamDown();
    if (page.markets.length === 1 && page.markets[0]) return tokenCard(page.markets[0]);
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
        "",
        `<i>${esc(COPY.launchpad.footer)}</i>`,
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
  return tokenCard(market, Date.now(), side);
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
  const query = raw.trim().toUpperCase();
  const matched = query
    ? stocks.filter((s) => s.symbol.toUpperCase().includes(query) || s.name.toUpperCase().includes(query))
    : stocks;
  return matched.slice(0, 20).map((s) => {
    const card = stockCard(s);
    return {
      type: "article",
      id: s.address,
      title: `${s.symbol} · ${s.dexPriceUsd === null ? "—" : `$${s.dexPriceUsd.toFixed(2)}`}`,
      description: `${s.name} · ${s.status.label}`,
      thumbnail_url: s.logoUrl,
      input_message_content: { message_text: card.text, parse_mode: "HTML" },
      reply_markup: card.keyboard ? { inline_keyboard: card.keyboard } : undefined,
    };
  });
}

async function inlineTokens(raw: string): Promise<unknown[]> {
  const page = await listMarkets({ q: raw.trim().slice(0, 64) || undefined, limit: 20, orderBy: "volume24h" });
  return (page?.markets ?? []).map((m) => {
    const card = tokenCard(m);
    return {
      type: "article",
      id: m.token,
      title: `${m.symbol} · ${m.priceUsd === null ? "—" : `$${m.priceUsd.toFixed(6)}`}`,
      description: `${m.name} · paired with ${m.stock.ticker} · ${m.holders} holders`,
      input_message_content: { message_text: card.text, parse_mode: "HTML" },
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
    await tg.chatAction(message.chat.id, message.message_thread_id);
    const answer = await askAssistant([{ role: "user", content: question }]);

    if (answer.refusal) {
      await tg.sendMessage({
        chat_id: message.chat.id,
        message_thread_id: message.message_thread_id,
        text: esc(answer.refusal),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    // Model output is data. It is escaped without exception, exactly like a headline or a token
    // name, and the only links in the reply are the ones `actionButtons` built from typed fields.
    const buttons = actionButtons(answer.actions);
    await tg.sendMessage({
      chat_id: message.chat.id,
      message_thread_id: message.message_thread_id,
      text: `${esc(answer.reply)}\n\n<i>${esc(COPY.bstocks.footer)}</i>`,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    });
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

  await tg.answerCallback(query.id);

  const action = decode(query.data);
  const message = query.message;
  if (!action || !message) return webhookAck();

  const verdict = await meter("cb", String(query.from.id), LIMITS.command);
  if (!verdict.allowed) return webhookAck();

  const ctx: Ctx = {
    surface,
    tg,
    chat: message.chat,
    from: query.from,
    threadId: message.message_thread_id,
    isPrivate: message.chat.type === "private",
    args: "symbol" in action ? action.symbol : "address" in action ? action.address : "",
  };

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

  const card = await route(command, ctx);
  if (!card) return webhookAck();

  // Editing keeps one card on screen; a card that cannot be edited (a different shape, or a
  // message too old for Telegram to change) simply arrives as a new message instead.
  if (card.editable) {
    return Response.json({
      method: "editMessageText",
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: card.text,
      parse_mode: "HTML",
      link_preview_options: card.preview ?? { is_disabled: true },
      reply_markup: card.keyboard ? { inline_keyboard: card.keyboard } : undefined,
    });
  }
  return reply(message, card);
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
  return { text: lines.join("\n"), preview: { is_disabled: true } };
}

