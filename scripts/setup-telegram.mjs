#!/usr/bin/env node
/**
 * Registers a bot with Telegram. Run once per surface, and again whenever the command list or the
 * public URL changes. Never at runtime: `setWebhook` is a configuration step, and a service that
 * re-registers itself on boot will fight with every other instance of itself.
 *
 *   node scripts/setup-telegram.mjs secret               mint a secret Telegram will accept
 *   node scripts/setup-telegram.mjs bstocks   [--drop]   register the BStocks handle
 *   node scripts/setup-telegram.mjs launchpad [--drop]   register the launchpad handle
 *   node scripts/setup-telegram.mjs info bstocks         what Telegram currently thinks
 *   node scripts/setup-telegram.mjs delete bstocks       stop delivery, the kill switch of last resort
 *
 * Reads .env from the project root, or the real environment, whichever has the key.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.telegram.org";

const SURFACES = {
  bstocks: { token: "TELEGRAM_BSTOCKS_TOKEN", secret: "TELEGRAM_BSTOCKS_SECRET" },
  launchpad: { token: "TELEGRAM_LAUNCHPAD_TOKEN", secret: "TELEGRAM_LAUNCHPAD_SECRET" },
};

/**
 * Read from the same file the app's own type does, because this list was duplicated once and the
 * copy here kept registering the old set after `callback_query` was added: every button would have
 * done nothing, silently.
 */
const registration = JSON.parse(readFileSync(resolve(ROOT, "src/lib/telegram/registration.json"), "utf8"));
const ALLOWED_UPDATES = registration.allowedUpdates;

function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(resolve(ROOT, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (env[key] !== undefined) continue;
      env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env is normal in CI, where the real environment carries the keys.
  }
  return env;
}

/**
 * `secret_token` accepts only A-Z, a-z, 0-9, `_` and `-`, 1 to 256 characters. Plain base64 emits
 * `+`, `/` and `=`, and Telegram rejects the registration rather than the first request, which is a
 * confusing way to find out. base64url is the encoding that fits the charset exactly.
 */
function mintSecret() {
  return randomBytes(32).toString("base64url");
}

