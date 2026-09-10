"use client";

import { useEffect, useState } from "react";

/**
 * The choices, rendered so they work in the two places this page is opened.
 *
 * As a Telegram Mini App it runs in Telegram's own container: native header, native close button,
 * the user's theme. Opened as a plain link it is an ordinary page. The difference matters for how a
 * link is followed, not for what is offered, so only the handlers below know which one it is.
 */
interface TelegramWebApp {
  initData?: string;
  ready: () => void;
  expand: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  close: () => void;
  themeParams?: Record<string, string>;
  colorScheme?: "light" | "dark";
  MainButton?: { hide: () => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function OpenChoices({ target, label }: { target: string; label: string }) {
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    // The only thing the effect does is tell an external system we are here. Telegram keeps the
    // loading shimmer up until `ready()`, so without this the container looks broken for a moment.
    // Whether Telegram is hosting is read at click time instead of held in state: it cannot change
    // while the page is open, so there is nothing to re-render for.
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  /**
   * Every choice is an ordinary https link, and inside Telegram each has to go through `openLink`.
   *
   * A plain navigation would replace the Mini App with the page and strand the person with no way
   * back; `openLink` opens it outside and leaves the Mini App where it was, which is also what lets
   * the operating system route a universal link to the wallet app instead of a browser tab.
   */
  const openHttp = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    const tg = window.Telegram?.WebApp;
    // The SDK also creates WebApp in ordinary browsers. Only a launched Mini App has initData.
    if (tg?.initData) {
      event.preventDefault();
      tg.openLink(url);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "22px 0" }}>
      <a href={baseAppLink(target)} onClick={(event) => openHttp(event, baseAppLink(target))} style={primary}>
        Open in Base app
        <span style={hint}>Use the wallet in your Base app.</span>
      </a>
      <a href={metaMaskLink(target)} onClick={(event) => openHttp(event, metaMaskLink(target))} style={secondary}>
        Open in MetaMask
        <span style={hint}>Uses MetaMask&apos;s own browser.</span>
      </a>
      <a href={target} onClick={(event) => openHttp(event, target)} style={secondary}>
        Open in a browser
        <span style={hint}>For an extension wallet, or a passkey.</span>
      </a>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(target); setCopyStatus("Link copied. Paste it in your wallet browser."); }
        catch { setCopyStatus("Copy is unavailable. Open “View full link” below to copy the destination."); }
      }} style={{ ...secondary, textAlign: "center", fontSize: 13 }}>Copy link</button>
      <span role="status" style={{ fontSize: 12, color: "var(--body)", minHeight: 18 }}>{copyStatus}</span>
      <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--muted)" }}>
        {label ? `${label}. ` : ""}Nothing is signed by opening a link: you review and confirm in your
        own wallet, and this service holds no keys and cannot sign anything.
      </p>
    </div>
  );
}

/** Kept in the client bundle so the handlers can build them without another round trip. */
function baseAppLink(target: string): string {
  // Coinbase's universal link, not the `cbwallet://` scheme: a Mini App container refuses to
  // navigate to an arbitrary scheme and a desktop browser has no handler for one, so both used to
  // answer a tap with a scheme error. See src/lib/handoff.ts for the whole reason.
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(target)}`;
}

function metaMaskLink(target: string): string {
  return `https://metamask.app.link/dapp/${target.replace(/^https?:\/\//i, "")}`;
}

const buttonBase = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "17px 18px",
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  border: "1px solid var(--line)",
} as const;

const primary = {
  ...buttonBase,
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "var(--accent-ink)",
} as const;

const secondary = { ...buttonBase, background: "var(--surface)", color: "var(--ink)" } as const;
const hint = { display: "block", fontSize: 12, fontWeight: 400, opacity: 0.75, marginTop: 2 } as const;
