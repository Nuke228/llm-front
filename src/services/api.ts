import type { Conversation } from '../types';

function resolveApiBaseUrl(): string {
  const env = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (env && env.length > 0) return env;
  // Use current hostname with fixed backend port 8000
  return `${window.location.protocol}//${window.location.hostname}:8000`;
}

const API_BASE_URL = resolveApiBaseUrl();

export async function createConversation(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/chat/conversations`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = (await res.json()) as { conversation_id: string };
  return data.conversation_id;
}

export async function listConversations(limit = 10): Promise<Conversation[]> {
  const url = new URL(`${API_BASE_URL}/chat/conversations`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to list conversations');
  return (await res.json()) as Conversation[];
}

export async function getConversation(conversationId: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}`);
  if (!res.ok) throw new Error('Failed to get conversation');
  return (await res.json()) as Conversation;
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

export async function clearConversation(conversationId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}/clear`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to clear conversation');
}


