/** Number and time formatting for chat messages. Terse, because a phone screen is narrow. */

export function usd(value: number | null | undefined, maxFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  // Below a cent, two decimals would print $0.00 and read as free rather than as small.
  const digits = abs > 0 && abs < 0.01 ? 6 : abs < 1 ? 4 : maxFractionDigits;
  // Ordinary prices keep both decimals even when the second is a zero, so a column of them lines up
  // in a monospace block: $371.30 under $225.24, not $371.3.
  const minimum = abs >= 1 ? Math.min(2, digits) : 0;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: minimum, maximumFractionDigits: digits })}`;
}

export function compactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return usd(value);
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/**
 * A move, with the arrow that makes a list scannable without colour.
 *
 * The arrow carries the sign, so the number must not carry it too: `pct` would print a `+` for the
 * absolute value and render a fall as "▼ +0.87%", which reads as a contradiction and was live in
 * production for exactly one deploy.
 */
export function move(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  return `${arrow} ${Math.abs(value).toFixed(digits)}%`;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** "3 dk önce" style, in English because every reply in this build is English. */
export function ago(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1_000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3_600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3_600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

/**
 * Pads a label so a column of them lines up in a monospace block.
 * Telegram renders `<pre>` in a fixed-pitch face, which is the only way to get a table in a chat.
 */
export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

export function padStart(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : " ".repeat(width - text.length) + text;
}
