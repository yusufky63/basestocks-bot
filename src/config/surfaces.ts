import { env } from "./env";

/**
 * Two bot handles, one deployment. The surface is the path discriminator on the webhook, and it
 * chooses a token, a secret, a copy module and a command table. Splitting at BotFather costs a
 * second token; splitting at the codebase would have cost a second limiter, a second dedup store,
 * a second escaper and a second revocation story.
 */
export const SURFACES = ["bstocks", "launchpad"] as const;
export type Surface = (typeof SURFACES)[number];

export function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

export interface SurfaceConfig {
  surface: Surface;
  token: string;
  secret: string;
}

/** Null when this deployment has no token for the surface, which is how a surface stays off. */
export function surfaceConfig(surface: Surface): SurfaceConfig | null {
  const e = env();
  const token = surface === "bstocks" ? e.TELEGRAM_BSTOCKS_TOKEN : e.TELEGRAM_LAUNCHPAD_TOKEN;
  const secret = surface === "bstocks" ? e.TELEGRAM_BSTOCKS_SECRET : e.TELEGRAM_LAUNCHPAD_SECRET;
  if (!token || !secret) return null;
  return { surface, token, secret };
}

export function enabledSurfaces(): Surface[] {
  return SURFACES.filter((s) => surfaceConfig(s) !== null);
}
