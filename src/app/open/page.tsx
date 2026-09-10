import Script from "next/script";
import { appOrigin, destination, type App } from "@/lib/handoff";
import { OpenChoices } from "./OpenChoices";

/**
 * The handoff, rendered as a Telegram Mini App.
 *
 * A trade needs a wallet and Telegram's own browser does not have one: no injected provider, no
 * popup for a passkey, and a WalletConnect round trip that returns to a session that is gone. So
 * this page does not try to hold a wallet. It offers the jump into an app that already has one,
 * where BStocks runs as a Base mini app with the wallet connected on arrival.
 *
 * It opens as a Mini App rather than in Telegram's browser because the browser step looked like
 * being dumped out of the conversation, which is exactly the thing it was meant to avoid. Inside
 * Telegram's container it keeps the native header, the close button and the user's own theme, and
 * the jump out happens from a button the person deliberately presses.
 *
 * The page renders fully server-side and needs no script to be useful: the Telegram SDK only makes
 * it feel native, and its absence costs nothing but the theme.
 */
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ app?: string; to?: string; label?: string }>;
}

export default async function OpenPage({ searchParams }: Props) {
  const { app: rawApp, to, label: rawLabel } = await searchParams;
  const label = rawLabel?.slice(0, 80);
  const app: App = rawApp === "launchpad" ? "launchpad" : "bstocks";
  const target = to ? destination(app, to) : null;

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <style>{THEME}</style>
      <main className="handoff" style={{ maxWidth: 460, margin: "0 auto", padding: "max(28px, env(safe-area-inset-top)) 20px max(40px, env(safe-area-inset-bottom))" }}>
        <div aria-hidden="true" style={{ width: 40, height: 40, background: "var(--accent)", color: "var(--accent-ink)", display: "grid", placeItems: "center", borderRadius: 12, fontSize: 24, marginBottom: 24 }}>↗</div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          {app === "bstocks" ? "BaseStocks" : "BaseStocks Launchpad"} · Continue in your wallet
        </div>

        {target ? (
          <>
            <h1 style={heading}>{label ? label : "Continue"}</h1>
            <p style={body}>
              Choose where to open BaseStocks. Review the details there, then confirm with your wallet when you are ready.
            </p>
            <OpenChoices target={target} label={label ?? ""} />
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18, marginTop: 24 }}>
              <p style={{ ...body, fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase" }}>Destination</p>
              <p style={{ ...body, fontSize: 13, color: "var(--ink)", overflowWrap: "anywhere" }}>{new URL(target).host}</p>
              <details style={{ color: "var(--muted)", fontSize: 12 }}><summary>View full link</summary><p style={{ overflowWrap: "anywhere" }}>{target}</p></details>
            </div>
          </>
        ) : (
          <>
            <h1 style={heading}>Nothing to open</h1>
            <p style={body}>
              This link is not a supported BaseStocks destination. Return to the bot and choose an action, or open{" "}
              <a href={appOrigin(app)} style={{ color: "var(--accent)" }}>
                {appOrigin(app).replace(/^https?:\/\//, "")}
              </a>{" "}
              directly instead.
            </p>
          </>
        )}
      </main>
    </>
  );
}

const heading = { fontSize: 30, lineHeight: 1.2, letterSpacing: "-.035em", fontWeight: 650, margin: "12px 0 16px", color: "var(--ink)", overflowWrap: "anywhere" } as const;
const body = { margin: "0 0 12px", fontSize: 14, lineHeight: 1.6, color: "var(--body)" } as const;

/**
 * Telegram publishes the user's theme as CSS variables on the container, so the page can match the
 * client instead of fighting it. The fallbacks are what a browser gets, and the dark block is what
 * a browser in dark mode gets, since `--tg-*` will not be defined there at all.
 */
const THEME = `
:root {
  color-scheme: light dark;
  --page-bg: var(--tg-theme-bg-color, #fbfbfd);
  --ink: var(--tg-theme-text-color, #14171f);
  --body: var(--tg-theme-hint-color, #4a5160);
  --muted: var(--tg-theme-hint-color, #858c9c);
  --line: var(--tg-theme-section-separator-color, #e3e6ed);
  --surface: var(--tg-theme-secondary-bg-color, #ffffff);
  --accent: var(--tg-theme-button-color, #0b45e0);
  --accent-ink: var(--tg-theme-button-text-color, #ffffff);
}
body {
  background: var(--tg-theme-bg-color, #fbfbfd);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
}
.handoff *, .handoff *::before, .handoff *::after { box-sizing: border-box; }
.handoff a { text-decoration: none; }
.handoff a:focus-visible, .handoff button:focus-visible, .handoff summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
.handoff a:hover { filter: brightness(.96); }
.handoff summary { cursor: pointer; padding: 8px 0; }
@media (prefers-color-scheme: dark) {
  :root {
    --page-bg: var(--tg-theme-bg-color, #0c0e13);
    --ink: var(--tg-theme-text-color, #e8ebf2);
    --body: var(--tg-theme-hint-color, #a8b0c0);
    --muted: var(--tg-theme-hint-color, #737b8b);
    --line: var(--tg-theme-section-separator-color, #242a36);
    --surface: var(--tg-theme-secondary-bg-color, #141821);
    --accent: var(--tg-theme-button-color, #6e9bff);
    --accent-ink: var(--tg-theme-button-text-color, #0c0e13);
  }
  body { background: var(--tg-theme-bg-color, #0c0e13); }
}
`;
