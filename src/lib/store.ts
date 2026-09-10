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

async function command(parts: string[]): Promise<unknown | null> {
  const cfg = upstash();
  if (!cfg) return null;
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(parts),
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: unknown };
    return body.result ?? null;
  } catch {
    return null;
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
  if (shared !== null) return shared === "OK";
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
    const next = await command(["INCR", key]);
    if (typeof next === "number") {
      if (next === 1) void command(["EXPIRE", key, String(ttlSec)]);
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

/** Window key that rolls on its own, so nothing has to be swept on a schedule. */
export function windowKey(prefix: string, identity: string, windowSec: number): string {
  return `${prefix}:${identity}:${Math.floor(nowSec() / windowSec)}`;
}
