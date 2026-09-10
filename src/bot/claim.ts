/**
 * Claim links, handled with one hard rule and one small courtesy.
 *
 * A BStocks claim-link gift carries its key in the URL fragment (`#k=…`). A browser never sends a
 * fragment to a server, which is the whole point of putting it there: the key reaches the claimer
 * and no one else. Pasted into a chat, though, the fragment is just text, and this bot receives it
 * like any other word.
 *
 * So: a message containing a claim key is dropped before anything parses it, is never written to a
 * log, and is never echoed back. Whoever holds that key holds the gift, and a bot that repeats it
 * into a group has given the gift away to the fastest reader.
 *
 * The courtesy is for the other case: a claim link *without* a key is safe to recognise, and saying
 * what it is helps the person it was sent to.
 */

/** Matches a claim key in any position, including inside a longer URL. */
const CLAIM_KEY = /#k=/i;

/** A claim page URL, key or no key. The host is not pinned: a preview deployment is still a gift. */
const CLAIM_URL = /https?:\/\/[^\s]*\/gifts\/claim\/([A-Za-z0-9_-]{6,64})/i;

export type ClaimVerdict =
  | { kind: "key-present" }
  | { kind: "claim-link"; id: string }
  | { kind: "none" };

export function inspectForClaim(text: string): ClaimVerdict {
  if (CLAIM_KEY.test(text)) return { kind: "key-present" };
  const match = CLAIM_URL.exec(text);
  if (match?.[1]) return { kind: "claim-link", id: match[1] };
  return { kind: "none" };
}

export const KEY_WARNING = [
  "<b>Do not send that here.</b>",
  "",
  "That link carries the claim key for a gift, and whoever has the key can take it. I dropped the message without reading, storing or repeating it.",
  "",
  "Send a claim link straight to the person it is for. If it has already been seen by anyone else, cancel it from the app and make a new one.",
].join("\n");

export const CLAIM_HELP = [
  "<b>A claim-link gift</b>",
  "",
  "Someone sent stock that is waiting in an ownerless escrow contract on Base. Open the link and you can claim it with a passkey wallet created on the spot: no seed phrase, no extension, and the network fee is sponsored where the paymaster allows.",
  "",
  "The key lives in the part of the link after the <code>#</code>, which never reaches any server. Keep the whole link private.",
].join("\n");
