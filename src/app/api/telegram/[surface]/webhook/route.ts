import { isSurface, surfaceConfig } from "@/config/surfaces";
import { secretMatches } from "@/lib/telegram/initdata";
import { updateSchema } from "@/lib/telegram/types";
import { webhookAck } from "@/lib/telegram/api";
import { handleUpdate } from "@/bot/commands";

/**
 * The bot's front door. One route, one surface per path segment.
 *
 * `[surface]` is the discriminator that lets two bot handles share one deployment: it chooses a
 * token, a secret, a copy module and a command table, and nothing else differs. Splitting here
 * instead of at the codebase is what keeps a second handle from meaning a second limiter, a second
 * de-duplication store and a second escaper.
 *
 * Three rules hold for every request:
 *
 *  1. The secret header is checked before the body is read. Anyone can POST to this URL.
 *  2. Nothing from the body is ever logged. A message may contain a claim key, and a key in a log
 *     is a key that has been given away.
 *  3. Once the secret checks out, the answer is 2xx even when the work fails. Telegram redelivers
 *     anything that is not, and a redelivery of a request that failed for its own reasons just
 *     fails again, more expensively.
 */
export const maxDuration = 60;

interface Context {
  params: Promise<{ surface: string }>;
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { surface } = await params;
  if (!isSurface(surface)) return new Response(null, { status: 404 });

  const config = surfaceConfig(surface);
  // No token for this surface means the surface is off on this deployment. 404 rather than 500:
  // there is nothing here, which is a true and unhelpful answer to give an unauthenticated caller.
  if (!config) return new Response(null, { status: 404 });

  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), config.secret)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return webhookAck();
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) return webhookAck();

  try {
    return await handleUpdate(surface, config.token, parsed.data);
  } catch {
    // Deliberately bare: the error is not reported anywhere that could carry message text with it.
    return webhookAck();
  }
}

/** A GET here is a person or a scanner, never Telegram. */
export function GET(): Response {
  return new Response(null, { status: 405 });
}