async function call(token, method, params) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description ?? "failed"}`);
  return body.result;
}

async function register(surface, { drop, dryRun }) {
  const env = loadEnv();
  const keys = SURFACES[surface];
  const token = env[keys.token];
  const secret = env[keys.secret];
  const appUrl = env.BOT_URL || env.APP_URL || env.NEXT_PUBLIC_APP_URL || (dryRun ? "https://bot.basestocks.finance" : undefined);
  if (env.APP_URL && env.BOT_URL && new URL(env.APP_URL).origin !== new URL(env.BOT_URL).origin) {
    throw new Error("APP_URL and BOT_URL must use the same origin so wallet links reach this bot deployment.");
  }

  const table = JSON.parse(readFileSync(resolve(ROOT, "src/bot/commands.data.json"), "utf8"));
  const commands = table[surface];
  const personal = new Set(registration.personalCommands);
  const groupCommands = commands.filter((c) => !personal.has(c.command));
  const profile = registration.profiles[surface];
  if (commands.length > 100 || new Set(commands.map((c) => c.command)).size !== commands.length || commands.some((c) => !/^[a-z0-9_]{1,32}$/.test(c.command) || c.description.length < 1 || c.description.length > 256)) throw new Error("Invalid Telegram command menu.");
  if (profile.name.length > 64 || profile.short_description.length > 120 || profile.description.length > 512) throw new Error("Bot profile exceeds a Telegram length limit.");
  if (dryRun) {
    console.log(JSON.stringify({ surface, webhook: new URL(`/api/telegram/${surface}/webhook`, appUrl).toString(), allowedUpdates: ALLOWED_UPDATES, profile, commands, groupCommands, menuButton: { type: "commands" }, dropsPendingUpdates: Boolean(drop) }, null, 2));
    return;
  }

  if (!token) throw new Error(`${keys.token} is not set.`);
  if (!secret) throw new Error(`${keys.secret} is not set. Run: node scripts/setup-telegram.mjs secret`);
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    throw new Error(`${keys.secret} has characters Telegram will not accept. Only A-Z a-z 0-9 _ - are allowed.`);
  }
  if (!appUrl) throw new Error("APP_URL is not set (for example https://bot.basestocks.finance).");
  if (!appUrl.startsWith("https://")) throw new Error("APP_URL must be https; Telegram will not deliver to anything else.");

  const me = await call(token, "getMe");
  const url = new URL(`/api/telegram/${surface}/webhook`, appUrl).toString();

  await call(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ALLOWED_UPDATES,
    // Only on request: dropping is right after a long outage and wrong on an ordinary redeploy,
    // where it would throw away messages people are still waiting on.
    drop_pending_updates: Boolean(drop),
    max_connections: 40,
  });


  /**
   * Groups see a shorter list, because two commands here answer with somebody's own holdings and a
   * menu entry that cannot work in the chat it is shown in is worse than no entry. The router
   * refuses them there as well: a scope hides an entry, it does not refuse the command.
   */
  await call(token, "setMyCommands", { commands: groupCommands, scope: { type: "default" } });
  await call(token, "setMyCommands", { commands, scope: { type: "all_private_chats" } });
  await call(token, "setMyCommands", { commands: groupCommands, scope: { type: "all_group_chats" } });

  /**
   * English only, by decision.
   *
   * Telegram will serve a per-language menu if you give it one, and a localized set was tried. It
   * came back out: this bot's own copy, the eligibility notice it has to reproduce rather than
   * paraphrase, and every reply it writes are English, so a Turkish menu leading into an English
   * conversation is a promise the next screen breaks.
   */

  // The button beside the message box. `commands` is the default, but setting it explicitly means a
  // leftover web_app button from an experiment cannot survive a redeploy.
  await call(token, "setChatMenuButton", { menu_button: { type: "commands" } });
  await call(token, "setMyName", { name: profile.name });
  await call(token, "setMyDescription", { description: profile.description });
  await call(token, "setMyShortDescription", { short_description: profile.short_description });

  const info = await call(token, "getWebhookInfo");
  console.log(`@${me.username} (${surface})`);
  console.log(`  webhook        ${info.url}`);
  console.log(`  secret         set (${secret.length} chars)`);
  console.log(`  updates        ${(info.allowed_updates ?? ALLOWED_UPDATES).join(", ")}`);
  console.log(`  pending        ${info.pending_update_count ?? 0}`);
  console.log(`  commands       ${commands.length} private, ${groupCommands.length} group`);
  if (info.last_error_message) console.log(`  last error     ${info.last_error_message}`);
  console.log("");
  console.log("  Inline mode is a BotFather setting, not an API call: /setinline on @BotFather.");
}

async function info(surface) {
  const env = loadEnv();
  const token = env[SURFACES[surface].token];
  if (!token) throw new Error(`${SURFACES[surface].token} is not set.`);
  console.log(JSON.stringify(await call(token, "getWebhookInfo"), null, 2));
}

async function remove(surface) {
  const env = loadEnv();
  const token = env[SURFACES[surface].token];
  if (!token) throw new Error(`${SURFACES[surface].token} is not set.`);
  await call(token, "deleteWebhook", { drop_pending_updates: false });
  console.log(`${surface}: webhook deleted. Telegram will stop delivering immediately.`);
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  const drop = process.argv.includes("--drop");
  const dryRun = process.argv.includes("--dry-run");

  if (command === "secret") {
    console.log(mintSecret());
    return;
  }
  if (command === "info") return info(requireSurface(argument));
  if (command === "delete") return remove(requireSurface(argument));
  if (command && SURFACES[command]) return register(command, { drop, dryRun });

  console.log("Usage:");
  console.log("  node scripts/setup-telegram.mjs secret");
  console.log("  node scripts/setup-telegram.mjs bstocks|launchpad [--drop] [--dry-run]");
  console.log("  node scripts/setup-telegram.mjs info bstocks|launchpad");
  console.log("  node scripts/setup-telegram.mjs delete bstocks|launchpad");
  process.exitCode = 1;
}

function requireSurface(value) {
  if (!value || !SURFACES[value]) throw new Error(`Surface must be one of: ${Object.keys(SURFACES).join(", ")}`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
