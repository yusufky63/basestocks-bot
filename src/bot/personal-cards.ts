import { b, esc, link } from "@/lib/telegram/html";
import { ago, compactUsd, move, shortAddress, usd } from "@/lib/format";
import { basescanTx } from "@/lib/links";
import type { ActivityItem, V1Stock } from "@/services/bstocks";
import { encode } from "./nav";
import { UI } from "./copy";
import type { Card } from "./render";

export function watchlistCard(stocks: V1Stock[], addresses: string[]): Card {
  const selected = addresses.flatMap((address) => stocks.filter((stock) => stock.address.toLowerCase() === address));
  const missing = addresses.length - selected.length;
  return {
    text: addresses.length === 0 ? UI.watchEmpty : [b("Your watchlist"), "", ...selected.map((s) => `${b(s.symbol)} · ${esc(usd(s.dexPriceUsd ?? s.displayUsd))} · ${esc(move(s.dexChange24hPct))}`), ...(missing ? [esc(`${missing} saved stock(s) are no longer listed.`)] : [])].join("\n"),
    keyboard: [
      ...selected.map((s) => [{ text: s.symbol, callback_data: encode({ kind: "price", symbol: s.symbol }) }, { text: "Remove", callback_data: encode({ kind: "unwatch", symbol: s.symbol }) }]),
      [{ text: "↻ Refresh", callback_data: "watchlist" }, { text: "Add stocks", callback_data: "m" }],
    ],
    editable: true,
  };
}

export function activityCard(items: ActivityItem[], address: string): Card {
  const visible = [...items].sort((a, c) => (c.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 8);
  return {
    text: [b(`Recent activity · ${shortAddress(address)}`), "", ...(visible.length ? visible.map((item) => [
      `${item.verified ? "✓" : "◷"} ${b(item.type.replaceAll("-", " "))}${item.symbol ? ` · ${esc(item.symbol)}` : ""}${item.amountUsd !== undefined ? ` · ${esc(compactUsd(item.amountUsd))}` : ""}`,
      `${esc(item.verified ? "Confirmed" : "Unverified")}${item.timestamp ? ` · ${esc(ago(item.timestamp * 1000))}` : ""} · ${link("View transaction", basescanTx(item.txHash))}`,
    ].join("\n")) : [UI.activityEmpty]), "", esc(UI.activityNote)].join("\n"),
    keyboard: [[{ text: "Portfolio", callback_data: encode({ kind: "portfolio", address }) }, { text: "↻ Refresh", callback_data: encode({ kind: "activity", address }) }]],
    editable: true,
  };
}
