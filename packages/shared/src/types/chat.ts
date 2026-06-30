export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessageTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  model?: string | null;
  finishReason?: string | null;
  tokenUsage?: ChatMessageTokenUsage | null;
  toolCalls?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentChatConfig {
  id: string;
  companyId: string;
  agentId: string;
  systemPrompt: string;
  model: string;
  temperature: number | null;
  topP: number | null;
  maxOutputTokens: number | null;
  safetySettings: Record<string, unknown> | null;
  extraParams: Record<string, unknown>;
  skillBindings: string[];
  enabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chat {
  id: string;
  companyId: string;
  agentId: string;
  agentChatId: string | null;
  createdByUserId: string | null;
  title: string | null;
  tags: string[];
  suggestedQuestions: string[];
  messages: ChatMessage[];
  metadata: Record<string, unknown> | null;
  tokenUsage: ChatTokenUsage;
  costCents: number;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSummary {
  id: string;
  companyId: string;
  agentId: string;
  createdByUserId: string | null;
  title: string | null;
  tags: string[];
  lastMessageAt: Date | null;
  messageCount: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatListResponse {
  items: ChatSummary[];
  total: number;
}

export interface ChatCompletionResponse {
  chatId: string | null;
  message: ChatMessage;
  tokenUsage: ChatTokenUsage;
  confidential: boolean;
}
