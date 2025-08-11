## Run the Chatbot Frontend

Prerequisites
- Node.js >= 20.19.0 (or >= 22.12.0)
- npm >= 10

Backend URL
- By default the frontend targets the backend on the same hostname at port 8000:
  - REST: `${protocol}//${hostname}:8000`
  - WS: `${wsProtocol}//${hostname}:8000`
- To override, create `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
```

Development
```bash
npm install
npm run dev
# Open http://localhost:5173
```

Build & Preview
```bash
npm run build
npm run preview
```

Notes
- The dev server proxies `/chat` and `/health` to `http://localhost:8000`.
- WebSocket endpoint is `/chat/ws/{conversation_id}`.
- If port 5173 is busy: `npm run dev -- --port 5174`.