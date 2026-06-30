import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { agentsChats } from "./agents_chats.js";
import { companies } from "./companies.js";

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  model?: string | null;
  finishReason?: string | null;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  toolCalls?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    agentChatId: uuid("agent_chat_id").references(() => agentsChats.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    title: text("title"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    suggestedQuestions: jsonb("suggested_questions").$type<string[]>().notNull().default([]),
    messages: jsonb("messages").$type<ChatMessage[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    tokenUsage: jsonb("token_usage").$type<ChatTokenUsage>().notNull().default({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }),
    costCents: integer("cost_cents").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentLastMsgIdx: index("chats_company_agent_last_message_idx").on(
      table.companyId,
      table.agentId,
      table.lastMessageAt,
    ),
    companyUserLastMsgIdx: index("chats_company_user_last_message_idx").on(
      table.companyId,
      table.createdByUserId,
      table.lastMessageAt,
    ),
    companyCreatedAtIdx: index("chats_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
  }),
);
