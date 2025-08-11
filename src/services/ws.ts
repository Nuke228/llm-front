import type { ChatResponse } from '../types';

function resolveWsBaseUrl(): string {
  const env = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (env && env.length > 0) return env;
  const isHttps = window.location.protocol === 'https:';
  const wsProtocol = isHttps ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.hostname}:8000`;
}

const WS_BASE_URL = resolveWsBaseUrl();

export type MessageHandler = (data: ChatResponse) => void;
export type ErrorHandler = (err: Event | CloseEvent) => void;

export function createChatSocket(
  conversationId: string,
  onMessage: MessageHandler,
  onError?: ErrorHandler
) {
  const url = `${WS_BASE_URL}/chat/ws/${encodeURIComponent(conversationId)}`;
  const socket = new WebSocket(url);

  const ready = new Promise<void>((resolve) => {
    socket.onopen = () => resolve();
  });

  socket.onmessage = (event: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(event.data) as ChatResponse;
      onMessage(parsed);
    } catch (e) {
      // ignore malformed frames
    }
  };

  socket.onerror = (err) => {
    onError?.(err);
  };

  socket.onclose = (evt) => {
    onError?.(evt);
  };

  function sendMessage(message: string) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ message }));
    }
  }

  return {
    socket,
    sendMessage,
    ready,
  };
}


