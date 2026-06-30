import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  chatCompletionRequestSchema,
  createChatSchema,
  listChatsQuerySchema,
  updateChatSchema,
  upsertAgentChatConfigSchema,
  appendChatMessageSchema
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  agentChatsService,
  chatService,
  logActivity,
  type ChatActor,
} from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { notFound } from "../errors.js";

function toChatActor(actor: ReturnType<typeof getActorInfo>): ChatActor {
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    userId: actor.actorType === "user" ? actor.actorId : null,
    agentId: actor.agentId ?? null,
  };
}

export function chatRoutes(db: Db) {
  const router = Router();
  const chats = chatService(db);
  const agentChats = agentChatsService(db);

  // ========== AGENT CHAT CONFIG (agents_chats) ==========

  router.get(
    "/companies/:companyId/agents/:agentId/chat-config",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);
      const config = await agentChats.getOrInitDefault(companyId, agentId);
      res.json(config);
    },
  );

  router.put(
    "/companies/:companyId/agents/:agentId/chat-config",
    validate(upsertAgentChatConfigSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);
      const config = await agentChats.upsert(companyId, agentId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "agent_chat_config.updated",
        entityType: "agent_chat_config",
        entityId: config.id,
        details: { agentId, model: config.model, enabled: config.enabled },
      });
      res.json(config);
    },
  );

  router.delete(
    "/companies/:companyId/agents/:agentId/chat-config",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);
      const removed = await agentChats.delete(companyId, agentId);
      if (!removed) {
        throw notFound("Agent chat config not found");
      }
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "agent_chat_config.deleted",
        entityType: "agent_chat_config",
        entityId: agentId,
      });
      res.status(204).end();
    },
  );

  // ========== CHATS CRUD ==========

  router.post(
    "/companies/:companyId/agents/:agentId/chats",
    validate(createChatSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const chat = await chats.create(companyId, agentId, req.body, toChatActor(actor));
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "chat.created",
        entityType: "chat",
        entityId: chat.id,
        details: { agentId, title: chat.title },
      });
      res.status(201).json(chat);
    },
  );

  router.get(
    "/companies/:companyId/agents/:agentId/chats",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);
      const query = listChatsQuerySchema.parse(req.query);
      const result = await chats.list(companyId, { ...query, agentId });
      res.json(result);
    },
  );

  router.get("/companies/:companyId/chats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = listChatsQuerySchema.parse(req.query);
    const result = await chats.list(companyId, query);
    res.json(result);
  });

  router.get("/companies/:companyId/chats/:chatId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const chatId = req.params.chatId as string;
    assertCompanyAccess(req, companyId);
    const chat = await chats.getById(companyId, chatId);
    res.json(chat);
  });

  router.patch(
    "/companies/:companyId/chats/:chatId",
    validate(updateChatSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const chatId = req.params.chatId as string;
      assertCompanyAccess(req, companyId);
      const chat = await chats.update(companyId, chatId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "chat.updated",
        entityType: "chat",
        entityId: chat.id,
        details: req.body,
      });
      res.json(chat);
    },
  );

  router.delete("/companies/:companyId/chats/:chatId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const chatId = req.params.chatId as string;
    assertCompanyAccess(req, companyId);
    const removed = await chats.delete(companyId, chatId);
    if (!removed) {
      throw notFound("Chat not found");
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "chat.deleted",
      entityType: "chat",
      entityId: chatId,
    });
    res.status(204).end();
  });

  // ========== INFERENCIA (Gemini) ==========

  router.post(
    "/companies/:companyId/chats/:chatId/completions",
    validate(chatCompletionRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      console.log("companyId", companyId);
      const chatId = req.params.chatId as string;
      console.log("chatId", chatId);
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      console.log("actor", actor);

      if (req.body.confidential) {
        const chat = await chats.getById(companyId, chatId);
        const result = await chats.completeEphemeral(companyId, chat.agentId, req.body);
        res.json(result);
        return;
      }

      const result = await chats.complete(companyId, chatId, req.body, toChatActor(actor));
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "chat.message_completed",
        entityType: "chat",
        entityId: chatId,
        details: {
          model: result.message.model,
          tokenUsage: result.tokenUsage,
        },
      });
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/agents/:agentId/chat-completions/ephemeral",
    validate(chatCompletionRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);
      const result = await chats.completeEphemeral(companyId, agentId, req.body);
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/chats/:chatId/messages",
    validate(appendChatMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const chatId = req.params.chatId as string;
      assertCompanyAccess(req, companyId);
      const message = await chats.appendMessage(companyId, chatId, req.body);
      res.status(201).json({ message });
    },
  );

  return router;
}
