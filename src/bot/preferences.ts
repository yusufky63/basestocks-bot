import { getText, putText, updateTextList } from "@/lib/store";
import { isAddress } from "./resolve";

const TTL = 180 * 24 * 60 * 60;
export const WATCH_LIMIT = 24;

/** Store canonical addresses: a stock's symbol can change upstream. */
export async function getWatchlist(userId: number): Promise<string[]> {
  const raw = await getText(`watch:bstocks:${userId}`);
  if (!raw) return [];
  try {
    const items: unknown = JSON.parse(raw);
    return Array.isArray(items)
      ? [...new Set(items.filter((v): v is string => typeof v === "string" && isAddress(v)).map((v) => v.toLowerCase()))].slice(0, WATCH_LIMIT)
      : [];
  } catch { return []; }
}

/** Explicit add/remove is idempotent when an old Telegram button is pressed twice. */
export async function updateWatchlist(userId: number, address: string, add: boolean): Promise<boolean> {
  if (!isAddress(address)) return false;
  return updateTextList(`watch:bstocks:${userId}`, address.toLowerCase(), add, WATCH_LIMIT, TTL);
}

export async function clearWatchlist(userId: number): Promise<boolean> {
  return putText(`watch:bstocks:${userId}`, "[]", 60);
}

export type Prompt = "wallet" | "search";
export async function setPrompt(surface: string, userId: number, prompt: Prompt | null): Promise<void> {
  await putText(`prompt:${surface}:${userId}`, prompt ?? "", prompt ? 600 : 1);
}
export async function getPrompt(surface: string, userId: number): Promise<Prompt | null> {
  const value = await getText(`prompt:${surface}:${userId}`);
  return value === "wallet" || value === "search" ? value : null;
}
