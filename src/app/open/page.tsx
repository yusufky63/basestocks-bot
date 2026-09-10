import { appOrigin, baseAppLink, destination, metaMaskLink, type App } from "@/lib/handoff";

/**
 * The one page this service renders, and it exists for one reason.
 *
 * A trade needs a wallet, and Telegram's in-app browser does not have one: no injected provider, no
 * popup for a passkey, and a WalletConnect round trip that comes back to a session that is gone. So
 * this page does not try to hold the wallet. It offers the jump into an app that already has one,
 * where BStocks runs as a mini app with the wallet connected on arrival.
 *
 * Why a page at all, rather than a button straight to `cbwallet://`: Telegram accepts only http(s)
 * in a button. And why a button here rather than an automatic redirect: a scheme jump without a tap
 * is blocked in some webviews and silently does nothing, which is the worst outcome of the three.
 * One deliberate tap always works.
 */
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ app?: string; to?: string; label?: string }>;
}

export default async function OpenPage({ searchParams }: Props) {
  const { app: rawApp, to, label } = await searchParams;
  const app: App = rawApp === "launchpad" ? "launchpad" : "bstocks";
  const target = to ? destination(app, to) : null;

  if (!target) {
    return (
      <Shell title="Nothing to open">
        <p style={p}>
          That link has expired or was not built by the bot. Open{" "}
          <a href={appOrigin(app)} style={a}>
            {appOrigin(app).replace(/^https?:\/\//, "")}
          </a>{" "}
          directly instead.
        </p>
      </Shell>
    );
  }

  const what = label ? label : "Continue";

  return (
    <Shell title={what}>
      <p style={p}>
        Pick where to open it. Your wallet lives in one of these apps, so the page has to run there:
        a browser inside a chat app has no wallet to sign with.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "22px 0" }}>
        <a href={baseAppLink(target)} style={primary}>
          Open in Base app
          <span style={hint}>Wallet already connected. Recommended.</span>
        </a>
        <a href={metaMaskLink(target)} style={secondary}>
          Open in MetaMask
          <span style={hint}>Uses MetaMask&apos;s own browser.</span>
        </a>
        <a href={target} style={secondary}>
          Open in this browser
          <span style={hint}>Works if your wallet is an extension, or you use a passkey.</span>
        </a>
      </div>

      <p style={{ ...p, fontSize: 12, color: "#858c9c" }}>
        Nothing is signed by opening a link. You review and confirm in your own wallet, and this
        service holds no keys and cannot sign anything.
      </p>
      <p style={{ ...p, fontSize: 12, color: "#858c9c", wordBreak: "break-all" }}>{target}</p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

const p = { margin: "0 0 12px", fontSize: 14, lineHeight: 1.6, color: "#4a5160" } as const;
const a = { color: "#0b45e0" } as const;
const hint = { display: "block", fontSize: 12, fontWeight: 400, opacity: 0.75, marginTop: 2 } as const;

const buttonBase = {
  display: "block",
  padding: "13px 16px",
  borderRadius: 8,
  textDecoration: "none",
  fontSize: 15,
  fontWeight: 500,
  border: "1px solid #e3e6ed",
} as const;

const primary = { ...buttonBase, background: "#0b45e0", borderColor: "#0b45e0", color: "#fff" } as const;
const secondary = { ...buttonBase, background: "#fff", color: "#14171f" } as const;

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#858c9c" }}>
        BaseStocks
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 16px", color: "#14171f" }}>{title}</h1>
      {children}
    </main>
  );
}
