import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  chats,
  companySkills,
  type ChatMessage as DbChatMessage,
} from "@paperclipai/db";
import type {
  AgentChatConfig,
  Chat,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatListResponse,
  ChatMessage,
  ChatSummary,
  ChatTokenUsage,
  CreateChat,
  ListChatsQuery,
  UpdateChat,
} from "@paperclipai/shared";
import { DEFAULT_GEMINI_MODEL, MAX_CHAT_HISTORY_MESSAGES } from "@paperclipai/shared";
import { badRequest, forbidden, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { agentChatsService } from "./agent-chats.js";
import { secretService } from "./secrets.js";
import {
  createAgentChatProvider,
  type AgentChatProvider,
} from "./agent-chat-provider.js";
import { AppendChatMessage } from "@paperclipai/shared/validators/chat";

type ChatRow = typeof chats.$inferSelect;

const CHAT_AGENT_SERVICE_URL_SECRET = "CHAT_AGENT_SERVICE_URL";
const CHAT_AGENT_SERVICE_TOKEN_SECRET = "CHAT_AGENT_SERVICE_TOKEN";

interface ChatAgentServiceCredentials {
  serviceUrl: string;
  authToken: string | null;
}

function defaultTokenUsage(): ChatTokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function rowToChat(row: ChatRow): Chat {
  const usage = (row.tokenUsage as Partial<ChatTokenUsage> | null) ?? null;
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    agentChatId: row.agentChatId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    title: row.title ?? null,
    tags: (row.tags as string[]) ?? [],
    suggestedQuestions: (row.suggestedQuestions as string[]) ?? [],
    messages: ((row.messages as DbChatMessage[]) ?? []) as ChatMessage[],
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    tokenUsage: {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    },
    costCents: row.costCents,
    lastMessageAt: row.lastMessageAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToSummary(row: ChatRow): ChatSummary {
  const messages = (row.messages as DbChatMessage[]) ?? [];
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    createdByUserId: row.createdByUserId ?? null,
    title: row.title ?? null,
    tags: (row.tags as string[]) ?? [],
    lastMessageAt: row.lastMessageAt,
    messageCount: messages.length,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ChatServiceOptions {
  agentChatProvider?: AgentChatProvider;
}

export interface ChatActor {
  actorType: "agent" | "user" | "system";
  actorId: string;
  userId: string | null;
  agentId: string | null;
}

export function chatService(db: Db, options: ChatServiceOptions = {}) {
  const agentChats = agentChatsService(db);
  const secrets = secretService(db);
  const provider = options.agentChatProvider ?? createAgentChatProvider();

  async function ensureAgentInCompany(companyId: string, agentId: string) {
    const agent = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!agent) {
      throw notFound("Agent not found in this company");
    }
    return agent;
  }

  async function getChatScoped(companyId: string, chatId: string): Promise<ChatRow> {
    const row = await db
      .select()
      .from(chats)
      .where(and(eq(chats.companyId, companyId), eq(chats.id, chatId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Chat not found");
    return row;
  }

  async function tryResolveCompanySecret(
    companyId: string,
    name: string,
  ): Promise<string | null> {
    try {
      const secret = await secrets.getByName(companyId, name);
      if (!secret) return null;
      return await secrets.resolveSecretValue(companyId, secret.id, "latest");
    } catch (err) {
      logger.warn({ err, companyId, name }, "Failed to resolve company secret, falling back");
      return null;
    }
  }

  async function resolveChatAgentService(
    companyId: string,
  ): Promise<ChatAgentServiceCredentials> {
    const urlFromSecret = await tryResolveCompanySecret(companyId, CHAT_AGENT_SERVICE_URL_SECRET);
    const tokenFromSecret = await tryResolveCompanySecret(
      companyId,
      CHAT_AGENT_SERVICE_TOKEN_SECRET,
    );

    const serviceUrl = urlFromSecret ?? process.env.CHAT_AGENT_SERVICE_URL ?? "";
    if (!serviceUrl) {
      throw badRequest(
        `Chat-agent service URL not configured. Create a company secret named "${CHAT_AGENT_SERVICE_URL_SECRET}" or set CHAT_AGENT_SERVICE_URL env var.`,
      );
    }
    const authToken = tokenFromSecret ?? process.env.CHAT_AGENT_SERVICE_TOKEN ?? null;
    return { serviceUrl, authToken };
  }

  async function resolveSystemPrompt(
    companyId: string,
    config: AgentChatConfig,
    override?: string | null,
  ): Promise<string> {
    if (override && override.trim().length > 0) {
      return override;
    }
    const base = config.systemPrompt ?? "";
    const skillIds = (config.skillBindings ?? []).filter(Boolean);
    if (skillIds.length === 0) {
      return base;
    }
    const skillRows = await db
      .select({
        id: companySkills.id,
        name: companySkills.name,
        description: companySkills.description,
        markdown: companySkills.markdown,
      })
      .from(companySkills)
      .where(eq(companySkills.companyId, companyId));
    const skillsById = new Map(skillRows.map((row) => [row.id, row]));
    const sections: string[] = [];
    for (const skillId of skillIds) {
      const skill = skillsById.get(skillId);
      if (!skill) continue;
      const description = skill.description ? `\n${skill.description}` : "";
      const body = skill.markdown ? `\n${skill.markdown}` : "";
      sections.push(`# Skill: ${skill.name}${description}${body}`);
    }
    if (sections.length === 0) return base;
    if (!base) return sections.join("\n\n");
    return `${base}\n\n${sections.join("\n\n")}`;
  }

  function appendMessageQuery(chatId: string, message: ChatMessage, extras: Record<string, unknown> = {}) {
    const setClause: Record<string, unknown> = {
      messages: sql`${chats.messages} || ${JSON.stringify([message])}::jsonb`,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
      ...extras,
    };
    return db.update(chats).set(setClause).where(eq(chats.id, chatId)).returning();
  }

  async function appendMessage(chatId: string, message: ChatMessage) {
    const updated = await appendMessageQuery(chatId, message);
    return updated[0] ? rowToChat(updated[0]) : null;
  }

  async function appendMessagesAndAccumulate(
    chatId: string,
    msgs: ChatMessage[],
    tokenDelta: ChatTokenUsage,
  ) {
    if (msgs.length === 0) return null;
    const totals = await db
      .select({
        currentUsage: chats.tokenUsage,
      })
      .from(chats)
      .where(eq(chats.id, chatId))
      .then((rows) => rows[0] ?? null);
    const current =
      (totals?.currentUsage as Partial<ChatTokenUsage> | null) ?? defaultTokenUsage();
    const newUsage: ChatTokenUsage = {
      inputTokens: (current.inputTokens ?? 0) + tokenDelta.inputTokens,
      outputTokens: (current.outputTokens ?? 0) + tokenDelta.outputTokens,
      totalTokens: (current.totalTokens ?? 0) + tokenDelta.totalTokens,
    };
    const updated = await db
      .update(chats)
      .set({
        messages: sql`${chats.messages} || ${JSON.stringify(msgs)}::jsonb`,
        tokenUsage: newUsage,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId))
      .returning();
    return updated[0] ? rowToChat(updated[0]) : null;
  }

  return {
    async create(
      companyId: string,
      agentId: string,
      input: CreateChat,
      actor: ChatActor,
    ): Promise<Chat> {
      await ensureAgentInCompany(companyId, agentId);
      const config = await agentChats.getOrInitDefault(companyId, agentId);
      const inserted = await db
        .insert(chats)
        .values({
          companyId,
          agentId,
          agentChatId: config.id,
          createdByUserId: actor.userId,
          title: input.title ?? null,
          metadata: input.metadata ?? null,
        })
        .returning();
      return rowToChat(inserted[0]);
    },

    async list(companyId: string, query: ListChatsQuery): Promise<ChatListResponse> {
      const filters = [eq(chats.companyId, companyId)];
      if (query.agentId) filters.push(eq(chats.agentId, query.agentId));
      if (query.userId) filters.push(eq(chats.createdByUserId, query.userId));

      const where = and(...filters);
      const rows = await db
        .select()
        .from(chats)
        .where(where)
        .orderBy(desc(chats.lastMessageAt), desc(chats.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      const totalRow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(chats)
        .where(where);

      let items = rows.map(rowToSummary);
      if (!query.includeArchived) {
        items = items.filter((item) => item.archivedAt == null);
      }
      return {
        items,
        total: Number(totalRow[0]?.count ?? items.length),
      };
    },

    async getById(companyId: string, chatId: string): Promise<Chat> {
      const row = await getChatScoped(companyId, chatId);
      return rowToChat(row);
    },

    async update(
      companyId: string,
      chatId: string,
      input: UpdateChat,
    ): Promise<Chat> {
      await getChatScoped(companyId, chatId);
      const setClause: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) setClause.title = input.title;
      if (input.tags !== undefined) setClause.tags = input.tags;
      if (input.metadata !== undefined) setClause.metadata = input.metadata;
      if (input.archivedAt !== undefined) {
        setClause.archivedAt = input.archivedAt ? new Date(input.archivedAt) : null;
      }
      const updated = await db
        .update(chats)
        .set(setClause)
        .where(and(eq(chats.companyId, companyId), eq(chats.id, chatId)))
        .returning();
      if (!updated[0]) throw notFound("Chat not found");
      return rowToChat(updated[0]);
    },

    async delete(companyId: string, chatId: string): Promise<boolean> {
      const removed = await db
        .delete(chats)
        .where(and(eq(chats.companyId, companyId), eq(chats.id, chatId)))
        .returning({ id: chats.id });
      return removed.length > 0;
    },

    async complete(
      companyId: string,
      chatId: string,
      input: ChatCompletionRequest,
      actor: ChatActor,
    ): Promise<ChatCompletionResponse> {
      const chatRow = await getChatScoped(companyId, chatId);
      if (chatRow.archivedAt) {
        throw forbidden("Cannot send messages to an archived chat");
      }
      if (actor.userId && chatRow.createdByUserId && chatRow.createdByUserId !== actor.userId) {
        // permitir a board admins / agentes — la verificación final ya vino de assertCompanyAccess
        logger.info(
          { chatId, actorUserId: actor.userId, ownerUserId: chatRow.createdByUserId },
          "chat accessed by non-owner",
        );
      }

      const config = await agentChats.getOrInitDefault(companyId, chatRow.agentId);
      console.log("[agents_chats] systemPrompt", config.systemPrompt);
      if (!config.enabled) {
        throw forbidden("Chat is disabled for this agent");
      }
      const { serviceUrl, authToken } = await resolveChatAgentService(companyId);
      console.log("serviceUrl", serviceUrl);
      console.log("authToken", authToken);
      const systemPrompt = await resolveSystemPrompt(companyId, config, input.systemPromptOverride);
      console.log("systemPrompt", systemPrompt);
      const history = ((chatRow.messages as DbChatMessage[]) ?? []) as ChatMessage[];
      const limitedHistory =
        history.length > MAX_CHAT_HISTORY_MESSAGES
          ? history.slice(history.length - MAX_CHAT_HISTORY_MESSAGES)
          : history;

      const model = input.model ?? config.model ?? DEFAULT_GEMINI_MODEL;
      const userMessage: ChatMessage = {
        id: randomUUID(),
        role: "user",
        content: input.message,
        timestamp: new Date().toISOString(),
        metadata: input.metadata ?? null,
      };

      const result = await provider.generate({
        serviceUrl,
        authToken,
        model,
        systemInstruction: systemPrompt,
        history: limitedHistory,
        userMessage: input.message,
        temperature: config.temperature ?? null,
        topP: config.topP ?? null,
        maxOutputTokens: config.maxOutputTokens ?? null,
        safetySettings: config.safetySettings ?? null,
        extraParams: config.extraParams ?? null,
        metadata: { chatId, companyId, agentId: chatRow.agentId },
      });
      console.log("result", result);
      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: result.content,
        model: result.model ?? model,
        finishReason: result.finishReason,
        tokenUsage: result.tokenUsage,
        timestamp: new Date().toISOString(),
      };

      await appendMessagesAndAccumulate(chatId, [userMessage, assistantMessage], result.tokenUsage);

      return {
        chatId,
        message: assistantMessage,
        tokenUsage: result.tokenUsage,
        confidential: false,
      };
    },

    async completeEphemeral(
      companyId: string,
      agentId: string,
      input: ChatCompletionRequest,
    ): Promise<ChatCompletionResponse> {
      await ensureAgentInCompany(companyId, agentId);
      const config = await agentChats.getOrInitDefault(companyId, agentId);
      console.log("[agents_chats] systemPrompt", config.systemPrompt);
      if (!config.enabled) {
        throw forbidden("Chat is disabled for this agent");
      }
      const { serviceUrl, authToken } = await resolveChatAgentService(companyId);
      const systemPrompt = await resolveSystemPrompt(companyId, config, input.systemPromptOverride);
      const history = (input.history ?? []).slice(-MAX_CHAT_HISTORY_MESSAGES) as ChatMessage[];
      const model = input.model ?? config.model ?? DEFAULT_GEMINI_MODEL;

      const result = await provider.generate({
        serviceUrl,
        authToken,
        model,
        systemInstruction: systemPrompt,
        history,
        userMessage: input.message,
        temperature: config.temperature ?? null,
        topP: config.topP ?? null,
        maxOutputTokens: config.maxOutputTokens ?? null,
        safetySettings: config.safetySettings ?? null,
        extraParams: config.extraParams ?? null,
        metadata: { companyId, agentId, ephemeral: true },
      });

      return {
        chatId: null,
        message: {
          id: randomUUID(),
          role: "assistant",
          content: result.content,
          model: result.model ?? model,
          finishReason: result.finishReason,
          tokenUsage: result.tokenUsage,
          timestamp: new Date().toISOString(),
        },
        tokenUsage: result.tokenUsage,
        confidential: true,
      };
    },

    async appendMessage(
      companyId: string,
      chatId: string,
      input: AppendChatMessage,
    ): Promise<ChatMessage> {
      const chatRow = await getChatScoped(companyId, chatId);
      if (chatRow.archivedAt) {
        throw forbidden("Cannot add messages to an archived chat");
      }
      const message: ChatMessage = {
        id: randomUUID(),
        role: input.role,
        content: input.content,
        timestamp: new Date().toISOString(),
        metadata: null,
      };
      await appendMessagesAndAccumulate(chatId, [message], {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
      return message;
    },
  };
}
