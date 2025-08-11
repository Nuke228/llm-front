export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp?: string;
}

export interface ChatResponse {
  message: string;
  conversation_id: string;
  is_final: boolean;
  timestamp: string;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}


