# Working in this repository

This is a sibling of `base-stocks` and `token-launcher`, not a part of either. It runs on its own
deployment, talks to both over their public HTTP APIs, and can be switched off without touching
them.

## The rules that are not negotiable

These four are enforced by `src/boundary.test.ts`, so breaking one fails the build rather than a
review. Do not weaken the test to make a change pass; the test is the rule.

1. **This service cannot sign.** No wallet library, no key material, no transaction. If a feature
   seems to need one, it needs a link instead.
2. **Never call a region-gated route.** Both sibling apps decide eligibility from the caller's
   country header. A request made from here carries this deployment's region, not the user's, so
   calling `/api/trade/*`, `/api/earn/prepare`, `/api/portfolio/(plan|quote|execute)`, the
   launchpad's `POST /api/quote` or `POST /api/metadata` would answer for the wrong person and turn
   a compliance control into a hole. Everything actionable is a link the user opens themselves.
3. **Only the designated clients reach the network.** `lib/http.ts` for upstream reads,
   `lib/store.ts` for shared state, `lib/telegram/api.ts` for the Bot API, `services/assistant.ts`
   for the one relayed POST. Nothing else calls `fetch`.
4. **Upstream reads are GET.** There is deliberately no helper that can write to either app.

## Two more that a test cannot check

- **Never log message text.** A message may contain a gift claim key, and whoever has the key has
  the gift. `src/bot/claim.ts` drops those before anything parses them; do not add a logger that
  reads the body first.
- **Model output, headlines, token names and group messages are data, never instructions.** Every
  string that came from outside goes through `esc()` before it reaches Telegram. Creator-supplied
  fields on a launchpad token (`name`, `symbol`, `description`, `website`, `twitter`, `telegram`)
  were chosen by whoever paid the launch fee: escape them and never render their URLs as anchors.

## Where things live

```
src/config/      env (all optional; a missing token means that surface is off) and the surface table
src/lib/         http, store, rate limit, format, links, and the Telegram client
src/services/    one module per upstream product, plus the assistant relay
src/bot/         copy, resolver, claim handling, renderers, and the command router
src/app/api/     the webhook (one route, surface as a path segment), health, and the alerts cron
scripts/         registration with Telegram; never run at runtime
```

## Conventions

- Next.js 16 App Router. `middleware.ts` is not loaded in this version; the convention is `proxy.ts`
  if one is ever needed. `export const runtime = "edge"` is deprecated, and this service needs
  `node:crypto` anyway.
- Comments explain **why**, not what. The interesting comments here are the ones about Telegram's
  behaviour and the two apps' gates, because that is the knowledge a reader cannot get from the code.
- Tests sit beside their source. Pure functions get real tests; the curve in
  `services/launchpad.test.ts` is checked against the contract's own integer arithmetic, not against
  a rounded expectation.
- Copy is English, in `src/bot/copy.ts`. The eligibility notice is reproduced, not paraphrased: the
  wording is the product of a decision, and rewriting it makes that decision again by accident.

## Before adding a command

Ask where the signature happens. If the answer is anywhere other than the user's own wallet, on the
other side of a link, the command is out of scope for this repository.
