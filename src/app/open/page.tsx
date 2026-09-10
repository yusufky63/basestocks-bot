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
  const { app: rawApp, to, label } = await searchParams;
  const app: App = rawApp === "launchpad" ? "launchpad" : "bstocks";
  const target = to ? destination(app, to) : null;

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <style>{THEME}</style>
      <main style={{ maxWidth: 460, margin: "0 auto", padding: "28px 20px 40px" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          BaseStocks
        </div>

        {target ? (
          <>
            <h1 style={heading}>{label ? label : "Continue"}</h1>
            <p style={body}>
              Pick where to open it. Your wallet lives in one of these apps, and a page has to run
              where the wallet is: a browser inside a chat app has nothing to sign with.
            </p>
            <OpenChoices target={target} label={label ?? ""} />
            <p style={{ ...body, fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>{target}</p>
          </>
        ) : (
          <>
            <h1 style={heading}>Nothing to open</h1>
            <p style={body}>
              That link has expired or was not built by the bot. Open{" "}
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

const heading = { fontSize: 22, fontWeight: 600, margin: "6px 0 14px", color: "var(--ink)" } as const;
const body = { margin: "0 0 12px", fontSize: 14, lineHeight: 1.6, color: "var(--body)" } as const;

/**
 * Telegram publishes the user's theme as CSS variables on the container, so the page can match the
 * client instead of fighting it. The fallbacks are what a browser gets, and the dark block is what
 * a browser in dark mode gets, since `--tg-*` will not be defined there at all.
 */
const THEME = `
:root {
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
@media (prefers-color-scheme: dark) {
  :root {
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
