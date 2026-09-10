import { describe, expect, it } from "vitest";
import { b, esc, link, splitMessage, TELEGRAM_TEXT_LIMIT } from "./html";

describe("esc", () => {
  it("escapes exactly the three characters Telegram's HTML mode reserves", () => {
    expect(esc("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("leaves everything else alone, unlike MarkdownV2 which would need eighteen escapes", () => {
    expect(esc("100% up! (a-b) [c] {d} *e* _f_ `g` #h +i =j .k")).toBe("100% up! (a-b) [c] {d} *e* _f_ `g` #h +i =j .k");
  });

  it("escapes an injected tag rather than rendering it", () => {
    expect(esc('<a href="x">click</a>')).toBe('&lt;a href="x"&gt;click&lt;/a&gt;');
  });

  it("escapes content passed through the tag helpers", () => {
    expect(b("<script>")).toBe("<b>&lt;script&gt;</b>");
  });
});

describe("link", () => {
  it("renders http and https", () => {
    expect(link("Open", "https://basestocks.finance/markets")).toBe('<a href="https://basestocks.finance/markets">Open</a>');
  });

  it("refuses any other scheme, which is what stops a creator-supplied URL becoming a payload", () => {
    expect(link("Open", "javascript:alert(1)")).toBe("Open");
    expect(link("Open", "tg://resolve?domain=evil")).toBe("Open");
    expect(link("Open", "data:text/html,<script>")).toBe("Open");
  });

  it("escapes the href it does accept", () => {
    expect(link("Open", "https://x.test/?a=1&b=2")).toBe('<a href="https://x.test/?a=1&amp;b=2">Open</a>');
  });
});

describe("splitMessage", () => {
  it("leaves a short message as one part", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("splits at line boundaries so a cut never lands inside a tag", () => {
    const line = "x".repeat(1_000);
    const parts = splitMessage(Array.from({ length: 6 }, () => line).join("\n"));
    expect(parts.length).toBe(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(parts.join("\n").replace(/\n/g, "")).toBe(line.repeat(6));
  });

  it("chops a single line that is longer than the limit on its own", () => {
    const parts = splitMessage("y".repeat(TELEGRAM_TEXT_LIMIT + 10));
    expect(parts.length).toBe(2);
    expect(parts[0]?.length).toBe(TELEGRAM_TEXT_LIMIT);
    expect(parts[1]?.length).toBe(10);
  });
});
