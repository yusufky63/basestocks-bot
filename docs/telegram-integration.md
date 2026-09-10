# Telegram integration

Reviewed against the sibling `C:\Projeler\base-stocks` source and official Telegram documentation on 2026-09-10.

## BaseStocks contract

| Bot feature | Public GET or user-opened page | Contract checked in BaseStocks |
| --- | --- | --- |
| Stock cards and search | `/api/v1/stocks` | `data.stocks`, canonical address, status, DEX/reference prices |
| Portfolio | `/api/v1/portfolio/:address` | `data.holdings`, scaled `shares`, `decimals`, USDC, Earn and liquidity |
| Wallet names | `/api/basename/resolve`, `/api/basename/reverse` | `resolved.address` and `name`; unresolved input is not another wallet |
| Activity | `/api/activity/:address` | `items`, Unix-second timestamps, receipt verification and transaction hashes |
| News, Earn | `/api/v1/news`, `/api/v1/earn` | Public envelopes used by the existing clients |
| Templates, pools | `/api/templates`, `/api/pools` | App read routes; expired, closed and exhausted pools are omitted |
| Buy / sell | `/stocks/:address?trade=buy` or `sell` | Existing stock panel query |
| Recurring plan | `/automate?legs=address:bps,...&usd=25&cadence=7&name=...` | `AutomateView`, `parseAutomateLegs`, 12-leg maximum and $1 per-leg minimum |
| Baskets, gifts, Earn | `/build/:template`, `/gifts`, `/pools/:id`, `/earn` | Existing pages, opened through the wallet handoff |

All transaction preparation, eligibility enforcement and signatures remain on the website reached
by the user's own device. The unchanged `src/boundary.test.ts` enforces the bot's network and signing
boundaries. No changes to the sibling application are required for these features.

The bot watchlist is a Telegram preference, separate from the website's authenticated watchlist.
It is not presented as a synced website account. Wallet bookmarks and favorites expire after 180
days; prompts expire after ten minutes. Shared state is used when configured, otherwise it is local
to the running process. Redis watchlist mutations are atomic; NX collisions do not fall back to
processing an already claimed update. Failed shared writes are not reported as saved wallets.

## Telegram behavior

- [Inline keyboards](https://core.telegram.org/bots/api#inlinekeyboardbutton): one action per button,
  1–64 bytes of callback data, private-only `web_app` buttons and native primary/success/danger styles.
- [Editing messages](https://core.telegram.org/bots/api#editmessagetext): ordinary cards use chat and
  message IDs; shared inline cards use `inline_message_id`. Every callback is acknowledged, unchanged
  edits count as success, and an ordinary failed edit falls back to a new message.
- [Deep linking](https://core.telegram.org/bots/features#deep-linking): strict start payloads retain
  the selected card's inline actions. Reply keyboards and inline keyboards are mutually exclusive.
- [Bot commands](https://core.telegram.org/bots/api#setmycommands): default, group and private menus
  share the same command definitions; private commands are also refused by the router in groups.
- [Mini Apps](https://core.telegram.org/bots/webapps): the wallet handoff preserves the Telegram theme,
  calls `ready`, and uses `openLink` only when actually launched inside Telegram. Anchors also work
  before JavaScript loads. The page never creates a transaction or accesses wallet credentials.

## Verification and release

Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`. Set `SKIP_LIVE_TESTS=true` for an
offline-only suite. The live suite reads upstream products; it does not send real Telegram messages.
Mocked webhook tests cover button flows, deep links, inline callbacks, group privacy, claim-key
filtering, wallet input, watchlists, activity and the exact DCA handoff fields.

Use the registration script's `--dry-run` option to review commands, scopes and profile text without
changing Telegram. After deployment, run it without that flag for each enabled handle. Keep
`BOT_URL` and `APP_URL` consistent. This development pass does not deploy or re-register live bots.

The full signing journey still requires device testing with Telegram and a supported installed
wallet. The bot itself cannot execute that test. AI conversation remains disabled by default until
the sibling assistant can meter a relayed user identity without trusting an arbitrary client header.
