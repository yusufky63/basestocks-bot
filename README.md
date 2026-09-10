# BaseStocks Bot

Telegram bots for [basestocks.finance](https://basestocks.finance) and the
[BaseStocks Launchpad](https://launchpad.basestocks.finance). A separate product from both, and
deliberately so: neither app has to grow a chat transport, and this one can be redeployed, rate
limited or switched off without touching either.

It reads their public APIs and hands every action back as a link the user opens in their own wallet.
It holds no keys, no funds and no wallet library, and it cannot sign, approve or move anything.

## What it does

**BaseStocks handle**

| Command | Answers with |
| --- | --- |
| `/price NVDA` | DEX price, the Chainlink reference with its freshness, liquidity, 24h volume, trading status, and the multiplier when one token is no longer one share |
| `/markets` | Every listed stock by 24h move, each ticker tappable |
| `/search NVIDIA` or `NVDA` | Find a stock without enabling the assistant |
| `/watch NVDA`, `/watchlist`, `/unwatch NVDA` | A private list of up to 24 stocks, stored by canonical address |
| `/wallet`, `/portfolio` | Holdings, value, USDC, Earn and liquidity for a wallet you name |
| `/activity` | Public activity for the saved wallet, with confirmation labels and explorer links |
| `/buy`, `/sell` | Opens the trade panel in an app that has a wallet. See below |
| `/dca 25 NVDA weekly` | A link that opens the plan wizard already filled in |
| `/dca` | Ticker → amount → cadence buttons, then a review link into the same wizard |
| `/baskets` | Starter templates, with the mix spelled out |
| `/earn` | Where idle USDC earns, with the venues that did not answer named |
| `/news NVDA` | Headlines for one stock or the ecosystem. Titles and links only |
| `/gift`, `/pools` | Gifting and open gift pools |
| `/stats`, `/status` | Verified activity, and what is up |
| `/settings`, `/cancel`, `/clearwatchlist` | Saved-data controls, cancel an input step, clear saved stocks |
| free text | The app's own assistant. Say what you want and a drafted trade comes back as a button |
| a pasted claim link | Explains what it is. A message containing a claim **key** is dropped unread |

Deep links open the bot on the thing a link was about rather than on a greeting:
`t.me/<bot>?start=stock_NVDA`, `buy_TSLA`, `token_0x…`, `wallet_0x…`. Anything else, including the
`src_*` attribution tags, falls through to the welcome.

**Launchpad handle**

| Command | Answers with |
| --- | --- |
| `/top`, `/new` | Ranked lists, marking anything still inside its twenty second anti-snipe window |
| `/token 0x…` | Price, FDV, holders, volume, creator, the paired stock, and the fee right now |
| `/search doge` | Name or symbol match |
| `/launch Name SYM NVDA` | A prefilled create link. The pin and the signature stay with the user |

Both handles answer inline queries (`@bot NVDA`), which work in chats the bot was never added to.

## Nothing has to be typed

A bot that only answers slash commands is a command line with a worse font. Three things fix that,
none of which needs a Mini App.

- **A persistent keyboard** puts Markets, Watchlist, Portfolio, News, Menu and Help one tap away.
  The inline menu also exposes Earn, baskets, recurring plans, gifts, stats, status and settings.
- **Inline buttons carry the next step.** A price card offers Buy and Sell, the markets table makes
  every ticker tappable, a launchpad list makes every token tappable, and a tap edits the message
  that was tapped rather than piling another one underneath it. Market pages show nine stocks,
  with move/volume/alphabetical sorting and refresh controls. Failed edits fall back to a fresh
  message; an unchanged refresh does not duplicate a card. Shared inline cards use Telegram's
  `inline_message_id` and never expose personal data or private-chat-only buttons.
- **Free text reaches the assistant with its drafts intact.** "buy fifty dollars of NVDA" comes back
  as a button, because the endpoint returns a typed action whose address was resolved server-side
  from validated tool input. This service never reads an address out of model output, and the button
  opens a page rather than placing an order.

`callback_data` is parsed as strictly as anything else arriving from a chat: a short verb, a colon,
one argument, and anything unrecognised becomes null rather than a best guess. Telegram allows 64
bytes and a token address is 42 of them, which `src/bot/nav.test.ts` holds it to.

`/wallet` and `/search` accept the next private message as input for ten minutes. `/cancel`, a menu
button or another command exits that input step. A pasted address previews public holdings without
saving it; saving requires the wallet step or `/wallet <address>`. Invalid explicit addresses never
fall back to a different saved wallet. Plan links reject missing stocks, duplicate resolved addresses,
more than twelve legs, and allocations below BaseStocks' $1 per-leg minimum.

## Reading happens in Telegram, signing happens in the wallet

The obvious design is a `web_app` button: render the site inside Telegram and let the wallet connect
there. It was built, tested on a phone, and it does not work. Telegram's WebView has no injected
provider, a passkey cannot open the popup it needs, and a WalletConnect round trip out to a wallet
app returns to a session that no longer exists.

So a trade goes the other way. The button opens [`/open`](src/app/open/page.tsx), one page on this
service's own domain, which offers the jump into an app that already has a wallet:

| Option | Why |
| --- | --- |
| **Base app** (`cbwallet://miniapp?url=…`) | BStocks is already built as a Base mini app, with the host wallet connected on arrival. This is the path the app was designed for, not a workaround |
| **MetaMask** (`metamask.app.link/dapp/…`) | Its own browser, provider injected |
| **This browser** | Works for an extension wallet or a passkey |

The page exists because Telegram accepts only http(s) in a button, so a custom scheme cannot be the
button. It offers a tap rather than redirecting, because a scheme jump without a gesture is blocked
in some webviews and then silently does nothing.

Read-only pages still open inside Telegram, where a WebView is fine. `/open` takes a path and offers
to open it, so its allowlist is a security boundary rather than a convenience, and
`src/lib/handoff.test.ts` treats it as one.

## The eligibility notice, asked once

The website decides eligibility from the request's country header. A webhook carries Telegram's
datacenter instead, so that gate does not fail closed here, it silently passes: this bot cannot know
where anyone is.

So the sentence no longer trails every card. It appears where somebody is meeting the bot (`/start`,
`/help`, an inline result landing in a chat that saw neither) and in front of a trade, as a question
with a button. Confirming authorises nothing: the site checks the region again when the link is
opened, from the user's own request, and refuses there if it must. What is stored is one expiring
boolean under an opaque key, with no address, no name and no country in it.

Without `UPSTASH_REDIS_REST_URL` the confirmation lives in process memory, so a cold instance asks
again. That is mildly annoying and never wrong in the unsafe direction; configure the shared store
if the repetition bothers people.

## The twenty second rule

`StockPairHook` charges 9,900 basis points of the stock side at launch and decays linearly to 100
over twenty seconds. A pool is live from its first block, so a token can always be traded; what
changes is the price of doing it.

| Elapsed | Fee |
| --- | --- |
| 0s | 99% |
| 5s | 74.5% |
| 10s | 50% |
| 15s | 25.5% |
| 20s and after | 1% |

Every launchpad card shows the countdown, and the trade button says how long is left rather than
inviting a tap. `src/services/launchpad.test.ts` checks the curve against the contract's own integer
arithmetic at every second.

One more thing the bot says out loud: these pools quote in the paired stock, so buying a launchpad
token needs that tokenized stock in the wallet first. There is no USDC or ETH route in.

## Setup

```bash
pnpm install
cp .env.example .env
node scripts/setup-telegram.mjs secret     # once per handle, into .env
pnpm dev
```

Then register each handle against a public HTTPS URL:

```bash
node scripts/setup-telegram.mjs bstocks
node scripts/setup-telegram.mjs launchpad
```

That sets the webhook with its secret token and an explicit `allowed_updates` list, and publishes
the command menu for default, private and group scopes, the bot name, description and short description.
Preview all registration changes locally, without contacting Telegram or requiring tokens:

```bash
node scripts/setup-telegram.mjs bstocks --dry-run
node scripts/setup-telegram.mjs launchpad --dry-run
```

Keep `BOT_URL` and `APP_URL` on the same public origin. Optional `TELEGRAM_BSTOCKS_USERNAME` and
`TELEGRAM_LAUNCHPAD_USERNAME` omit the `@`; otherwise the bot obtains its own username with `getMe`
before handling an addressed command. Commands addressed to other bots are ignored.

Inline mode is a BotFather setting (`/setinline`),
not an API call.

To stop delivery immediately, without a redeploy:

```bash
node scripts/setup-telegram.mjs delete bstocks
```

## Deploying

Vercel, Next.js preset, Node 22. Set the variables from [.env.example](.env.example) and
`APP_URL` to the deployed origin, then run the registration script once against it. `vercel.json`
schedules `/api/cron/alerts`, which reads BStocks' health endpoint and posts anything it finds to
the operator's private chat, once per distinct alert per hour.

`/api/health` reports which surfaces this instance answers for and which features are configured.
It names no token, no chat and no user.

## How it is built

Next.js 16 App Router, TypeScript strict, Zod, and nothing else. No bot framework: grammY and
telegraf both want to own the process with a dispatcher, a session store and long polling, and this
is a serverless webhook that answers one update and exits. What it needed from a library was a typed
`sendMessage` and a 429 that respects `retry_after`, which is `src/lib/telegram/api.ts`.

A few decisions worth knowing before changing anything:

- **Replies ride the webhook response.** A simple answer is returned as `{"method":"sendMessage",…}`
  in the webhook's own response body, which is one HTTP round trip instead of two. Long work uses
  `after()` and a real send, because the response-as-method form cannot tell you whether it worked.
- **HTML, not MarkdownV2.** Three characters to escape instead of eighteen, and one miss rejects the
  whole message rather than mangling a word.
- **Link previews, not photos.** `link_preview_options` renders the app's own share card while
  keeping the full 4,096 character budget that a photo caption would cut to 1,024.
- **Forum topics.** Every reply carries `message_thread_id` back. A bot that answers in General gets
  removed from a forum group, and retrofitting the column means re-asking every group.
- **Metering is keyed on the Telegram user.** Behind a webhook every update on earth arrives from
  Telegram's datacenter, so an IP-keyed limiter would put everyone in one bucket.

## Boundaries

`src/boundary.test.ts` fails the build on three things a code review would eventually miss:

1. No wallet or signing library, in `package.json` or in an import, and no key material by any of
   the usual names.
2. No reference to a route either sibling app gates on the caller's country
   (`/api/trade/*`, `/api/earn/prepare`, `/api/portfolio/(plan|quote|execute)`, `/api/quote`,
   `/api/metadata`). A call from here would carry this deployment's region instead of the user's and
   answer for the wrong person. Everything actionable is a link, opened by the user, whose own
   request runs the gate normally.
3. Only `lib/http.ts`, `lib/store.ts`, `lib/telegram/api.ts` and `services/assistant.ts` call
   `fetch`, and upstream reads are GET.

## Scripts

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

## Not built yet

`/chart` (a rendered candle image), launch alerts pushed from the launchpad indexer, wallet linking
with cryptographic proof, notification preferences and plan alerts. `/me` already reads the saved
wallet bookmark; it is not authenticated wallet linking. The `/open` Mini App is a wallet handoff,
not a wallet or trading engine. AI conversation remains opt-in because the current BaseStocks
assistant meters unauthenticated callers by IP.

See [the integration notes](docs/telegram-integration.md) for the verified API contract, Telegram
documentation and the scope of local, live and browser checks.
