import { afterEach, describe, expect, it, vi } from "vitest";
import { Telegram } from "./api";
import { callbackQuerySchema } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("Telegram card edits", () => {
  it("treats Telegram's unchanged message response as a successful refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error_code: 400, description: "Bad Request: message is not modified" })));
    expect(await new Telegram("test-token").editCard({ chat_id: 1, message_id: 2, text: "same" })).toBe(true);
  });
  it("reports a failed edit so the caller can deliver a replacement", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error_code: 400, description: "Bad Request: message can't be edited" })));
    expect(await new Telegram("test-token").editCard({ chat_id: 1, message_id: 2, text: "new" })).toBe(false);
  });
  it("retains inline_message_id without requiring a chat message", () => {
    expect(callbackQuerySchema.parse({ id: "q", from: { id: 1 }, inline_message_id: "inline-id", data: "p:NVDA" }).inline_message_id).toBe("inline-id");
  });
});
