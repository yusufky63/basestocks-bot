import { env } from "@/config/env";
import { surfaceConfig } from "@/config/surfaces";
import { Telegram } from "@/lib/telegram/api";
import { b, esc } from "@/lib/telegram/html";
import { claimOnce } from "@/lib/store";
import { readHealth } from "@/services/bstocks";

/**
 * Operations alerts into one private chat.
 *
 * This is the first thing worth shipping and the only feature here with a guaranteed user. It also
 * exercises the token, the chat id and the send path end to end before anything user-facing depends
 * on them.
 *
 * The chat reads alerts and cannot run anything. A maintenance command from a chat would mean this
 * process holding an admin credential, and Telegram chat membership is not an authorization system:
 * whoever stole the bot token would inherit it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One message per distinct alert per hour, so a persistent fault does not become a flood. */
const REPEAT_WINDOW_SEC = 3_600;

export async function GET(request: Request): Promise<Response> {
  const e = env();
  if (!e.CRON_SECRET) return Response.json({ ok: false, reason: "cron-not-configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${e.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }

  const chatId = e.TELEGRAM_OPS_CHAT_ID;
  const config = surfaceConfig("bstocks");
  if (!chatId || !config) return Response.json({ ok: true, sent: 0, reason: "ops-chat-not-configured" });

  const health = await readHealth();
  if (!health) {
    return send(config.token, chatId, ["The deployment did not answer its health check."]);
  }

  const problems: string[] = [];
  if (health.ok === false) problems.push("Health reports not ok.");
  if (health.storage?.tablesReady === false) {
    problems.push(`Storage tables missing: ${(health.storage.missing ?? []).join(", ") || "unknown"}`);
  }
  for (const alert of health.alerts ?? []) problems.push(alert);

  if (problems.length === 0) return Response.json({ ok: true, sent: 0 });
  return send(config.token, chatId, problems);
}

async function send(token: string, chatId: string, problems: string[]): Promise<Response> {
  const tg = new Telegram(token);
  const fresh: string[] = [];
  for (const problem of problems) {
    // Key on the text so a fault that persists across ticks is announced once, not every half hour.
    const key = `alert:${hash(problem)}`;
    if (await claimOnce(key, REPEAT_WINDOW_SEC)) fresh.push(problem);
  }
  if (fresh.length === 0) return Response.json({ ok: true, sent: 0, suppressed: problems.length });

  await tg.sendMessage({
    chat_id: chatId,
    text: [b("BaseStocks alert"), "", ...fresh.map((p) => `• ${esc(p)}`)].join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  return Response.json({ ok: true, sent: fresh.length, suppressed: problems.length - fresh.length });
}

/** Small stable digest, only ever used as a de-duplication key. */
function hash(input: string): string {
  let h = 2_166_136_261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return (h >>> 0).toString(36);
}
