import { enabledSurfaces } from "@/config/surfaces";
import { env } from "@/config/env";

/**
 * What this deployment is configured to do, and nothing about who uses it.
 *
 * Capability booleans only: never a token, never a chat id, never a count that could identify a
 * person. The two sibling apps answer their own health the same way, and a monitor that reads all
 * three is how an outage becomes a message instead of a support question.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const e = env();
  return Response.json({
    ok: true,
    service: "basestocks-bot",
    surfaces: enabledSurfaces(),
    features: {
      assistant: e.ASSISTANT_ENABLED,
      opsAlerts: Boolean(e.TELEGRAM_OPS_CHAT_ID),
      sharedStore: Boolean(e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN),
      cron: Boolean(e.CRON_SECRET),
    },
    upstream: { bstocks: e.BSTOCKS_URL, launchpad: e.LAUNCHPAD_URL },
  });
}
