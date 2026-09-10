import { env } from "@/config/env";

/**
 * Handing somebody to a wallet, rather than to a browser tab inside Telegram.
 *
 * Telegram's in-app browser is where this went wrong the first time. A `web_app` button renders the
 * site inside Telegram, and inside that WebView there is no injected provider, a passkey cannot open
 * the popup it needs, and a WalletConnect round trip out to a wallet app and back lands in a fresh
 * session. It looks like it should work and it does not.
 *
 * The reliable move is the opposite: do not bring the wallet to the page, take the page to the
 * wallet. Coinbase's universal link, `https://go.cb-w.com/dapp?cb_url=…`, opens a URL inside
 * the Base app where the wallet is native and already connected. BStocks is already built as a Base
 * mini app, so this is not a workaround, it is the path the app was designed for.
 *
 * One obstacle: Telegram accepts only http(s) in a button, so a custom scheme cannot be the button.
 * Hence `/open`, a page on this service's own domain whose only job is to offer the jump.
 *
 * The rule the rest of the bot follows: **reading happens inside Telegram, signing happens in the
 * wallet.** A portfolio page is fine in a WebView. A trade is not.
 */

/**
 * Where a handoff may point. The host is ours, never the caller's, and the path has to match one of
 * these: `/open` takes a path from a query string, and a page that redirects to an arbitrary
 * destination is an open redirect with a friendly face.
 */
const ALLOWED_PATHS: RegExp[] = [
  /^\/stocks\/0x[0-9a-fA-F]{40}(\?[\w=&%.,:-]*)?$/,
  /^\/token\/0x[0-9a-fA-F]{40}$/,
  /^\/(markets|portfolio|earn|gifts|build|automate|create)(\?[\w=&%.,:+-]*)?$/,
  /^\/build\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^\/pools\/[A-Za-z0-9_-]{1,80}$/,
];

export type App = "bstocks" | "launchpad";

export function isAllowedPath(path: string): boolean {
  return ALLOWED_PATHS.some((rule) => rule.test(path));
}

export function appOrigin(app: App): string {
  return app === "bstocks" ? env().BSTOCKS_URL : env().LAUNCHPAD_URL;
}

/** The full destination, once the path has been checked. Null when it has not. */
export function destination(app: App, path: string): string | null {
  if (!isAllowedPath(path)) return null;
  return new URL(path, appOrigin(app)).toString();
}

/**
 * The button's URL: this service's own `/open`, which Telegram will accept, carrying the app and
 * the path rather than a whole URL, so there is nothing for a caller to redirect to.
 */
export function handoffUrl(app: App, path: string, label?: string): string {
  const url = new URL("/open", env().BOT_URL);
  url.searchParams.set("app", app);
  url.searchParams.set("to", path);
  if (label) url.searchParams.set("label", label.slice(0, 40));
  return url.toString();
}

/**
 * Opens the destination in the Base app, using Coinbase's documented universal link.
 *
 * The custom scheme `cbwallet://` was here first and it was wrong. A Telegram Mini App runs in a
 * container that refuses to navigate to an arbitrary scheme, and a desktop browser has no handler
 * for one either, so both answered a tap with a scheme error rather than opening anything.
 *
 * A universal link is an ordinary https URL, which every one of those surfaces will follow, and
 * which the operating system hands to the Base app when it is installed. `cb_url` is
 * percent-encoded so the destination's own query survives being carried inside another one.
 */
export function baseAppLink(target: string): string {
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(target)}`;
}

/**
 * Opens the destination inside MetaMask's own browser.
 *
 * MetaMask's universal link takes a bare host and path with no scheme, which is why this strips it
 * rather than passing the URL through.
 */
export function metaMaskLink(target: string): string {
  return `https://metamask.app.link/dapp/${target.replace(/^https?:\/\//i, "")}`;
}
