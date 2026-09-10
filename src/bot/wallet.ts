import { getText, putText } from "@/lib/store";
import { isAddress } from "./resolve";
import { resolveBasename } from "@/services/bstocks";

/**
 * The address a person told the bot is theirs.
 *
 * It is not proof of anything and it is not treated as any. Everything it unlocks is already public
 * on Base: balances, holdings, activity. Anyone could read the same numbers for the same address
 * without asking this bot, so requiring a signature here would add friction to protect data that is
 * not protected anywhere else.
 *
 * What that means in practice, and what the copy has to say out loud: this is a bookmark, not a
 * login. It authorises nothing, it is never shown in a group, and it can be dropped at any time.
 * The day the bot can do something on a wallet's behalf, this stops being enough and a signature
 * becomes the price of entry.
 */
const TTL_SEC = 180 * 24 * 60 * 60;

function key(userId: number | string): string {
  return `wallet:${userId}`;
}

export async function getWallet(userId: number | string): Promise<string | null> {
  const stored = await getText(key(userId));
  return stored && isAddress(stored) ? stored : null;
}

export async function setWallet(userId: number | string, address: string): Promise<void> {
  await putText(key(userId), address, TTL_SEC);
}

export async function forgetWallet(userId: number | string): Promise<void> {
  // A short life rather than a delete, because the stores behind this do not all have one.
  await putText(key(userId), "", 60);
}

/**
 * Accepts an address or a Basename and returns an address.
 *
 * Basenames are worth the extra call: `alice.base.eth` is what people actually have written down,
 * and a bot that only takes 42 hex characters asks them to go and find the hex.
 */
export async function toAddress(input: string): Promise<{ address: string; name?: string } | null> {
  const trimmed = input.trim();
  if (isAddress(trimmed)) return { address: trimmed };
  if (/^[a-z0-9-]+\.base\.eth$/i.test(trimmed)) {
    const address = await resolveBasename(trimmed.toLowerCase());
    return address ? { address, name: trimmed.toLowerCase() } : null;
  }
  return null;
}
