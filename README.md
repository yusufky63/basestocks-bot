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
| `/markets` | Every listed stock by 24h move, liquidity beside each row |
| `/open NVDA` | A link that opens that stock's trade panel |
| `/dca 25 NVDA weekly` | A link that opens the plan wizard already filled in |
| `/stats` | What has been done through the app, counted from verified receipts |
| free text | The app's own assistant, in private chats. Say what you want in your own words and a drafted trade comes back as a button |
| a pasted claim link | Explains what it is. A message containing a claim **key** is dropped unread |

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

- **A persistent keyboard** replaces the phone keyboard in a private chat, so Markets, Stats and
  Help are one thumb away. Labels map back to commands in `src/bot/nav.ts`, next to the labels.
- **Inline buttons carry the next step.** A price card offers Buy and Sell, the markets table makes
  every ticker tappable, a launchpad list makes every token tappable, and a tap edits the message
  that was tapped rather than piling another one underneath it.
- **Free text reaches the assistant with its drafts intact.** "buy fifty dollars of NVDA" comes back
  as a button, because the endpoint returns a typed action whose address was resolved server-side
  from validated tool input. This service never reads an address out of model output, and the button
  opens a page rather than placing an order.

`callback_data` is parsed as strictly as anything else arriving from a chat: a short verb, a colon,
one argument, and anything unrecognised becomes null rather than a best guess. Telegram allows 64
bytes and a token address is 42 of them, which `src/bot/nav.test.ts` holds it to.

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
the command menu for private and group scopes. Inline mode is a BotFather setting (`/setinline`),
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
and anything that follows from it (`/me`, notification preferences, plan alerts), and the Telegram
Mini App. The Mini App is the one with a real prerequisite: the launchpad currently sends
`X-Frame-Options: DENY`, which Telegram Web and Desktop cannot embed, and a wallet inside a Telegram
WebView needs WalletConnect since there is no injected provider there.
