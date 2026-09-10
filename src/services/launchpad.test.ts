import { describe, expect, it } from "vitest";
import { ANTI_SNIPE_SECONDS, BASE_FEE_BPS, START_FEE_BPS, feeBpsAt, secondsUntilFairFee } from "./launchpad";

/**
 * The anti-snipe curve, checked against the contract it mirrors.
 *
 * `StockPairHook.sol` charges `9900 - ((9900 - 100) * elapsed) / 20` basis points of the stock side
 * for the first twenty seconds after launch, then a flat 100. Getting this wrong in the bot would
 * be worse than not showing it: a card that says a token is live without saying what a trade costs
 * right now invites somebody to pay a 74% fee for a message that read as an invitation.
 */
const LAUNCH = "2026-09-10T12:00:00.000Z";
const at = (seconds: number) => Date.parse(LAUNCH) + seconds * 1_000;

describe("feeBpsAt", () => {
  it("starts at 99%", () => {
    expect(feeBpsAt(LAUNCH, at(0))).toBe(START_FEE_BPS);
  });

  it("decays linearly, matching the contract's integer arithmetic at each second", () => {
    for (let elapsed = 0; elapsed < ANTI_SNIPE_SECONDS; elapsed++) {
      const expected = START_FEE_BPS - Math.floor(((START_FEE_BPS - BASE_FEE_BPS) * elapsed) / ANTI_SNIPE_SECONDS);
      expect(feeBpsAt(LAUNCH, at(elapsed))).toBe(expected);
    }
  });

  it("hits the documented midpoints", () => {
    expect(feeBpsAt(LAUNCH, at(5))).toBe(7_450);
    expect(feeBpsAt(LAUNCH, at(10))).toBe(5_000);
    expect(feeBpsAt(LAUNCH, at(15))).toBe(2_550);
    expect(feeBpsAt(LAUNCH, at(19))).toBe(590);
  });

  it("settles at 1% exactly on the twentieth second and stays there", () => {
    expect(feeBpsAt(LAUNCH, at(20))).toBe(BASE_FEE_BPS);
    expect(feeBpsAt(LAUNCH, at(21))).toBe(BASE_FEE_BPS);
    expect(feeBpsAt(LAUNCH, at(86_400))).toBe(BASE_FEE_BPS);
  });

  it("treats a clock that is behind the launch as the opening fee, never as a discount", () => {
    expect(feeBpsAt(LAUNCH, at(-5))).toBe(START_FEE_BPS);
  });

  it("falls back to the base fee for an unparseable timestamp rather than inventing a countdown", () => {
    expect(feeBpsAt("not a date", at(1))).toBe(BASE_FEE_BPS);
  });
});

describe("secondsUntilFairFee", () => {
  it("counts down whole seconds and stops at zero", () => {
    expect(secondsUntilFairFee(LAUNCH, at(0))).toBe(20);
    expect(secondsUntilFairFee(LAUNCH, at(13))).toBe(7);
    expect(secondsUntilFairFee(LAUNCH, at(19.2))).toBe(1);
    expect(secondsUntilFairFee(LAUNCH, at(20))).toBe(0);
    expect(secondsUntilFairFee(LAUNCH, at(600))).toBe(0);
  });
});
