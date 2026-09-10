import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Telegram Mini App `initData`, exactly as the Bot API documents it:
 *
 *   secret_key = HMAC_SHA256(key: "WebAppData", data: bot_token)
 *   hash       = hex(HMAC_SHA256(key: secret_key, data: data_check_string))
 *
 * where `data_check_string` is every received field except `hash`, sorted alphabetically, joined as
 * `key=value` with a line feed.
 *
 * Two things this function deliberately does not do. It does not establish an identity you may act
 * on alone: the bot token is the HMAC key, so a leaked token would let an attacker forge a valid
 * hash for any Telegram id, which is why a wallet binding must start from a wallet signature and
 * only then be shown alongside the Telegram name for confirmation. And it does not assert
 * eligibility, which is a property of a request's own region, not of a Telegram account.
 *
 * Nothing in this deployment calls it yet. It is here because the same construction is what a
 * Mini App and a login button both need, and writing it once, with its test, is what keeps the
 * second caller from inventing a looser version.
 */
export interface InitDataResult {
  ok: boolean;
  reason?: "missing-hash" | "bad-hash" | "stale";
  userId?: number;
  username?: string;
  authDate?: number;
}

const DEFAULT_MAX_AGE_SEC = 15 * 60;

export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = DEFAULT_MAX_AGE_SEC,
  nowSec = Math.floor(Date.now() / 1_000),
): InitDataResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing-hash" };

  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!constantTimeEqualHex(expected, hash)) return { ok: false, reason: "bad-hash" };

  // A valid signature over stale data is still a replay. `auth_date` is the only defence.
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "stale" };
  const age = nowSec - authDate;
  if (age > maxAgeSec || age < -60) return { ok: false, reason: "stale" };

  let userId: number | undefined;
  let username: string | undefined;
  const rawUser = params.get("user");
  if (rawUser) {
    try {
      const parsed = JSON.parse(rawUser) as { id?: number; username?: string };
      if (typeof parsed.id === "number") userId = parsed.id;
      if (typeof parsed.username === "string") username = parsed.username;
    } catch {
      // A malformed user object does not invalidate a correct signature; the caller just gets less.
    }
  }
  return { ok: true, userId, username, authDate };
}

/** Compares two hex digests without leaking where they diverge. */
export function constantTimeEqualHex(expected: string, received: string): boolean {
  if (!/^[0-9a-f]+$/i.test(received) || expected.length !== received.length) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(received, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * The webhook's own secret header, compared the same careful way.
 *
 * `setWebhook`'s `secret_token` accepts only `A-Z`, `a-z`, `0-9`, `_` and `-`, 1 to 256 characters,
 * so a plain base64 secret is rejected by Telegram at registration time.
 * `scripts/setup-telegram.mjs` mints a base64url one for exactly that reason.
 */
export function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
