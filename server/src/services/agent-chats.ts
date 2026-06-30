import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, agentsChats } from "@paperclipai/db";
import type { AgentChatConfig, UpsertAgentChatConfig } from "@paperclipai/shared";
import { DEFAULT_GEMINI_MODEL } from "@paperclipai/shared";
import { notFound } from "../errors.js";

type AgentsChatsRow = typeof agentsChats.$inferSelect;

function toDomain(row: AgentsChatsRow): AgentChatConfig {
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    systemPrompt: row.systemPrompt,
    model: row.model,
    temperature: row.temperature == null ? null : Number(row.temperature),
    topP: row.topP == null ? null : Number(row.topP),
    maxOutputTokens: row.maxOutputTokens ?? null,
    safetySettings: (row.safetySettings as Record<string, unknown> | null) ?? null,
    extraParams: (row.extraParams as Record<string, unknown>) ?? {},
    skillBindings: (row.skillBindings as string[]) ?? [],
    enabled: row.enabled,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function agentChatsService(db: Db) {
  async function ensureAgentBelongsToCompany(companyId: string, agentId: string) {
    const agent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!agent) {
      throw notFound("Agent not found in this company");
    }
  }

  return {
    async getByAgent(companyId: string, agentId: string): Promise<AgentChatConfig | null> {
      const row = await db
        .select()
        .from(agentsChats)
        .where(and(eq(agentsChats.companyId, companyId), eq(agentsChats.agentId, agentId)))
        .then((rows) => rows[0] ?? null);
      return row ? toDomain(row) : null;
    },

    async getOrInitDefault(companyId: string, agentId: string): Promise<AgentChatConfig> {
      const existing = await this.getByAgent(companyId, agentId);
      if (existing) return existing;
      await ensureAgentBelongsToCompany(companyId, agentId);
      const inserted = await db
        .insert(agentsChats)
        .values({
          companyId,
          agentId,
          systemPrompt: "",
          model: DEFAULT_GEMINI_MODEL,
          enabled: true,
        })
        .returning();
      return toDomain(inserted[0]);
    },

    async upsert(
      companyId: string,
      agentId: string,
      input: UpsertAgentChatConfig,
    ): Promise<AgentChatConfig> {
      await ensureAgentBelongsToCompany(companyId, agentId);
      const existing = await this.getByAgent(companyId, agentId);
      const payload = {
        systemPrompt: input.systemPrompt,
        model: input.model,
        temperature: input.temperature == null ? null : input.temperature.toString(),
        topP: input.topP == null ? null : input.topP.toString(),
        maxOutputTokens: input.maxOutputTokens ?? null,
        safetySettings: input.safetySettings ?? null,
        extraParams: input.extraParams ?? {},
        skillBindings: input.skillBindings ?? [],
        enabled: input.enabled ?? true,
        metadata: input.metadata ?? null,
        updatedAt: new Date(),
      };
      if (existing) {
        const updated = await db
          .update(agentsChats)
          .set(payload)
          .where(and(eq(agentsChats.companyId, companyId), eq(agentsChats.agentId, agentId)))
          .returning();
        return toDomain(updated[0]);
      }
      const inserted = await db
        .insert(agentsChats)
        .values({
          companyId,
          agentId,
          ...payload,
        })
        .returning();
      return toDomain(inserted[0]);
    },

    async delete(companyId: string, agentId: string): Promise<boolean> {
      const removed = await db
        .delete(agentsChats)
        .where(and(eq(agentsChats.companyId, companyId), eq(agentsChats.agentId, agentId)))
        .returning({ id: agentsChats.id });
      return removed.length > 0;
    },
  };
}
