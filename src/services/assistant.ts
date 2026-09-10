import { env } from "@/config/env";
import { esc } from "@/lib/telegram/html";
import { COPY } from "@/bot/copy";

/**
 * Free text, answered by the BStocks assistant over its own chat endpoint.
 *
 * The assistant itself is a pure function on the other side (`runAssistantTurn` takes a system
 * prompt, a history, a tool list and a context, and knows nothing about HTTP), so a second
 * transport costs nothing there. What it costs is here: that endpoint meters by request IP, and
 * behind a webhook every Telegram user on earth arrives from Telegram's datacenter. Until it can be
 * told who is asking, one person could spend the website's daily allowance, which is why this is
 * off unless `ASSISTANT_ENABLED` is set and why the caller keeps its own per-user cap on top.
 *
 * The endpoint already strips markdown and caps its own reply. Escaping is what makes model output
 * safe to send as HTML, and it is applied without exception: the model is a source of data here,
 * exactly like a headline or a token name.
 */
export async function askAssistant(question: string): Promise<string> {
  const url = new URL("/api/assistant/chat", env().BSTOCKS_URL).toString();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: question.slice(0, 1_000) }] }),
      // The turn is bounded at forty seconds on the other side, with four tool rounds inside it.
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    });
    const body = (await res.json()) as { ok?: boolean; reply?: string; errors?: string[] };
    if (body.ok && body.reply) {
      return `${esc(body.reply)}\n\n<i>${esc(COPY.bstocks.footer)}</i>`;
    }
    return esc(body.errors?.[0] ?? "I could not answer that right now.");
  } catch {
    return esc("I could not reach the app to answer that. Try again in a moment.");
  }
}
