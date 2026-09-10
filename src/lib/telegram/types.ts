import { z } from "zod";

/**
 * The slice of Telegram's Update object this bot actually reads, validated rather than trusted.
 *
 * Everything here is written by strangers. Parsing it into a known shape is the first half of
 * treating it as data; the second half is that no field below is ever interpolated into a URL, a
 * shell, or a model instruction without escaping.
 */
export const userSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

export const chatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
  title: z.string().optional(),
  username: z.string().optional(),
});

export const messageSchema = z.object({
  message_id: z.number().int(),
  from: userSchema.optional(),
  chat: chatSchema,
  date: z.number().int(),
  /** Forum topic. Absent in an ordinary group; a reply must carry it back or it lands in General. */
  message_thread_id: z.number().int().optional(),
  is_topic_message: z.boolean().optional(),
  text: z.string().optional(),
  entities: z
    .array(z.object({ type: z.string(), offset: z.number().int(), length: z.number().int() }))
    .optional(),
});

export const inlineQuerySchema = z.object({
  id: z.string(),
  from: userSchema,
  query: z.string(),
  offset: z.string(),
  chat_type: z.string().optional(),
});

export const myChatMemberSchema = z.object({
  chat: chatSchema,
  from: userSchema,
  new_chat_member: z.object({ status: z.string() }),
});

export const updateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  channel_post: messageSchema.optional(),
  inline_query: inlineQuerySchema.optional(),
  my_chat_member: myChatMemberSchema.optional(),
});

export type TgUser = z.infer<typeof userSchema>;
export type TgChat = z.infer<typeof chatSchema>;
export type TgMessage = z.infer<typeof messageSchema>;
export type TgInlineQuery = z.infer<typeof inlineQuerySchema>;
export type TgUpdate = z.infer<typeof updateSchema>;

/**
 * What `setWebhook` must be told to deliver.
 *
 * Telegram's default list silently omits `chat_member`, `message_reaction` and
 * `message_reaction_count`; anything that depends on them has to name them here. `my_chat_member`
 * is in the default set and is what tells the bot it was added to or removed from a group.
 */
export const ALLOWED_UPDATES = ["message", "edited_message", "inline_query", "my_chat_member"] as const;
