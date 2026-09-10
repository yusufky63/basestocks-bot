"use client";

import { useEffect } from "react";

/**
 * The choices, rendered so they work in the two places this page is opened.
 *
 * As a Telegram Mini App it runs in Telegram's own container: native header, native close button,
 * the user's theme. Opened as a plain link it is an ordinary page. The difference matters for how a
 * link is followed, not for what is offered, so only the handlers below know which one it is.
 */
interface TelegramWebApp {
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
  useEffect(() => {
    // The only thing the effect does is tell an external system we are here. Telegram keeps the
    // loading shimmer up until `ready()`, so without this the container looks broken for a moment.
    // Whether Telegram is hosting is read at click time instead of held in state: it cannot change
    // while the page is open, so there is nothing to re-render for.
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  /**
   * A custom scheme has to be a navigation, not `openLink`.
   *
   * Telegram's `openLink` is for http(s) and quietly does nothing with `cbwallet://`. Setting
   * `location.href` hands the scheme to the operating system, which is what actually switches apps.
   */
  const openScheme = (url: string) => {
    window.location.href = url;
  };

  /**
   * An http link, on the other hand, must go through `openLink` when Telegram is hosting: a plain
   * navigation would replace the Mini App with the page and strand the user with no way back.
   */
  const openHttp = (url: string) => {
    const tg = window.Telegram?.WebApp;
    if (tg) tg.openLink(url);
    else window.location.href = url;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "22px 0" }}>
      <button type="button" onClick={() => openScheme(baseAppLink(target))} style={primary}>
        Open in Base app
        <span style={hint}>Wallet already connected. Recommended.</span>
      </button>
      <button type="button" onClick={() => openScheme(metaMaskLink(target))} style={secondary}>
        Open in MetaMask
        <span style={hint}>Uses MetaMask&apos;s own browser.</span>
      </button>
      <button type="button" onClick={() => openHttp(target)} style={secondary}>
        Open in a browser
        <span style={hint}>For an extension wallet, or a passkey.</span>
      </button>
      <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--muted)" }}>
        {label ? `${label}. ` : ""}Nothing is signed by opening a link: you review and confirm in your
        own wallet, and this service holds no keys and cannot sign anything.
      </p>
    </div>
  );
}

/** Kept in the client bundle so the handlers can build them without another round trip. */
function baseAppLink(target: string): string {
  return `cbwallet://miniapp?url=${encodeURIComponent(target)}`;
}

function metaMaskLink(target: string): string {
  return `https://metamask.app.link/dapp/${target.replace(/^https?:\/\//i, "")}`;
}

const buttonBase = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "13px 16px",
  borderRadius: 10,
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
