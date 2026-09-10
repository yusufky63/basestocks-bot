import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { secretMatches, verifyInitData } from "./initdata";

const TOKEN = "123456:AAH-not-a-real-token-0000000000000000";

/** Signs an initData payload the way Telegram documents it, so the test proves the same algorithm. */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(pairs.join("\n")).digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const NOW = 1_800_000_000;

describe("verifyInitData", () => {
  it("accepts a correctly signed payload and reads the user out of it", () => {
    const initData = sign({
      auth_date: String(NOW - 10),
      query_id: "AAF",
      user: JSON.stringify({ id: 42, username: "someone" }),
    });
    const result = verifyInitData(initData, TOKEN, 900, NOW);
    expect(result.ok).toBe(true);
    expect(result.userId).toBe(42);
    expect(result.username).toBe("someone");
  });

  it("rejects a payload signed with a different bot token", () => {
    const initData = sign({ auth_date: String(NOW - 10), user: "{}" }, "999:OTHER");
    expect(verifyInitData(initData, TOKEN, 900, NOW)).toMatchObject({ ok: false, reason: "bad-hash" });
  });

  it("rejects a tampered field even when the hash is otherwise well formed", () => {
    const signed = sign({ auth_date: String(NOW - 10), user: JSON.stringify({ id: 1 }) });
    const params = new URLSearchParams(signed);
    params.set("user", JSON.stringify({ id: 2 }));
    expect(verifyInitData(params.toString(), TOKEN, 900, NOW)).toMatchObject({ ok: false, reason: "bad-hash" });
  });

  it("rejects a valid signature over stale data, because that is still a replay", () => {
    const initData = sign({ auth_date: String(NOW - 4_000), user: "{}" });
    expect(verifyInitData(initData, TOKEN, 900, NOW)).toMatchObject({ ok: false, reason: "stale" });
  });

  it("rejects a payload with no hash at all", () => {
    expect(verifyInitData("auth_date=1", TOKEN, 900, NOW)).toMatchObject({ ok: false, reason: "missing-hash" });
  });

  it("survives a malformed user object without discarding a correct signature", () => {
    const initData = sign({ auth_date: String(NOW - 5), user: "not json" });
    const result = verifyInitData(initData, TOKEN, 900, NOW);
    expect(result.ok).toBe(true);
    expect(result.userId).toBeUndefined();
  });
});

describe("secretMatches", () => {
  it("matches an identical secret", () => {
    expect(secretMatches("abc-123_XYZ", "abc-123_XYZ")).toBe(true);
  });

  it("refuses a missing header, which is what an unauthenticated POST to the webhook looks like", () => {
    expect(secretMatches(null, "abc")).toBe(false);
    expect(secretMatches("", "abc")).toBe(false);
  });

  it("refuses a prefix, a suffix and a different value", () => {
    expect(secretMatches("abc", "abcd")).toBe(false);
    expect(secretMatches("abcd", "abc")).toBe(false);
    expect(secretMatches("abd", "abc")).toBe(false);
  });
});
