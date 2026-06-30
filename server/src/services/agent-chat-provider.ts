import type { ChatMessage } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { badRequest, HttpError } from "../errors.js";

/**
 * HTTP client that talks to an external chat-agent service (e.g. a Cloud Run
 * deployment) which internally proxies requests to Gemini (or any other LLM).
 *
 * The contract is intentionally opinionated and stable so that the Cloud Run
 * service is the only place that needs to know how to talk to Gemini.
 *
 * Request body (POST <serviceUrl>):
 * {
 *   "model":        string | undefined,    // e.g. "gemini-1.5-pro"
 *   "systemPrompt": string | undefined,
 *   "history":      Array<{ role, content, timestamp? }>,
 *   "message":      string,
 *   "params":       { temperature?, topP?, maxOutputTokens?, safetySettings? },
 *   "metadata":     Record<string, unknown> | undefined,
 *   "extra":        Record<string, unknown> | undefined,
 * }
 *
 * Expected response body:
 * {
 *   "content":       string,
 *   "model":         string | undefined,
 *   "finishReason":  string | undefined,
 *   "tokenUsage":    { inputTokens?, outputTokens?, totalTokens? } | undefined
 * }
 */

export interface AgentChatGenerateOptions {
  serviceUrl: string;
  authToken?: string | null;
  model?: string | null;
  systemInstruction?: string | null;
  history: ChatMessage[];
  userMessage: string;
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  safetySettings?: Record<string, unknown> | null;
  extraParams?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  signal?: AbortSignal;
}

export interface AgentChatGenerateResult {
  content: string;
  finishReason: string | null;
  model: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  raw: unknown;
}

interface CloudRunUsageBlock {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokenCount?: number;
}

interface CloudRunResponseBody {
  content?: string;
  text?: string;
  model?: string;
  finishReason?: string;
  finish_reason?: string;
  tokenUsage?: CloudRunUsageBlock;
  usage?: CloudRunUsageBlock;
}

function buildBody(opts: AgentChatGenerateOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (opts.temperature != null) params.temperature = opts.temperature;
  if (opts.topP != null) params.topP = opts.topP;
  if (opts.maxOutputTokens != null) params.maxOutputTokens = opts.maxOutputTokens;
  if (opts.safetySettings) params.safetySettings = opts.safetySettings;

  const body: Record<string, unknown> = {
    message: opts.userMessage,
    history: opts.history.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
  };
  if (opts.model) body.model = opts.model;
  if (opts.systemInstruction && opts.systemInstruction.trim().length > 0) {
    body.systemPrompt = opts.systemInstruction;
  }
  if (Object.keys(params).length > 0) body.params = params;
  if (opts.metadata) body.metadata = opts.metadata;
  if (opts.extraParams && typeof opts.extraParams === "object") {
    body.extra = opts.extraParams;
  }
  return body;
}

function normalizeUsage(json: CloudRunResponseBody) {
  const usage = json.tokenUsage ?? json.usage ?? {};
  const input = usage.inputTokens ?? usage.promptTokens ?? 0;
  const output = usage.outputTokens ?? usage.completionTokens ?? 0;
  const total = usage.totalTokens ?? usage.totalTokenCount ?? input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export interface AgentChatProvider {
  generate(opts: AgentChatGenerateOptions): Promise<AgentChatGenerateResult>;
}

export function createAgentChatProvider(): AgentChatProvider {
  return {
    async generate(opts: AgentChatGenerateOptions): Promise<AgentChatGenerateResult> {
      console.log("opts", opts);
      if (!opts.serviceUrl) {
        throw badRequest("Missing chat-agent service URL");
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (opts.authToken) headers.authorization = `Bearer ${opts.authToken}`;

      let response: Response;
      try {
        response = await fetch(opts.serviceUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(buildBody(opts)),
          signal: opts.signal,
        });
      } catch (err) {
        console.log("err", err);
        logger.error(
          { err, serviceUrl: opts.serviceUrl, model: opts.model ?? null },
          "Agent chat provider network error",
        );
        throw new HttpError(502, "Chat agent service network error");
      }

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        logger.warn(
          {
            status: response.status,
            serviceUrl: opts.serviceUrl,
            model: opts.model ?? null,
            body: errorBody.slice(0, 500),
          },
          "Agent chat provider error response",
        );
        const status = response.status >= 400 && response.status < 600 ? response.status : 502;
        throw new HttpError(status, `Chat agent service request failed (${response.status})`, {
          upstreamStatus: response.status,
          upstreamBody: errorBody.slice(0, 2_000),
        });
      }

      let json: CloudRunResponseBody;
      try {
        json = (await response.json()) as CloudRunResponseBody;
      } catch (err) {
        logger.error({ err, serviceUrl: opts.serviceUrl }, "Agent chat provider invalid JSON");
        throw new HttpError(502, "Chat agent service returned invalid JSON");
      }

      const content = (json.content ?? json.text ?? "").trim();
      const finishReason = json.finishReason ?? json.finish_reason ?? null;

      return {
        content,
        finishReason,
        model: json.model ?? opts.model ?? null,
        tokenUsage: normalizeUsage(json),
        raw: json,
      };
    },
  };
}
