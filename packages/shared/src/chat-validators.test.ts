import { describe, expect, it } from "vitest";
import {
  chatCompletionRequestSchema,
  createChatSchema,
  DEFAULT_GEMINI_MODEL,
  listChatsQuerySchema,
  updateChatSchema,
  upsertAgentChatConfigSchema,
} from "./validators/chat.js";

describe("chat validators", () => {
  describe("upsertAgentChatConfigSchema", () => {
    it("applies sensible defaults when fields are omitted", () => {
      const parsed = upsertAgentChatConfigSchema.parse({});
      expect(parsed.systemPrompt).toBe("");
      expect(parsed.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(parsed.enabled).toBe(true);
      expect(parsed.skillBindings).toEqual([]);
      expect(parsed.extraParams).toEqual({});
    });

    it("rejects out-of-range temperature/topP", () => {
      expect(() => upsertAgentChatConfigSchema.parse({ temperature: 5 })).toThrow();
      expect(() => upsertAgentChatConfigSchema.parse({ topP: 1.5 })).toThrow();
    });

    it("rejects skill bindings that are not UUIDs", () => {
      expect(() =>
        upsertAgentChatConfigSchema.parse({ skillBindings: ["not-a-uuid"] }),
      ).toThrow();
    });
  });

  describe("createChatSchema", () => {
    it("accepts an empty body", () => {
      expect(createChatSchema.parse({})).toEqual({});
    });
    it("accepts a title and metadata", () => {
      const parsed = createChatSchema.parse({
        title: "Hilo de prueba",
        metadata: { traceId: "abc" },
      });
      expect(parsed.title).toBe("Hilo de prueba");
      expect(parsed.metadata).toEqual({ traceId: "abc" });
    });
    it("rejects an empty title string", () => {
      expect(() => createChatSchema.parse({ title: "" })).toThrow();
    });
  });

  describe("updateChatSchema", () => {
    it("permite archivar el chat con un ISO timestamp", () => {
      const parsed = updateChatSchema.parse({
        archivedAt: "2026-04-28T12:00:00.000Z",
      });
      expect(parsed.archivedAt).toBe("2026-04-28T12:00:00.000Z");
    });
    it("permite desarchivar pasando null", () => {
      expect(updateChatSchema.parse({ archivedAt: null }).archivedAt).toBeNull();
    });
  });

  describe("listChatsQuerySchema", () => {
    it("coerce limit/offset y por defecto includeArchived es false", () => {
      const parsed = listChatsQuerySchema.parse({ limit: "10", offset: "5" });
      expect(parsed.limit).toBe(10);
      expect(parsed.offset).toBe(5);
      expect(parsed.includeArchived).toBe(false);
    });
    it("acepta includeArchived como string 'true'", () => {
      const parsed = listChatsQuerySchema.parse({ includeArchived: "true" });
      expect(parsed.includeArchived).toBe(true);
    });
  });

  describe("chatCompletionRequestSchema", () => {
    it("aplica confidential = false por defecto", () => {
      const parsed = chatCompletionRequestSchema.parse({ message: "Hola" });
      expect(parsed.confidential).toBe(false);
    });
    it("acepta history con roles válidos", () => {
      const parsed = chatCompletionRequestSchema.parse({
        message: "Sigue",
        history: [
          { role: "user", content: "hola" },
          { role: "assistant", content: "hola, en qué te ayudo?" },
        ],
      });
      expect(parsed.history).toHaveLength(2);
    });
    it("rechaza mensajes vacíos", () => {
      expect(() => chatCompletionRequestSchema.parse({ message: "" })).toThrow();
    });
  });
});
