import { describe, expect, it } from "vitest";
import { move, pct, usd, compactUsd } from "./format";

describe("move", () => {
  it("puts the sign in the arrow and nowhere else", () => {
    expect(move(1.24)).toBe("▲ 1.24%");
    expect(move(-0.87)).toBe("▼ 0.87%");
    expect(move(0)).toBe("• 0.00%");
  });

  it("says nothing rather than zero when there is no reading", () => {
    expect(move(null)).toBe("—");
    expect(move(undefined)).toBe("—");
    expect(move(Number.NaN)).toBe("—");
  });
});

describe("pct", () => {
  it("keeps its own sign, since it is used where no arrow carries it", () => {
    expect(pct(1.5)).toBe("+1.50%");
    expect(pct(-1.5)).toBe("-1.50%");
  });
});

describe("usd", () => {
  it("keeps two decimals on ordinary prices so a monospace column lines up", () => {
    expect(usd(371.3)).toBe("$371.30");
    expect(usd(1765.834)).toBe("$1,765.83");
  });

  it("opens up the scale rather than printing $0.00 for something small but real", () => {
    expect(usd(0.000011)).toBe("$0.000011");
    expect(usd(0.5)).toBe("$0.5");
  });

  it("says nothing when there is no price", () => {
    expect(usd(null)).toBe("—");
  });
});

describe("compactUsd", () => {
  it("shortens large figures the way a phone screen needs", () => {
    expect(compactUsd(2_840_000)).toBe("$2.84M");
    expect(compactUsd(971_500)).toBe("$971.5K");
    expect(compactUsd(1_200_000_000)).toBe("$1.20B");
  });
});
