import { env } from "@/config/env";

/**
 * Small shared key-value tier for the three things a stateless bot still cannot do without: update
 * de-duplication, per-user metering, and the kill switch. Upstash when configured, in-process
 * otherwise. Nothing here is a user record; every key expires.
 *
 * The kill switch lives here rather than in an env var deliberately: an env change needs a
 * redeploy, and a compromised bot credential does not wait for a build.
 */
interface Entry {
  value: number;
  expiresAt: number;
}

const memory = new Map<string, Entry>();
const memoryText = new Map<string, { value: string; expiresAt: number }>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sweep(): void {
  if (memory.size < 512) return;
  const t = Date.now();
  for (const [k, v] of memory) if (v.expiresAt <= t) memory.delete(k);
}

function upstash(): { url: string; token: string } | null {
  const e = env();
  if (!e.UPSTASH_REDIS_REST_URL || !e.UPSTASH_REDIS_REST_TOKEN) return null;
  return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN };
}

async function command(parts: string[]): Promise<unknown> {
  const cfg = upstash();
  if (!cfg) return undefined;
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(parts),
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (body.error || !("result" in body)) return undefined;
    return body.result ?? null;
  } catch {
    return undefined;
  }
}

/**
 * Claims a key. True means this caller was first, false means somebody already had it.
 *
 * Used for `update_id`: Telegram redelivers only when it did not get a 2xx, which is rare once the
 * handler answers before it works, but a redelivered update that costs a model call must not be
 * paid for twice.
 */
export async function claimOnce(key: string, ttlSec: number): Promise<boolean> {
  const shared = await command(["SET", key, "1", "NX", "EX", String(ttlSec)]);
  // Redis nil means NX lost to another instance. It is not a transport failure.
  if (shared !== undefined) return shared === "OK";
  sweep();
  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) return false;
  memory.set(key, { value: 1, expiresAt: Date.now() + ttlSec * 1_000 });
  return true;
}

/** Increments a counter inside a fixed window and returns the new value. */
export async function bump(key: string, ttlSec: number): Promise<number> {
  const cfg = upstash();
  if (cfg) {
    const next = await command(["EVAL", "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n", "1", key, String(ttlSec)]);
    if (typeof next === "number") {
      return next;
    }
  }
  sweep();
  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    hit.value += 1;
    return hit.value;
  }
  memory.set(key, { value: 1, expiresAt: Date.now() + ttlSec * 1_000 });
  return 1;
}

/**
 * Short-lived text, for the one thing that genuinely needs it: the last few turns of a
 * conversation, so a follow-up like "make it fifty" has something to refer back to.
 *
 * This is the user's own conversation with the bot, kept for minutes, keyed by chat, and never
 * written to a log or an error report. The claim-key filter runs before anything reaches here, so a
 * gift key cannot end up stored. Without a shared store it lives in process memory and evaporates
 * with the instance, which is the quieter of the two behaviours.
 */
export async function putText(key: string, value: string, ttlSec: number): Promise<boolean> {
  const shared = await command(["SET", key, value, "EX", String(ttlSec)]);
  if (shared !== undefined) return shared === "OK";
  if (upstash()) return false;
  memoryText.set(key, { value, expiresAt: Date.now() + ttlSec * 1_000 });
  if (memoryText.size > 512) {
    const now = Date.now();
    for (const [k, v] of memoryText) if (v.expiresAt <= now) memoryText.delete(k);
  }
  return true;
}

export async function getText(key: string): Promise<string | null> {
  if (upstash()) {
    const shared = await command(["GET", key]);
    return typeof shared === "string" ? shared : null;
  }
  const hit = memoryText.get(key);
  return hit && hit.expiresAt > Date.now() ? hit.value : null;
}

/** Keep simultaneous watchlist taps from overwriting one another across instances. */
export async function updateTextList(key: string, item: string, add: boolean, limit: number, ttlSec: number): Promise<boolean> {
  if (upstash()) {
    const script = "local raw = redis.call('GET', KEYS[1]); local list = raw and cjson.decode(raw) or {}; local out = {}; local found = false; for _,v in ipairs(list) do if v == ARGV[1] then found = true end; if v ~= ARGV[1] or ARGV[2] == '1' then table.insert(out, v) end end; if ARGV[2] == '1' and not found then if #out >= tonumber(ARGV[3]) then return 0 end; table.insert(out, ARGV[1]) end; redis.call('SET', KEYS[1], #out == 0 and '[]' or cjson.encode(out), 'EX', ARGV[4]); return 1";
    return await command(["EVAL", script, "1", key, item, add ? "1" : "0", String(limit), String(ttlSec)]) === 1;
  }
  const hit = memoryText.get(key);
  let list: string[] = [];
  try { list = hit && hit.expiresAt > Date.now() ? JSON.parse(hit.value) : []; } catch { /* Expired or invalid state starts empty. */ }
  if (!Array.isArray(list)) list = [];
  if (add && !list.includes(item) && list.length >= limit) return false;
  const next = add ? [...new Set([...list, item])] : list.filter((value) => value !== item);
  memoryText.set(key, { value: JSON.stringify(next), expiresAt: Date.now() + ttlSec * 1_000 });
  return true;
}

/**
 * Remembers a small fact about one Telegram user for a while.
 *
 * The only thing stored through this today is that somebody read the eligibility notice and said
 * the sentence applies to them. It is a fact about a conversation, not a profile: one boolean under
 * an opaque key, expiring on its own, holding no address, no name and no country.
 */
export async function remember(key: string, ttlSec: number): Promise<void> {
  const shared = await command(["SET", key, "1", "EX", String(ttlSec)]);
  if (shared !== undefined) return;
  sweep();
  memory.set(key, { value: 1, expiresAt: Date.now() + ttlSec * 1_000 });
}

export async function recall(key: string): Promise<boolean> {
  const cfg = upstash();
  if (cfg) {
    const shared = await command(["GET", key]);
    // A null here is genuinely ambiguous: absent, or the store is unreachable. Both mean "ask
    // again", which is the safe direction for a notice.
    return shared === "1" || shared === 1;
  }
  sweep();
  const hit = memory.get(key);
  return Boolean(hit && hit.expiresAt > Date.now());
}

/** Window key that rolls on its own, so nothing has to be swept on a schedule. */
export function windowKey(prefix: string, identity: string, windowSec: number): string {
  return `${prefix}:${identity}:${Math.floor(nowSec() / windowSec)}`;
}
