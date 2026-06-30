import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const agentsChats = pgTable(
  "agents_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    systemPrompt: text("system_prompt").notNull().default(""),
    model: text("model").notNull().default("gemini-1.5-pro"),
    temperature: numeric("temperature", { precision: 3, scale: 2 }),
    topP: numeric("top_p", { precision: 3, scale: 2 }),
    maxOutputTokens: integer("max_output_tokens"),
    safetySettings: jsonb("safety_settings").$type<Record<string, unknown> | null>(),
    extraParams: jsonb("extra_params").$type<Record<string, unknown>>().notNull().default({}),
    skillBindings: jsonb("skill_bindings").$type<string[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentUniqueIdx: uniqueIndex("agents_chats_company_agent_uniq").on(
      table.companyId,
      table.agentId,
    ),
    companyEnabledIdx: index("agents_chats_company_enabled_idx").on(table.companyId, table.enabled),
  }),
);
