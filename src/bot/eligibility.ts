import { recall, remember } from "@/lib/store";
import { b, esc } from "@/lib/telegram/html";
import { ELIGIBILITY_NOTE } from "./copy";
import type { Card } from "./render";
import type { InlineKeyboardButton } from "@/lib/telegram/api";

/**
 * The eligibility notice, asked once instead of printed on everything.
 *
 * The website decides this from the request's country header. A webhook carries Telegram's
 * datacenter instead, so the gate there does not merely fail to apply, it silently passes: this bot
 * has no way to know where anyone is.
 *
 * What it can do is refuse to hand over a trade link until the person has read the sentence and
 * said it applies to them. That is a declared confirmation, not a verified one, and it is worth
 * being exact about what it is and is not:
 *
 *   - It authorises nothing. The site runs its own gate when the link is opened, from the user's
 *     own request carrying their own region, and refuses them there if it must.
 *   - It is not stored as a claim about anybody. One expiring boolean under an opaque key, no
 *     address, no name, no country.
 *
 * So this is a notice with an acknowledgement in front of an action, which is the only honest thing
 * a chat transport can offer, and it is why the same sentence no longer trails every price card.
 */
const TTL_SEC = 180 * 24 * 60 * 60;

function key(userId: number | string): string {
  return `elig:${userId}`;
}

export async function hasConfirmed(userId: number | string): Promise<boolean> {
  return recall(key(userId));
}

export async function confirmEligibility(userId: number | string): Promise<void> {
  await remember(key(userId), TTL_SEC);
}

/** Shown in place of a trade handoff, with the handoff itself waiting behind the button. */
export function eligibilityCard(confirmData: string, what: string): Card {
  return {
    text: [
      b("Before you continue"),
      "",
      esc(ELIGIBILITY_NOTE),
      "",
      esc(
        "I cannot tell where you are, so I have to ask. Confirming here does not grant access: the site checks your region again when you open the link, and will refuse if it must.",
      ),
      "",
      esc("Public chain data, not investment advice. Prices and rates change."),
    ].join("\n"),
    keyboard: [[{ text: `I confirm — ${what}`, callback_data: confirmData } satisfies InlineKeyboardButton]],
    preview: { is_disabled: true },
    editable: true,
  };
}
