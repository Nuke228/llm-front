import { useEffect, useMemo, useRef, useState } from 'react';
import { createConversation, getConversation, listConversations, deleteConversation } from '../services/api';
import { createChatSocket } from '../services/ws';
import type { ChatMessage, Conversation } from '../types';

function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const scrollToBottom = () => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  };
  return { ref, scrollToBottom } as const;
}

export default function Chat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isSidebarClosing, setIsSidebarClosing] = useState<boolean>(false);

  const { ref: listRef, scrollToBottom } = useAutoScroll<HTMLDivElement>();
  const streamingStartedRef = useRef(false);
  const currentConvRef = useRef<string | null>(null);
  const initialLoadRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<null | { socket: WebSocket; sendMessage: (m: string) => void; ready: Promise<void> }>(null);

  useEffect(() => {
    listConversations(10).then(setConversations).catch(() => {});
    // Focus input on first mount
    setTimeout(() => inputRef.current?.focus(), 0);
    // Setup responsive detection
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    currentConvRef.current = conversationId;
    // Reset view when switching conversations
    setMessages([]);
    initialLoadRef.current = true;
    getConversation(conversationId)
      .then((conv) => {
        if (currentConvRef.current === conversationId && initialLoadRef.current) {
          setMessages(conv.messages ?? []);
          initialLoadRef.current = false;
        }
      })
      .catch(() => {
        if (currentConvRef.current === conversationId && initialLoadRef.current) {
          setMessages([]);
          initialLoadRef.current = false;
        }
      });
  }, [conversationId]);

  const ws = useMemo(() => {
    if (!conversationId) return null;
    const { socket, sendMessage, ready } = createChatSocket(
      conversationId,
      (data) => {
        // Ignore messages belonging to a stale conversation after switching
        if (currentConvRef.current !== conversationId) return;
        setIsConnected(true);
        setIsStreaming(!data.is_final);
        // Skip initial connection confirmation message from server
        if (data.is_final && data.message === 'Connected to chat!') {
          streamingStartedRef.current = false;
          return;
        }
        if (data.message) {
          setMessages((prev) => {
            const hasAssistantLast = prev.length > 0 && prev[prev.length - 1].role === 'assistant';
            // If final frame equals the existing last assistant content, skip to avoid duplicates
            if (data.is_final && hasAssistantLast && prev[prev.length - 1].content === data.message) {
              streamingStartedRef.current = false;
              return prev;
            }
            const updated = [...prev];
            if (!data.is_final) {
              streamingStartedRef.current = true;
              if (hasAssistantLast) {
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: (updated[updated.length - 1].content ?? '') + data.message,
                };
                return updated;
              }
              // start streaming frame
              return [...updated, { role: 'assistant', content: data.message }];
            }
            // final frame: replace only if streaming actually started; otherwise append
            if (streamingStartedRef.current && hasAssistantLast) {
              streamingStartedRef.current = false;
              updated[updated.length - 1] = { role: 'assistant', content: data.message };
              return updated;
            }
            // Avoid appending a duplicate assistant message equal to the last one
            if (hasAssistantLast && updated[updated.length - 1].content === data.message) {
              streamingStartedRef.current = false;
              return updated;
            }
            streamingStartedRef.current = false;
            return [...updated, { role: 'assistant', content: data.message }];
          });
        }
        setTimeout(scrollToBottom, 0);
      },
      () => setIsConnected(false)
    );
    // store immediately to avoid race with first send
    wsRef.current = { socket, sendMessage, ready };
    return { socket, sendMessage, ready };
  }, [conversationId]);

  useEffect(() => {
    return () => {
      ws?.socket.close();
    };
  }, [ws]);

  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  async function handleStartConversation() {
    const id = await createConversation();
    setConversationId(id);
    setMessages([]);
    if (isMobile) setIsSidebarOpen(false);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput('');

    // If no conversation yet, create it first, wait for WS, then show and send
    if (!conversationId) {
      try {
        setIsBusy(true);
        const id = await createConversation();
        setConversationId(id);
        const list = await listConversations(10).catch(() => []);
        if (Array.isArray(list)) setConversations(list);

        // Wait until this conversation is active and WS is ready
        let attempts = 0;
        while ((currentConvRef.current !== id || !wsRef.current) && attempts < 200) {
          // 2 seconds max
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 10));
          attempts += 1;
        }
        try {
          await wsRef.current?.ready;
        } catch {}

        // Now render optimistic user message and send
        initialLoadRef.current = false; // prevent fetch overwriting optimistic message
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setTimeout(scrollToBottom, 0);
        try {
          wsRef.current?.sendMessage(text);
        } catch {}
      } finally {
        setIsBusy(false);
      }
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    // Existing conversation: render optimistically then send
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setTimeout(scrollToBottom, 0);
    try {
      await wsRef.current?.ready;
    } catch {}
    try {
      wsRef.current?.sendMessage(text);
    } catch {}
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div
      className="chat-container"
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '280px 1fr',
        gridTemplateRows: '100vh',
        width: '100vw',
        height: '100vh',
        gap: 0,
        background: '#f5f7fb',
        color: '#111',
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          display: isMobile ? 'none' : 'grid',
          gridTemplateRows: 'auto 1fr',
          borderRight: '1px solid #e5e7eb',
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, gap: 8 }}>
          <strong>Conversations</strong>
          <button
            onClick={async () => {
              await handleStartConversation();
              const list = await listConversations(10);
              setConversations(list);
            }}
            disabled={isStreaming || isBusy}
            style={{
              background: isStreaming || isBusy ? '#e7f7ef' : '#ecfdf5',
              color: '#065f46',
              border: `1px solid ${isStreaming || isBusy ? '#e7f7ef' : '#d1fae5'}`,
              padding: '8px 12px',
              borderRadius: 8,
              cursor: isStreaming || isBusy ? 'not-allowed' : 'pointer',
            }}
          >
            New
          </button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {conversations.length === 0 && (
            <div style={{ color: '#888', padding: 12 }}>No conversations yet.</div>
          )}
          {conversations.map((c) => {
            const active = c.id === conversationId;
            return (
              <div
                key={c.id}
                onClick={() => {
                  setConversationId(c.id);
                  if (isMobile) setIsSidebarOpen(false);
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderBottom: '1px solid #f1f5f9',
                  background: active ? '#eaf2ff' : 'transparent',
                  cursor: 'pointer',
                }}
                role="button"
              >
                <div style={{ display: 'grid' }}>
                  <div style={{ fontSize: 13, color: '#334155' }}>{c.id.slice(0, 8)}…</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{new Date(c.updated_at).toLocaleString()}</div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm('Delete this conversation?')) return;
                    try {
                      setIsBusy(true);
                      if (c.id === conversationId) {
                        wsRef.current?.socket.close();
                      }
                      await deleteConversation(c.id);
                      if (c.id === conversationId) {
                        setConversationId(null);
                        setMessages([]);
                      }
                      const list = await listConversations(10).catch(() => []);
                      setConversations(Array.isArray(list) ? list : []);
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                  disabled={isStreaming || isBusy}
                  title="Delete"
                  aria-label={`Delete conversation ${c.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    border: 'none',
                    background: 'transparent',
                    borderRadius: 6,
                    padding: 0,
                    cursor: isStreaming || isBusy ? 'not-allowed' : 'pointer',
                    color: '#334155',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main chat panel */}
      <section style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', padding: 16, minHeight: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isMobile && (
              <button
                onClick={() => {
                  setIsSidebarClosing(false);
                  setIsSidebarOpen(true);
                }}
                aria-label="Open conversations"
                title="Open conversations"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                &gt;
              </button>
            )}
            <h2 style={{ margin: 0 }}>Chatbot</h2>
          </div>
          <span style={{ fontSize: 12, color: isConnected ? 'green' : 'gray' }}>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </header>

        <div
          ref={listRef}
          style={{
            overflowY: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            background: '#f8fafc',
            marginTop: 12,
            marginBottom: 12,
            minHeight: 0,
          }}
        >
          {messages.length === 0 && (
            <div style={{ color: '#888' }}>No messages. Start a new chat to begin.</div>
          )}
          {messages.map((m, idx) => (
            <div key={idx} style={{ display: 'flex', marginBottom: 10 }}>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  background: m.role === 'user' ? '#eaf2ff' : '#ecfdf5',
                  color: '#111',
                  border: '1px solid #e5e7eb',
                  padding: 10,
                  borderRadius: 8,
                  flex: 1,
                  marginLeft: m.role === 'user' ? 90 : 0,
                  marginRight: m.role === 'assistant' ? 90 : 0,
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={'Type a message…'}
            disabled={isStreaming}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #ddd',
              fontSize: 16, // keep >=16px to avoid iOS zoom
            }}
          />
          {(() => {
            const disabled = isStreaming || !input.trim();
            return (
              <button
                onClick={handleSend}
                disabled={disabled}
                style={{
                  background: disabled ? '#93c5fd' : '#2563eb',
                  color: '#fff',
                  border: `1px solid ${disabled ? '#93c5fd' : '#1e40af'}`,
                  padding: '10px 14px',
                  borderRadius: 8,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                Send
              </button>
            );
          })()}
        </div>
      </section>

      {/* Mobile overlay sidebar */}
      {isMobile && (isSidebarOpen || isSidebarClosing) && (
        <div
          role="dialog"
          aria-label="Conversations"
          style={{ position: 'fixed', inset: 0, zIndex: 50 }}
        >
          <div
            onClick={() => {
              setIsSidebarClosing(true);
              setTimeout(() => {
                setIsSidebarOpen(false);
                setIsSidebarClosing(false);
              }, 320);
            }}
            className="drawer-overlay"
            style={{ animationName: isSidebarClosing ? 'overlay-fade-out' : 'overlay-fade-in' }}
          />
          <div
            className="drawer-panel"
            style={{ animationName: isSidebarClosing ? 'drawer-slide-out-left' : 'drawer-slide-in-left' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, gap: 8 }}>
              <strong>Conversations</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={async () => {
                    await handleStartConversation();
                    const list = await listConversations(10);
                    setConversations(list);
                  }}
                  disabled={isStreaming || isBusy}
                  style={{
                    background: isStreaming || isBusy ? '#e7f7ef' : '#ecfdf5',
                    color: '#065f46',
                    border: `1px solid ${isStreaming || isBusy ? '#e7f7ef' : '#d1fae5'}`,
                    padding: '8px 12px',
                    borderRadius: 8,
                    cursor: isStreaming || isBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  New
                </button>
              </div>
            </div>
            <div style={{ overflowY: 'auto' }}>
              {conversations.length === 0 && (
                <div style={{ color: '#888', padding: 12 }}>No conversations yet.</div>
              )}
              {conversations.map((c) => {
                const active = c.id === conversationId;
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setConversationId(c.id);
                      setIsSidebarClosing(true);
                      setTimeout(() => {
                        setIsSidebarOpen(false);
                        setIsSidebarClosing(false);
                      }, 320);
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 12px',
                      borderBottom: '1px solid #f1f5f9',
                      background: active ? '#eaf2ff' : 'transparent',
                      cursor: 'pointer',
                    }}
                    role="button"
                  >
                    <div style={{ display: 'grid' }}>
                      <div style={{ fontSize: 13, color: '#334155' }}>{c.id.slice(0, 8)}…</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{new Date(c.updated_at).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm('Delete this conversation?')) return;
                        try {
                          setIsBusy(true);
                          if (c.id === conversationId) {
                            wsRef.current?.socket.close();
                          }
                          await deleteConversation(c.id);
                          if (c.id === conversationId) {
                            setConversationId(null);
                            setMessages([]);
                          }
                          const list = await listConversations(10).catch(() => []);
                          setConversations(Array.isArray(list) ? list : []);
                        } finally {
                          setIsBusy(false);
                        }
                      }}
                      disabled={isStreaming || isBusy}
                      title="Delete"
                      aria-label={`Delete conversation ${c.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24,
                        height: 24,
                        border: 'none',
                        background: 'transparent',
                        borderRadius: 6,
                        padding: 0,
                        cursor: isStreaming || isBusy ? 'not-allowed' : 'pointer',
                        color: '#334155',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


