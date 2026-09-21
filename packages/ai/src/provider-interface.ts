export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIProvider {
  id: string;
  name: string;
  sendMessage(messages: AIMessage[]): Promise<AIResponse>;
  streamResponse(messages: AIMessage[]): AsyncIterable<{ content: string }>;
  listModels(): Promise<{ id: string; name: string }[]>;
  getModel(): Promise<{ id: string; name: string } | null>;
  healthCheck(): Promise<boolean>;
}
