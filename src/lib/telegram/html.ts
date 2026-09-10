/**
 * HTML is the parse mode this bot uses, and the reason is arithmetic.
 *
 * Telegram's HTML mode asks you to escape three characters (`&`, `<`, `>`); MarkdownV2 asks for
 * eighteen, and missing one does not mangle a word, it rejects the whole message with a 400. Three
 * characters can be escaped correctly by one function with a test beside it.
 */
const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** Escapes text for Telegram's HTML parse mode. Ampersand first is implicit in the character class. */
export function esc(input: string): string {
  return input.replace(/[&<>]/g, (c) => MAP[c] ?? c);
}

/** `<b>`, escaping the content. Every helper escapes so a caller cannot forget. */
export const b = (s: string): string => `<b>${esc(s)}</b>`;
export const i = (s: string): string => `<i>${esc(s)}</i>`;
export const code = (s: string): string => `<code>${esc(s)}</code>`;

/**
 * A link. The href is escaped too, and only http(s) survives: `javascript:` and `tg://` in a
 * rendered link are a phishing primitive, and no reply this bot writes needs either.
 */
export function link(label: string, href: string): string {
  const safe = /^https?:\/\//i.test(href) ? href : "";
  if (!safe) return esc(label);
  return `<a href="${esc(safe).replace(/"/g, "&quot;")}">${esc(label)}</a>`;
}

export const TELEGRAM_TEXT_LIMIT = 4_096;

/**
 * Splits an over-long message at line boundaries.
 *
 * Telegram counts UTF-16 code units, and a cut inside a tag produces a 400 rather than a truncated
 * message, so the split only ever happens between lines this module itself joined.
 */
export function splitMessage(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    // A single line longer than the limit is chopped; nothing this bot writes should reach here.
    if (line.length > limit) {
      for (let at = 0; at < line.length; at += limit) out.push(line.slice(at, at + limit));
      current = "";
    } else {
      current = line;
    }
  }
  if (current) out.push(current);
  return out;
}
