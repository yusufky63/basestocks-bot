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

export const UI = {
  menu: "<b>BaseStocks · Your market desk</b>\n\nExplore stocks, keep your favorites close and check your portfolio. Tap a section below, or send a ticker such as <b>NVDA</b>.\n\nEvery transaction opens in your own wallet for review.",
  launchpadMenu: "<b>BaseStocks Launchpad</b>\n\nDiscover community tokens, inspect a pool and check its current launch fee. Tap below or paste a token address.",
  fallback: "Send a ticker such as NVDA, a company name, or choose a section below. /cancel leaves the current step.",
  privateOnly: "Open a private chat with me to use your wallet, watchlist and settings.",
  walletPrompt: "<b>Add a read-only wallet</b>\n\nSend an address or a Basename, for example <code>alice.base.eth</code>.\n\nThis saves a bookmark to public balances. It is not a login and authorizes nothing. /cancel leaves this step; /forget removes the bookmark.",
  searchPrompt: "<b>Find something</b>\n\nSend a ticker, company name or token address. /cancel leaves this step.",
  invalidWallet: "That wallet could not be resolved. Check the address or Basename and try again. Your saved wallet has not changed.",
  storageUnavailable: "Saved data could not be updated just now. Please try again shortly.",
  watchEmpty: "<b>Your watchlist</b>\n\nKeep the stocks you follow here. Open a stock and tap ☆ Watch, or send /watch NVDA. This list is private to your Telegram account.",
  watchFull: "The watchlist could not be updated. It may be full (24 stocks), or storage may be temporarily unavailable. Remove a stock with /unwatch or try again shortly.",
  settings: "<b>Your settings</b>\n\nWallet: /wallet to view or change your read-only bookmark; /forget to remove it.\nWatchlist: /watchlist to view; /clearwatchlist to clear.\nAssistant history: /reset to clear.\n\nWallet bookmarks and watchlists expire after 180 days. Input steps expire after 10 minutes. With no shared store, saved preferences may disappear on a restart.",
  planStock: "<b>Build a recurring plan · 1/3</b>\n\nChoose a stock. For a custom basket, send /dca 50 NVDA,TSLA weekly.",
  planAmount: "<b>Build a recurring plan · 2/3</b>\n\nChoose the USD amount per run. You can review it in BaseStocks before signing.",
  planCadence: "<b>Build a recurring plan · 3/3</b>\n\nChoose how often the plan should run.",
  planInvalid: "Use /dca 25 NVDA weekly or /dca 50 NVDA,TSLA monthly. Include 1–12 unique stocks and at least $1 per stock. Available schedules: daily, weekly, biweekly, monthly.",
  planMissing: "Some stocks could not be resolved. No plan link was created; check every ticker and try again.",
  planDuplicates: "Two entries resolve to the same stock. Use each stock once so the allocation stays clear.",
  activityEmpty: "No activity was returned for this wallet yet.",
  activityNote: "Public BaseStocks activity. Pending app records are not confirmed transactions.",
  callbackUnavailable: "This button is unavailable here. Open the bot privately and use /menu.",
  cancelled: "Step cancelled. Choose where to go next.",
} as const;

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
      // The assistant was built, deployed and working while /start listed six slash commands and
      // never mentioned it. People read a command list and learn there is a command list; nobody
      // types a sentence at something that has only ever shown them syntax. So the sentence comes
      // first and the commands come last.
      "Ask me anything about Coinbase Tokenized Stocks on Base. I read live prices, the news and, "
        + "once you tell me your wallet, what is in it. Say what you want done and I draft it for "
        + "you to sign in your own wallet.",
      "",
      "<b>Try saying</b>",
      "<i>what moved today</i>",
      "<i>buy fifty dollars of NVDA</i>",
      "<i>how is my portfolio doing</i>",
      "<i>should I be worried about TSLA</i>",
      "",
      "Commands work too when you know what you want: /price /markets /portfolio /help",
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
      "/wallet &lt;address or Basename&gt; and /portfolio — your holdings, value, USDC, Earn and liquidity. A bookmark, not a login: everything it shows is already public on Base, it proves nothing and it lets me do nothing on your behalf. /forget drops it",
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
export const COMMANDS: Record<Surface, { command: string; description: string }[]> = {
  bstocks: commandData.bstocks,
  launchpad: commandData.launchpad,
};
