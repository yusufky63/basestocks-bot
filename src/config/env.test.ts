import { afterEach, describe, expect, it, vi } from "vitest";
import { env, resetEnvCache } from "./env";

afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); });

describe("optional deployment settings", () => {
  it("treats blank optional values from the example file as disabled", () => {
    for (const key of ["TELEGRAM_BSTOCKS_TOKEN", "TELEGRAM_BSTOCKS_SECRET", "TELEGRAM_LAUNCHPAD_TOKEN", "TELEGRAM_LAUNCHPAD_SECRET", "TELEGRAM_BSTOCKS_USERNAME", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "CRON_SECRET", "ASSISTANT_ENABLED"]) vi.stubEnv(key, "");
    resetEnvCache();
    expect(env().TELEGRAM_BSTOCKS_TOKEN).toBeUndefined();
    expect(env().ASSISTANT_ENABLED).toBe(false);
  });
  it("rejects a malformed configured username without including its value in errors", () => {
    vi.stubEnv("TELEGRAM_BSTOCKS_USERNAME", "@not-a-valid-username");
    resetEnvCache();
    expect(() => env()).toThrow("Invalid environment: TELEGRAM_BSTOCKS_USERNAME");
  });
});
