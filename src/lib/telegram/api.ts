import { splitMessage } from "./html";

/**
 * A thin client over the Bot API. No framework.
 *
 * grammY and telegraf both want to own the process: a dispatcher, a session store, a middleware
 * stack and long polling as the happy path. This deployment is a serverless webhook that answers
 * one update and exits, so what it needs from a library is a typed sendMessage and a 429 that
 * respects retry_after. That is this file.
 */
const API = "https://api.telegram.org";

export interface LinkPreviewOptions {
  is_disabled?: boolean;
  url?: string;
  prefer_small_media?: boolean;
  prefer_large_media?: boolean;
  show_above_text?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  /** Opens a chat picker with the query prefilled. The one field that teaches people inline mode. */
  switch_inline_query_chosen_chat?: {
    query: string;
    allow_user_chats?: boolean;
    allow_group_chats?: boolean;
  };
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "HTML";
  message_thread_id?: number;
  link_preview_options?: LinkPreviewOptions;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
  disable_notification?: boolean;
}

/**
 * A method call encoded as the webhook's own response body.
 *
 * Telegram accepts this and it removes an outbound HTTP round trip from every simple reply, which
 * on a cold serverless instance is most of the latency. The documented trade is that the result is
 * invisible: you cannot know whether it worked. Acceptable for a reply, not acceptable for work
 * that must be retried, so anything long still goes through `call` below.
 */
export function webhookReply(params: SendMessageParams): Response {
  const [first] = splitMessage(params.text);
  return Response.json({ method: "sendMessage", parse_mode: "HTML", ...params, text: first ?? "" });
}

/** Nothing to say. Telegram needs a 2xx or it redelivers the update. */
export function webhookAck(): Response {
  return new Response(null, { status: 200 });
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export class Telegram {
  constructor(private readonly token: string) {}

  /**
   * One call, with one retry when Telegram says to wait.
   *
   * The documented limits are one message per second into a single chat, twenty per minute into a
   * group, and about thirty per second overall. A single retry that honours `retry_after` is the
   * whole flood strategy a request-scoped handler needs; fan-out is paced by its own caller.
   */
  async call<T>(method: string, params: Record<string, unknown>, attempt = 0): Promise<T | null> {
    let body: TgResponse<T>;
    try {
      const res = await fetch(`${API}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      body = (await res.json()) as TgResponse<T>;
    } catch {
      return null;
    }
    if (body.ok) return body.result ?? null;
    const wait = body.parameters?.retry_after;
    if (wait !== undefined && attempt === 0 && wait <= 30) {
      await new Promise((r) => setTimeout(r, (wait + 1) * 1_000));
      return this.call<T>(method, params, attempt + 1);
    }
    return null;
  }

  /** Sends, splitting anything over Telegram's 4096-character limit at line boundaries. */
  async sendMessage(params: SendMessageParams): Promise<void> {
    for (const part of splitMessage(params.text)) {
      await this.call("sendMessage", { parse_mode: "HTML", ...params, text: part });
    }
  }

  async editMessageText(params: SendMessageParams & { message_id: number }): Promise<void> {
    const [first] = splitMessage(params.text);
    await this.call("editMessageText", { parse_mode: "HTML", ...params, text: first ?? "" });
  }

  /**
   * The typing bubble. Sent before long work so a chat does not look dead while a model thinks.
   * It lapses after about five seconds, which is the honest signal: this is not a progress bar.
   */
  async chatAction(chat_id: number | string, message_thread_id?: number): Promise<void> {
    await this.call("sendChatAction", { chat_id, action: "typing", message_thread_id });
  }

  async answerInlineQuery(inline_query_id: string, results: unknown[], cache_time = 30): Promise<void> {
    // `is_personal: false` because no inline result here depends on who asked, and that is a
    // property worth keeping true: inline results land in chats the bot was never added to.
    await this.call("answerInlineQuery", { inline_query_id, results, cache_time, is_personal: false });
  }

  async leaveChat(chat_id: number | string): Promise<void> {
    await this.call("leaveChat", { chat_id });
  }
}
