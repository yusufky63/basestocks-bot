import { b, esc, link } from "@/lib/telegram/html";
import { ago, compactUsd, pad, padStart, pct } from "@/lib/format";
import { bstocksUrl } from "@/lib/links";
import type { Card } from "./render";
import type { EarnView, Headline, PoolEntry, StatusReport, Template } from "@/services/ecosystem";
import { encode } from "./nav";

/**
 * The rest of the app, rendered for a chat.
 *
 * Each of these is a read: a yield table, a headline list, a health check, a template. None of them
 * ends in a signature, so each carries a plain link into the app rather than the wallet handoff
 * that `/buy` uses.
 */

function i0(text: string): string {
  return `<i>${esc(text)}</i>`;
}

/* ------------------------------------------------------------------ *
 * Earn
 * ------------------------------------------------------------------ */

export function earnCard(view: EarnView): Card {
  const top = [...view.opportunities]
    .filter((o) => o.variableApyPct !== null)
    .sort((a, c) => (c.variableApyPct ?? 0) - (a.variableApyPct ?? 0))
    .slice(0, 8);

  if (top.length === 0) {
    return { text: [b("Earn"), "", esc("No venue is quoting a rate right now.")].join("\n"), preview: { is_disabled: true } };
  }

  const rows = top
    .map((o) => `${pad(o.title.slice(0, 22), 23)}${padStart(pct(o.variableApyPct, 2), 8)}${padStart(compactUsd(o.tvlUsd), 9)}  ${o.riskLabel}`)
    .join("\n");

  const lines = [
    b("Idle USDC"),
    `<pre>${esc(`${pad("venue", 23)}${padStart("apy", 8)}${padStart("tvl", 9)}  risk`)}\n${esc(rows)}</pre>`,
    i0("Variable rates, estimated from recent activity and not guaranteed. Discovered from the protocols at read time, never hardcoded."),
  ];
  // A venue that did not answer is not a venue with no yield, and saying so is cheaper than an
  // apology later.
  if (view.unavailableProviders.length > 0) {
    lines.push(i0(`Did not answer this scan: ${view.unavailableProviders.join(", ")}.`));
  }

  return {
    text: lines.join("\n"),
    keyboard: [[{ text: "Open Earn", url: bstocksUrl("/earn") }]],
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * News
 * ------------------------------------------------------------------ */

export function newsCard(items: Headline[], label: string): Card {
  if (items.length === 0) {
    return { text: [b(label), "", esc("Nothing on the wire right now.")].join("\n"), preview: { is_disabled: true } };
  }
  const lines = [
    b(label),
    "",
    // Titles and links only. The bot does not summarise somebody else's claim in this brand's voice.
    ...items.map((h) => `${link(h.title.slice(0, 110), h.url)}\n${i0(`${h.source} · ${ago(h.publishedAt)}`)}`),
    "",
    i0("Headlines from public feeds. Titles and links only, no summary and no endorsement."),
  ];
  return {
    text: lines.join("\n"),
    keyboard: [[{ text: "All news", url: bstocksUrl("/news") }]],
    // Off deliberately: with six links in the message, Telegram would pick one to expand and give
    // that outlet a banner nobody chose.
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

const MARK: Record<string, string> = { ok: "✅", degraded: "⚠️", down: "❌" };

export function statusCard(report: StatusReport): Card {
  const bad = report.checks.filter((c) => c.status !== "ok");
  const groups = new Map<string, typeof report.checks>();
  for (const check of report.checks) {
    const list = groups.get(check.group) ?? [];
    list.push(check);
    groups.set(check.group, list);
  }

  const lines = [
    `${MARK[report.overall] ?? "•"} ${b(report.overall === "ok" ? "All systems normal" : `Service ${report.overall}`)}`,
  ];

  if (bad.length > 0) {
    // Only what is wrong, in full. A wall of green ticks is what the site is for.
    lines.push("", ...bad.map((c) => `${MARK[c.status] ?? "•"} ${b(c.name)}\n${i0(c.detail ?? c.status)}`));
  } else {
    lines.push(
      "",
      `<pre>${[...groups.entries()].map(([group, checks]) => `${pad(group, 18)}${checks.length} ok`).join("\n")}</pre>`,
    );
  }

  return {
    text: [...lines, "", i0("Live checks of the chain, price feeds, routes, yield venues and storage the app depends on.")].join("\n"),
    keyboard: [[{ text: "Status page", url: bstocksUrl("/status") }]],
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export function templatesCard(templates: Template[], symbolOf: (address: string) => string | null): Card {
  if (templates.length === 0) return { text: esc("No templates right now."), preview: { is_disabled: true } };

  const lines = [b("Starter baskets"), ""];
  for (const t of templates.slice(0, 6)) {
    const mix = t.allocations
      .map((a) => `${symbolOf(a.assetAddress) ?? "?"} ${(a.weightBps / 100).toFixed(0)}%`)
      .join(" · ");
    lines.push(`${b(t.name)}\n${esc(mix)}`);
  }
  lines.push("", i0("Templates, not recommendations. Open one to change the mix before anything is bought."));

  return {
    text: lines.join("\n"),
    keyboard: [
      ...templates.slice(0, 4).map((t) => [{ text: t.name, url: bstocksUrl(`/build/${t.slug}`) }]),
      [{ text: "Build your own", url: bstocksUrl("/build") }],
    ],
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * Gift pools
 * ------------------------------------------------------------------ */

export function poolsCard(pools: PoolEntry[], symbolOf: (address: string) => string | null): Card {
  const open = pools.filter((p) => !p.pool.closedAt).slice(0, 6);
  if (open.length === 0) {
    return {
      text: [b("Gift pools"), "", esc("No open pool right now."), "", i0("A pool is one deposit many people claim an equal share of.")].join("\n"),
      keyboard: [[{ text: "Create one", url: bstocksUrl("/gifts") }]],
      preview: { is_disabled: true },
    };
  }

  const lines = [b("Open gift pools"), ""];
  for (const entry of open) {
    const stocks = entry.pool.legs.map((l) => symbolOf(l.token) ?? "?").join(" + ");
    const claimed = entry.claimed ?? 0;
    lines.push(`${b(stocks)} · ${esc(`${claimed} of ${entry.pool.slots} taken`)}`);
  }
  lines.push("", i0("One deposit, many equal claims, one per wallet. Whatever nobody takes goes back to whoever made it."));

  return {
    text: lines.join("\n"),
    keyboard: [
      ...open.slice(0, 4).map((entry) => [
        { text: entry.pool.legs.map((l) => symbolOf(l.token) ?? "?").join(" + "), url: bstocksUrl(`/pools/${entry.pool.id}`) },
      ]),
      [{ text: "All pools", url: bstocksUrl("/pools") }],
    ],
    preview: { is_disabled: true },
    editable: true,
  };
}

/* ------------------------------------------------------------------ *
 * Help
 * ------------------------------------------------------------------ */

/**
 * Help as something you can act on rather than a wall to read.
 *
 * Telegram's own guidance is that commands should be specific and discoverable, and that the menu
 * carries the list. So this groups by what somebody is trying to do, keeps each line to one job,
 * and puts the three most common paths on buttons underneath.
 */
export function helpCard(): Card {
  const section = (title: string, rows: [string, string][]) =>
    [b(title), ...rows.map(([cmd, what]) => `${esc(cmd)} ${i0(what)}`)].join("\n");

  return {
    text: [
      b("What I can do"),
      "",
      section("Prices", [
        ["/price NVDA", "price, Chainlink reference, liquidity, status"],
        ["/markets", "all thirteen by 24h move"],
        ["/news NVDA", "headlines for one stock, or the ecosystem"],
      ]),
      "",
      section("Yours", [
        ["/wallet alice.base.eth", "tell me which wallet is yours"],
        ["/portfolio", "holdings, value, USDC, Earn, liquidity"],
      ]),
      "",
      section("Acting", [
        ["/buy NVDA", "opens the trade panel in your wallet's browser"],
        ["/dca 25 NVDA weekly", "builds a recurring plan link"],
        ["/baskets", "starter templates"],
        ["/earn", "where idle USDC earns"],
      ]),
      "",
      section("Everything else", [
        ["/pools", "open gift pools"],
        ["/stats", "verified activity"],
        ["/status", "what is up and what is not"],
        ["/reset", "forget our conversation"],
      ]),
      "",
      i0("Or just say what you want in your own words. I answer from live data and prepare drafts you sign yourself."),
      "",
      i0("I never message first, never ask for a key or seed phrase, and cannot sign, approve or move anything."),
    ].join("\n"),
    keyboard: [
      [
        { text: "📈 Markets", callback_data: encode({ kind: "markets" }) },
        { text: "💼 Portfolio", callback_data: encode({ kind: "portfolio" }) },
      ],
      [{ text: "Open the app", url: bstocksUrl("/markets") }],
    ],
    preview: { is_disabled: true },
    editable: true,
  };
}
