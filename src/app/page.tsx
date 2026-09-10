import { enabledSurfaces } from "@/config/surfaces";

/**
 * There is no product here. This page exists so that a person who follows the deployment URL out of
 * curiosity gets a sentence instead of a 404, and so an operator can see at a glance which surfaces
 * this instance answers for. It names no token, no chat and no user.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  const surfaces = enabledSurfaces();
  return (
    <main style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>BaseStocks Bot</h1>
      <p style={{ margin: "0 0 16px" }}>
        Telegram bots for <a href="https://basestocks.finance">basestocks.finance</a> and the{" "}
        <a href="https://launchpad.basestocks.finance">BaseStocks Launchpad</a>.
      </p>
      <p style={{ margin: "0 0 16px" }}>
        They read the public APIs of both products and hand every action back as a link you open in
        your own wallet. This service holds no keys, no funds and no wallet library.
      </p>
      <p style={{ margin: "0 0 16px" }}>
        Active surfaces: {surfaces.length > 0 ? surfaces.join(", ") : "none configured"}.
      </p>
      <p style={{ margin: 0, color: "#858c9c" }}>
        Coinbase Tokenized Stocks are offered only to eligible persons outside the United States.
      </p>
    </main>
  );
}
