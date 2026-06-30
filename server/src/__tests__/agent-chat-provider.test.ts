import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentChatProvider } from "../services/agent-chat-provider.js";
import { HttpError } from "../errors.js";

const SAMPLE_RESPONSE = {
  content: "Hola, soy un agente.",
  model: "gemini-1.5-pro",
  finishReason: "STOP",
  tokenUsage: {
    inputTokens: 12,
    outputTokens: 5,
    totalTokens: 17,
  },
};

const CLOUD_RUN_URL = "https://chat-agent-xyz-uc.a.run.app/chat";

describe("createAgentChatProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("envía POST al Cloud Run con body normalizado y mapea la respuesta", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const provider = createAgentChatProvider();
    const result = await provider.generate({
      serviceUrl: CLOUD_RUN_URL,
      authToken: "secret-token",
      model: "gemini-1.5-pro",
      systemInstruction: "Eres un asistente.",
      history: [
        { id: "1", role: "user", content: "hola", timestamp: "2026-01-01T00:00:00Z" },
        { id: "2", role: "assistant", content: "qué tal", timestamp: "2026-01-01T00:00:01Z" },
      ],
      userMessage: "¿quién eres?",
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 256,
      metadata: { traceId: "abc" },
    });

    expect(result.content).toBe("Hola, soy un agente.");
    expect(result.finishReason).toBe("STOP");
    expect(result.model).toBe("gemini-1.5-pro");
    expect(result.tokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(CLOUD_RUN_URL);

    const reqInit = init as RequestInit;
    expect((reqInit.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((reqInit.headers as Record<string, string>).authorization).toBe("Bearer secret-token");

    const body = JSON.parse(reqInit.body as string);
    expect(body).toMatchObject({
      message: "¿quién eres?",
      model: "gemini-1.5-pro",
      systemPrompt: "Eres un asistente.",
      params: {
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 256,
      },
      metadata: { traceId: "abc" },
    });
    expect(body.history).toEqual([
      { role: "user", content: "hola", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant", content: "qué tal", timestamp: "2026-01-01T00:00:01Z" },
    ]);
  });

  it("omite el header Authorization cuando no se provee authToken", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
    const provider = createAgentChatProvider();
    await provider.generate({
      serviceUrl: CLOUD_RUN_URL,
      history: [],
      userMessage: "hola",
    });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("acepta respuestas con campo 'text' y 'usage' (snake_case-friendly)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "respuesta alterna",
          finish_reason: "MAX_TOKENS",
          usage: { promptTokens: 10, completionTokens: 7 },
        }),
        { status: 200 },
      ),
    );
    const provider = createAgentChatProvider();
    const result = await provider.generate({
      serviceUrl: CLOUD_RUN_URL,
      history: [],
      userMessage: "hola",
    });
    expect(result.content).toBe("respuesta alterna");
    expect(result.finishReason).toBe("MAX_TOKENS");
    expect(result.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 7,
      totalTokens: 17,
    });
  });

  it("propaga errores HTTP del upstream como HttpError preservando el status", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "quota exceeded" }), { status: 429 }),
    );
    const provider = createAgentChatProvider();
    await expect(
      provider.generate({
        serviceUrl: CLOUD_RUN_URL,
        history: [],
        userMessage: "hola",
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("rechaza si falta serviceUrl", async () => {
    const provider = createAgentChatProvider();
    await expect(
      provider.generate({
        serviceUrl: "",
        history: [],
        userMessage: "hola",
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("convierte errores de red en HttpError 502", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = createAgentChatProvider();
    await expect(
      provider.generate({
        serviceUrl: CLOUD_RUN_URL,
        history: [],
        userMessage: "hola",
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
