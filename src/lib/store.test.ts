import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("shared state across serverless instances", () => {
  it("does not treat a Redis NX collision as an outage and process the update twice", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: null })));
    vi.resetModules();
    const firstInstance = await import("./store");
    expect(await firstInstance.claimOnce("already-claimed-update", 600)).toBe(false);
    vi.resetModules();
    const secondInstance = await import("./store");
    expect(await secondInstance.claimOnce("already-claimed-update", 600)).toBe(false);
  });

  it("keeps local deduplication during a transport outage", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    vi.resetModules();
    const { claimOnce } = await import("./store");
    expect(await claimOnce("offline-update", 600)).toBe(true);
    expect(await claimOnce("offline-update", 600)).toBe(false);
  });

  it("does not report a watchlist mutation saved when shared storage fails", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unavailable" })));
    vi.resetModules();
    const { updateTextList } = await import("./store");
    expect(await updateTextList("watch:test", "NVDA", true, 24, 600)).toBe(false);
  });
});
