import { describe, expect, it } from "vitest";
import { assistantCard } from "./assistant-card";
import type { AssistantAction } from "@/services/assistant";

const trade: AssistantAction = {
  kind: "trade",
  side: "buy",
  symbol: "NVDA",
  name: "NVIDIA",
  assetAddress: `0x${"a".repeat(40)}`,
  amountUsd: 50,
  payWith: "USDC",
  indicative: { priceUsd: 223.32, estOut: "0.2239", provider: "kyber", feeUsd: 0.004 },
};

describe("assistantCard", () => {
  /**
   * The point of the card: the figures come from the typed draft the app already priced, not from
   * the model's sentence. If the two ever disagreed, this is the one that would be right.
   */
  it("builds the draft from the typed fields, not from the prose", () => {
    const html = assistantCard("Anything at all.", [trade]);
    expect(html).toContain("Draft · Buy NVDA");
    expect(html).toContain("$50.00 USDC");
    expect(html).toContain("~0.2239 NVDA");
    expect(html).toContain("kyber");
  });

  it("quotes the prose, and makes a long answer collapsible so it cannot bury the draft", () => {
    const short = assistantCard("Two words.", []);
    expect(short).toContain("<blockquote>");
    expect(short).not.toContain("expandable");

    const long = assistantCard("line\n".repeat(12), []);
    expect(long).toContain("<blockquote expandable>");
  });

  it("escapes model output, which is data like any other outside string", () => {
    expect(assistantCard("<script>alert(1)</script>", [])).toContain("&lt;script&gt;");
    expect(assistantCard("<b>bold</b>", [])).not.toContain("<b>bold</b>");
  });

  it("lists what it cited rather than letting the model claim a source", () => {
    const html = assistantCard("Here is why.", [
      { kind: "news", scope: "stock", items: [{ title: "A headline", url: "https://x.test/a", source: "Reuters" }] },
    ]);
    expect(html).toContain("Cited");
    expect(html).toContain("Reuters");
  });

  it("says something rather than nothing when there is neither prose nor a draft", () => {
    expect(assistantCard("", [])).toContain("could not find an answer");
  });
});
