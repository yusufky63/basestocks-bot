import type { V1Stock } from "@/services/bstocks";
import type { Card } from "./render";
import { UI } from "./copy";
import { b } from "@/lib/telegram/html";
import { encode, type Action } from "./nav";

export function planCard(stocks: V1Stock[], action?: Extract<Action, { kind: "plan" }>): Card {
  if (!action) return {
    text: UI.planStock,
    keyboard: [...Array.from({ length: Math.ceil(stocks.length / 3) }, (_, i) => stocks.slice(i * 3, i * 3 + 3).map((stock) => ({ text: stock.symbol, callback_data: encode({ kind: "plan", symbol: stock.symbol }) }))), [{ text: "Cancel", callback_data: "cancel" }]],
    editable: true,
  };
  const text = `${action.amount ? UI.planCadence : UI.planAmount}\n\n${b(action.symbol)}${action.amount ? ` · $${action.amount}` : ""}`;
  const options = action.amount
    ? [{ label: "Daily", days: 1 }, { label: "Weekly", days: 7 }, { label: "Every 2 weeks", days: 14 }, { label: "Monthly", days: 30 }].map((option) => ({ text: option.label, callback_data: encode({ ...action, days: option.days }) }))
    : [10, 25, 50, 100].map((amount) => ({ text: `$${amount}`, callback_data: encode({ ...action, amount }) }));
  return { text, keyboard: [options.slice(0, 2), options.slice(2), [{ text: "‹ Back", callback_data: action.amount ? encode({ kind: "plan", symbol: action.symbol }) : "dca" }, { text: "Cancel", callback_data: "cancel" }]], editable: true };
}
