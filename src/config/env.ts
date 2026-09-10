import { z } from "zod";

/**
 * Every variable is optional. A missing token means that surface is off, never a startup throw:
 * an unconfigured deployment should answer 404 to Telegram and 200 to a health check, not crash.
 * This mirrors how the two sibling apps gate their own optional features.
 */
const serverSchema = z.object({
  // Telegram, per surface. The secret is what proves an update really came from Telegram.
  TELEGRAM_BSTOCKS_TOKEN: z.string().min(20).optional(),
  TELEGRAM_BSTOCKS_SECRET: z.string().min(16).max(256).optional(),
  TELEGRAM_LAUNCHPAD_TOKEN: z.string().min(20).optional(),
  TELEGRAM_LAUNCHPAD_SECRET: z.string().min(16).max(256).optional(),

  /** Where health alerts and indexer-lag notices go. A private chat with the operator. */
  TELEGRAM_OPS_CHAT_ID: z.string().optional(),

  /**
   * This service's own public origin, used to build the `/open` handoff link. Without it a trade
   * button has nowhere to point, so the handoff falls back to a plain link into the site.
   */
  BOT_URL: z.string().url().default("https://bot.basestocks.finance"),

  /** Upstream products. Overridable so a preview deployment can point at a preview. */
  BSTOCKS_URL: z.string().url().default("https://basestocks.finance"),
  LAUNCHPAD_URL: z.string().url().default("https://launchpad.basestocks.finance"),

  /**
   * The assistant bridge calls BStocks' own chat endpoint. Off by default: that endpoint meters by
   * request IP, so every Telegram user would share this deployment's bucket until BStocks learns to
   * take an explicit identity. Turn it on only once that is true.
   */
  ASSISTANT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  ASSISTANT_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(0).default(20),

  /** Shared rate-limit and dedup state across serverless instances. Both or neither. */
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  /** Guards /api/cron/*. Vercel sends it as a bearer token. */
  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // A malformed value is a deployment mistake, not a runtime condition: say which key.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam. Never called in production code. */
export function resetEnvCache(): void {
  cached = null;
}
