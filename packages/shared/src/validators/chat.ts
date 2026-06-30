import { z } from "zod";

export const GEMINI_MODELS = [
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
] as const;

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const MAX_CHAT_HISTORY_MESSAGES = 200;

export const chatMessageRoleSchema = z.enum(["system", "user", "assistant"]);

export const chatMessageSchema = z.object({
  id: z.string().optional(),
  role: chatMessageRoleSchema,
  content: z.string().min(1),
  model: z.string().optional().nullable(),
  finishReason: z.string().optional().nullable(),
  tokenUsage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
    })
    .optional()
    .nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  timestamp: z.string().datetime().optional(),
});

export const upsertAgentChatConfigSchema = z.object({
  systemPrompt: z.string().max(20_000).default(""),
  model: z.string().min(1).default(DEFAULT_GEMINI_MODEL),
  temperature: z.number().min(0).max(2).optional().nullable(),
  topP: z.number().min(0).max(1).optional().nullable(),
  maxOutputTokens: z.number().int().positive().max(32_000).optional().nullable(),
  safetySettings: z.record(z.unknown()).optional().nullable(),
  extraParams: z.record(z.unknown()).optional().default({}),
  skillBindings: z.array(z.string().uuid()).optional().default([]),
  enabled: z.boolean().optional().default(true),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type UpsertAgentChatConfig = z.infer<typeof upsertAgentChatConfigSchema>;

export const createChatSchema = z.object({
  title: z.string().min(1).max(200).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CreateChat = z.infer<typeof createChatSchema>;

export const updateChatSchema = z.object({
  title: z.string().min(1).max(200).optional().nullable(),
  tags: z.array(z.string().min(1).max(64)).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
  archivedAt: z
    .union([z.string().datetime(), z.null()])
    .optional(),
});

export type UpdateChat = z.infer<typeof updateChatSchema>;

export const listChatsQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  userId: z.string().optional(),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListChatsQuery = z.infer<typeof listChatsQuerySchema>;

export const chatCompletionRequestSchema = z.object({
  message: z.string().min(1).max(20_000),
  model: z.string().optional(),
  systemPromptOverride: z.string().max(20_000).optional(),
  confidential: z.boolean().optional().default(false),
  history: z.array(chatMessageSchema).max(MAX_CHAT_HISTORY_MESSAGES).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export const appendChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(20_000),
});

export type AppendChatMessage = z.infer<typeof appendChatMessageSchema>;
