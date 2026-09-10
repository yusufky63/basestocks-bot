import type { Surface } from "@/config/surfaces";
import commandData from "./commands.data.json";

/**
 * Everything the bot says about itself, per surface.
 *
 * Two handles exist because these two paragraphs cannot be the same paragraph. One describes a
 * restricted instrument offered only to eligible persons outside the United States; the other
 * describes permissionless community tokens anyone can launch for a fraction of a cent. Telegram's
 * only mute granularity is the chat, so a shared handle would also force a user to choose between
 * launch alerts and anything else the bot ever tells them.
 */

/**
 * Reproduced rather than paraphrased. The wording on the eligibility notice is the product of a
 * decision, and a bot that rewrites it in its own words is making that decision again by accident.
 */
export const ELIGIBILITY_NOTE =
  "Coinbase Tokenized Stocks are offered only to eligible persons outside the United States.";

export const NOT_ADVICE_NOTE = "Public chain data, not investment advice. Prices and rates change.";

export const SEPARATE_PRODUCT_NOTE =
  "Community tokens paired against a tokenized stock. Separate product, separate risks.";

export interface SurfaceCopy {
  name: string;
  start: string;
  help: string;
  /**
   * The full notice. It appears where somebody is meeting the bot for the first time (`/start`,
   * `/help`, an inline result in a chat that never saw either) and in front of a trade, not under
   * every price. A disclaimer repeated on every message is a disclaimer nobody reads.
   */
  footer: string;
}

const SAFETY =
  "This bot never messages you first, never asks for a private key, a seed phrase or a recovery code, and never asks you to verify or reconnect a wallet. It cannot sign, approve or move anything: every action opens as a link you confirm in your own wallet.";

export const COPY: Record<Surface, SurfaceCopy> = {
  bstocks: {
    name: "BaseStocks",
    start: [
      "<b>BaseStocks</b>",
      "",
      "Live prices for Coinbase Tokenized Stocks on Base, and a link into the app whenever you want to act.",
      "",
      "<b>Try</b>",
      "/price NVDA — price, reference and liquidity",
      "/markets — every listed stock by 24h move",
      "/buy NVDA — open the trade panel, ready to buy",
      "/dca 25 NVDA weekly — build a recurring plan link",
      "",
      SAFETY,
      "",
      ELIGIBILITY_NOTE,
    ].join("\n"),
    help: [
      "<b>Commands</b>",
      "",
      "/price &lt;ticker&gt; — DEX price, Chainlink reference with its freshness, liquidity, 24h volume and trading status",
      "/markets — all listed stocks sorted by 24h move",
      "/buy &lt;ticker&gt; and /sell &lt;ticker&gt; — a link that opens that stock's trade panel on the right side. I only build the link; the quote, the eligibility check and the signature all happen in the app, on your own request",
      "/dca &lt;usd&gt; &lt;ticker[,ticker]&gt; &lt;weekly|monthly&gt; — a link that opens the plan wizard already filled in",
      "/stats — what has been done through the app, counted from verified receipts",
      "",
      "In a group, mention the bot or reply to it. Personal answers only happen in a private chat.",
      "",
      SAFETY,
    ].join("\n"),
    footer: `${ELIGIBILITY_NOTE} ${NOT_ADVICE_NOTE}`,
  },
  launchpad: {
    name: "BaseStocks Launchpad",
    start: [
      "<b>BaseStocks Launchpad</b>",
      "",
      "Tokens on Base that trade against a Coinbase tokenized stock in a permanently locked pool.",
      "",
      "<b>Try</b>",
      "/top — biggest 24h volume",
      "/new — latest launches",
      "/token &lt;address&gt; — one token's card",
      "/buy &lt;address&gt; — the same card, with the current fee on the button",
      "/search &lt;text&gt; — find a token",
      "",
      "<b>Read this before buying anything</b>",
      "Every pool charges 99% of the stock side in its first second and decays to 1% over twenty seconds. Buying early is not early access, it is a 99% fee. The bot shows the countdown on every card.",
      "",
      "Buying also needs the paired tokenized stock in your wallet first. There is no USDC or ETH route into these pools.",
      "",
      SAFETY,
    ].join("\n"),
    help: [
      "<b>Commands</b>",
      "",
      "/top [n] — tokens by 24h traded value. Volume is trivially wash traded, read it as attention, not as quality",
      "/new [n] — most recent launches, with the anti snipe countdown",
      "/token, /buy, /sell &lt;address&gt; — price, FDV, holders, volume, creator and the fee right now",
      "/search &lt;text&gt; — name or symbol match",
      "/launch — collects a name, a symbol and a stock, then hands you a prefilled create link",
      "",
      SEPARATE_PRODUCT_NOTE,
      "",
      SAFETY,
    ].join("\n"),
    footer: `${SEPARATE_PRODUCT_NOTE} ${NOT_ADVICE_NOTE}`,
  },
};

/**
 * What `setMyCommands` publishes, per surface.
 *
 * The list lives in `commands.data.json` because two readers need it: this module, and the
 * registration script, which is plain JavaScript and cannot import TypeScript. One file means the
 * menu Telegram shows and the router that answers cannot drift apart.
 *
 * A scope hides an entry from a group's menu; it does not refuse the command, so the router still
 * checks the chat type itself.
 */
export const COMMANDS: Record<Surface, { command: string; description: string }[]> = commandData;
