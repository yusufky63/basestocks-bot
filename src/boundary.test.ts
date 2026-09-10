import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The boundaries this service is built on, enforced rather than reviewed.
 *
 * A rule that lives in a document survives until the first refactor. These three are the ones whose
 * violation would not look like a bug, so they fail the build instead:
 *
 *  1. This process cannot sign. It has no wallet library and no key of any kind.
 *  2. It never calls a route on either sibling app that builds something signable. Those routes are
 *     gated on the caller's country, and a call from this deployment would answer for the wrong
 *     region, turning a compliance control into a hole.
 *  3. Only the designated clients reach the network, so "who can call an upstream" stays a question
 *     with a short, checkable answer.
 */
const ROOT = join(process.cwd(), "src");

function sourceFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const FILES = sourceFiles();
const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

describe("this service cannot sign", () => {
  it("depends on no wallet or signing library", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = ["viem", "ethers", "web3", "@base-org/account", "@coinbase/cdp-sdk", "wagmi", "ox"];
    expect(all.filter((name) => banned.includes(name))).toEqual([]);
  });

  it("never imports one either, in case a transitive package makes it resolvable", () => {
    const offenders = FILES.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["'](viem|ethers|web3|wagmi|ox|@base-org\/account|@coinbase\/cdp-sdk)["']/.test(source);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("holds no private key material by any of the usual names", () => {
    const offenders = FILES.filter((file) =>
      /PRIVATE_KEY|MNEMONIC|SEED_PHRASE|KEEPER_KEY|privateKeyToAccount/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("region-gated routes are never called from here", () => {
  /**
   * BStocks gates `/api/trade/*`, `/api/earn/prepare` and `/api/portfolio/(plan|quote|execute)`.
   * The launchpad gates `POST /api/quote` and `POST /api/metadata`. All of them read the caller's
   * country header, which a request made from this deployment does not carry for the user.
   */
  const FORBIDDEN = [
    "/api/trade/",
    "/api/earn/prepare",
    "/api/portfolio/plan",
    "/api/portfolio/quote",
    "/api/portfolio/execute",
    "/api/onramp",
    "/api/quote",
    "/api/metadata",
  ];

  it.each(FORBIDDEN)("no source file references %s", (path) => {
    const offenders = FILES.filter((file) => readFileSync(file, "utf8").includes(`"${path}`) || readFileSync(file, "utf8").includes(`'${path}`));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("only the designated clients reach the network", () => {
  const ALLOWED = new Set(["lib/http.ts", "lib/store.ts", "lib/telegram/api.ts", "services/assistant.ts"]);

  it("no other module calls fetch", () => {
    const offenders = FILES.filter((file) => {
      if (ALLOWED.has(rel(file))) return false;
      return /\bfetch\s*\(/.test(readFileSync(file, "utf8"));
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("upstream reads go out as GET, since this service has no reason to write to either app", () => {
    const http = readFileSync(join(ROOT, "lib/http.ts"), "utf8");
    expect(http).toContain('method: "GET"');
    expect(http).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  });
});
