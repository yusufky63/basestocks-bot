import { getText, putText } from "@/lib/store";
import type { AssistantTurn } from "@/services/assistant";

/**
 * The last few turns of one conversation.
 *
 * Without this the assistant answers every message as if it were the first, which is not a
 * theoretical problem: it ends its own replies with "want me to adjust the size?", and a bot that
 * cannot hear the answer to its own question is worse than one that never asked.
 *
 * Deliberately small and deliberately brief. Six turns is more than enough for "make it fifty
 * instead" and short of anything worth calling a transcript; thirty minutes is long enough for a
 * conversation and short enough that a phone left on a table forgets. Keyed by chat rather than by
 * user, because a reply belongs to the thread it was typed into.
 */
const MAX_TURNS = 6;
const TTL_SEC = 30 * 60;
const MAX_CHARS = 4_000;

function key(chatId: number | string): string {
  return `hist:${chatId}`;
}

export async function loadHistory(chatId: number | string): Promise<AssistantTurn[]> {
  const raw = await getText(key(chatId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AssistantTurn[];
    if (!Array.isArray(parsed)) return [];
    // Anything that has drifted from the shape is dropped rather than repaired: a malformed history
    // is not worth a broken turn, and the cost of losing it is one repeated question.
    return parsed
      .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string")
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

export async function appendTurns(
  chatId: number | string,
  question: string,
  answer: string,
): Promise<void> {
  const previous = await loadHistory(chatId);
  const next: AssistantTurn[] = [
    ...previous,
    { role: "user" as const, content: question },
    { role: "assistant" as const, content: answer },
  ].slice(-MAX_TURNS);

  // Trim from the oldest end until the whole thing fits, so one long answer cannot push the budget
  // over and start failing every later turn.
  let trimmed = next;
  while (trimmed.length > 2 && JSON.stringify(trimmed).length > MAX_CHARS) trimmed = trimmed.slice(1);
  await putText(key(chatId), JSON.stringify(trimmed), TTL_SEC);
}

/** Used by `/start` and `/reset`, so somebody can put the conversation down. */
export async function clearHistory(chatId: number | string): Promise<void> {
  await putText(key(chatId), "[]", 60);
}
