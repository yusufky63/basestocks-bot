import { bump, windowKey } from "./store";

/**
 * Metering is keyed on the Telegram user, never on the request IP.
 *
 * Behind a webhook every update on earth arrives from Telegram's datacenter, so an IP-keyed limiter
 * would put all of humanity in one bucket: the first two chatty users would lock out everyone else.
 */
export interface Limit {
  limit: number;
  windowSec: number;
}

export const LIMITS = {
  /** Ordinary commands: generous, since each one is a cached read. */
  command: { limit: 20, windowSec: 60 } satisfies Limit,
  /** Anything that costs a model call. */
  assistant: { limit: 5, windowSec: 60 } satisfies Limit,
  /** A group can make the bot work, but not hold the floor. */
  chat: { limit: 30, windowSec: 60 } satisfies Limit,
} as const;

export interface Verdict {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function meter(bucket: string, identity: string, limit: Limit): Promise<Verdict> {
  const used = await bump(windowKey(bucket, identity, limit.windowSec), limit.windowSec + 5);
  return { allowed: used <= limit.limit, used, limit: limit.limit };
}
